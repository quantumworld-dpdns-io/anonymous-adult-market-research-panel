import { createServerClient } from '@/lib/supabase/server';
import { ResponseChart } from '@/components/dashboard/ResponseChart';
import { notFound } from 'next/navigation';
import { createHmac } from 'crypto';

function generateServiceHmac(service: string, studyId: string): string {
  const secret = process.env.SERVICE_HMAC_SECRET ?? '';
  return createHmac('sha256', secret)
    .update(`${service}:${studyId}`)
    .digest('hex');
}

async function getResults(studyId: string) {
  try {
    const res = await fetch(
      `${process.env.INTERNAL_API_URL}/analytics/${studyId}/results`,
      {
        headers: { 'X-Service-HMAC': generateServiceHmac('analytics', studyId) },
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function StudyResultsPage({
  params,
}: {
  params: { studyId: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: study } = await supabase
    .from('studies')
    .select('id, title, min_responses, researcher_id')
    .eq('id', params.studyId)
    .eq('researcher_id', user!.id)
    .single();

  if (!study) notFound();

  const results = await getResults(params.studyId);

  if (!results) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Results</h2>
        <div className="rounded-lg border border-dashed p-12 text-center text-gray-400">
          <p>Results not yet available.</p>
          <p className="mt-1 text-sm">
            At least {study.min_responses} responses are required before a federated analytics round runs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Results — {study.title}</h2>
        <p className="mt-1 text-sm text-gray-500">
          Differentially private (ε={results.epsilon_budget_used?.toFixed(2)}).
          Based on {results.response_count} responses.
          Minimum cohort: {results.min_cohort_size}.
        </p>
      </div>

      {results.question_results?.map((q: any) => (
        <div key={q.question_id} className="rounded-lg border bg-white p-6">
          <h3 className="mb-4 font-medium text-gray-900">{q.text}</h3>
          <ResponseChart question={q} data={q.options} />
        </div>
      ))}

      <div className="rounded-lg border bg-gray-50 p-4 text-xs text-gray-400">
        ε budget remaining: {results.epsilon_budget_remaining?.toFixed(2)} /{' '}
        {results.epsilon_budget_used + results.epsilon_budget_remaining} total.
        Last updated: {results.last_round_at
          ? new Date(results.last_round_at).toLocaleString()
          : 'never'}.
      </div>
    </div>
  );
}
