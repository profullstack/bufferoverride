import { notFound, permanentRedirect } from 'next/navigation';
import { getQuestion } from '../../_lib/queries.ts';

type Params = { params: Promise<{ id: string }> };

// A bare /q/<code> is the short form people paste and agents print; it has one
// canonical address with the slug, so send it there instead of a 404.
export default async function QuestionShortLink({ params }: Params) {
  const { id } = await params;
  const data = await getQuestion(id);
  if (!data) notFound();
  permanentRedirect(`/q/${data.question.code}/${data.question.slug}`);
}
