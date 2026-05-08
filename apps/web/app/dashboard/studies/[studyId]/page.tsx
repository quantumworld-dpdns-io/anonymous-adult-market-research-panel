import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { LiveCounter } from '@/components/dashboard/LiveCounter';
import { notFound } from 'next/navigation';

export default async function StudyDetailPage({
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
    .select('*')
    .eq('id', params.studyId)
    .eq('researcher_id', user!.id)
    .single();

  if (!study) notFound();

  const tabs = [
    { href: `/dashboard/studies/${params.studyId}`, label: 'Overview' },
    { href: `/dashboard/studies/${params.studyId}/questions`, label: 'Questions' },
    { href: `/dashboard/studies/${params.studyId}/cohort`, label: 'Cohort' },
    { href: `/dashboard/studies/${params.studyId}/results`, label: 'Results' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{study.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{study.description}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            study.status === 'active'
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {study.status}
        </span>
      </div>

      <nav className="flex gap-4 border-b">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-gray-500 hover:border-brand-500 hover:text-gray-900"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Live Responses</p>
          <LiveCounter studyId={params.studyId} />
        </div>
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Target</p>
          <p className="mt-1 text-2xl font-bold">{study.min_responses}+</p>
          <p className="text-xs text-gray-400">needed for DP results</p>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6 text-sm text-gray-500">
        <p><strong>Study ID:</strong> <code className="text-xs">{study.id}</code></p>
        <p className="mt-1"><strong>Created:</strong> {new Date(study.created_at).toLocaleString()}</p>
      </div>
    </div>
  );
}
