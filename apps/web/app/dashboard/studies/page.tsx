import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { StudyCard } from '@/components/dashboard/StudyCard';

export default async function StudiesListPage() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: studies } = await supabase
    .from('studies')
    .select('id, title, status, description, created_at, min_responses')
    .eq('researcher_id', user!.id)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Studies</h1>
        <Link
          href="/dashboard/studies/new"
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
        >
          + New Study
        </Link>
      </div>

      {(!studies || studies.length === 0) ? (
        <div className="rounded-lg border border-dashed p-16 text-center text-gray-400">
          <p>No studies yet.</p>
          <Link href="/dashboard/studies/new" className="mt-2 text-sm text-brand-500 hover:underline">
            Create your first study
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {studies.map((study) => (
            <StudyCard key={study.id} study={study} />
          ))}
        </div>
      )}
    </div>
  );
}
