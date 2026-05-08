import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';

export default async function DashboardOverviewPage() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: studies, count } = await supabase
    .from('studies')
    .select('id, title, status, created_at', { count: 'exact' })
    .eq('researcher_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const activeCount = studies?.filter((s) => s.status === 'active').length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <Link
          href="/dashboard/studies/new"
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
        >
          New Study
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Total Studies</p>
          <p className="mt-1 text-3xl font-bold">{count ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Active Studies</p>
          <p className="mt-1 text-3xl font-bold text-green-600">{activeCount}</p>
        </div>
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Privacy Model</p>
          <p className="mt-1 text-sm font-medium">ε-δ Differential Privacy</p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Recent Studies</h2>
        <div className="space-y-2">
          {(studies ?? []).map((study) => (
            <Link
              key={study.id}
              href={`/dashboard/studies/${study.id}`}
              className="flex items-center justify-between rounded-lg border bg-white p-4 hover:bg-gray-50"
            >
              <div>
                <p className="font-medium text-gray-900">{study.title}</p>
                <p className="text-xs text-gray-400">
                  {new Date(study.created_at).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-xs font-medium ${
                  study.status === 'active'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {study.status}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
