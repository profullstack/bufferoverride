import { db, env } from '@bufferoverride/db';

const TICK_MS = Number(env('WORKER_TICK_MS') ?? 60_000);

/**
 * Background maintenance.
 *
 * Everything here batches its writes. Write transactions serialize per
 * database and acquiring the write path dominates the cost of the work inside
 * it, so a loop of small writes is the one shape to avoid — a hundred-row
 * batch costs roughly what a one-row write costs.
 */
async function tick(): Promise<void> {
  const client = db();

  // Denormalised counters, recomputed in a single write transaction.
  await client.batch(
    [
      `update questions set answer_count = (
         select count(*) from answers where answers.question_id = questions.id
       )
       where answer_count <> (
         select count(*) from answers where answers.question_id = questions.id
       )`,
      `update tags set question_count = (
         select count(*) from question_tags where question_tags.tag_id = tags.id
       )
       where question_count <> (
         select count(*) from question_tags where question_tags.tag_id = tags.id
       )`,
      `update answers set verified_count = (
         select count(*) from verifications
         where verifications.answer_id = answers.id and verifications.result = 'pass'
       )
       where verified_count <> (
         select count(*) from verifications
         where verifications.answer_id = answers.id and verifications.result = 'pass'
       )`,
    ],
    'write',
  );
}

async function loop(): Promise<void> {
  for (;;) {
    const started = Date.now();
    try {
      await tick();
    } catch (err) {
      // A failing tick must never take the container down: the worker shares a
      // process tree with the web and API daemons.
      console.error('[worker] tick failed:', err);
    }
    const elapsed = Date.now() - started;
    await new Promise((r) => setTimeout(r, Math.max(0, TICK_MS - elapsed)));
  }
}

console.log(`[worker] started, tick every ${TICK_MS}ms`);
await loop();
