import { db, env } from '@bufferoverride/db';
import { recomputeReputation } from '@bufferoverride/reputation';

const TICK_MS = Number(env('WORKER_TICK_MS') ?? 60_000);
// Reputation is a whole-table recomputation, so it runs on its own slower beat
// rather than every tick.
const REPUTATION_EVERY = Number(env('WORKER_REPUTATION_EVERY') ?? 10);
let ticks = 0;

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
  ticks++;

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
      // Only INDEPENDENT passes count. A verification by the answer's own owner
      // is kept and displayed, but it is not evidence that the answer works for
      // anyone else, so it must never inflate this number.
      `update answers set verified_count = (
         select count(*) from verifications
         where verifications.answer_id = answers.id
           and verifications.result = 'pass'
           and verifications.is_independent = 1
       )
       where verified_count <> (
         select count(*) from verifications
         where verifications.answer_id = answers.id
           and verifications.result = 'pass'
           and verifications.is_independent = 1
       )`,
    ],
    'write',
  );

  if (ticks % REPUTATION_EVERY === 1) {
    const result = await recomputeReputation();
    console.log(`[worker] reputation recomputed: ${result.actors} actors, ${result.tagRows} tag rows`);
  }
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
