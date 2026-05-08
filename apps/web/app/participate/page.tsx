import Link from 'next/link';

interface Study {
  id: string;
  title: string;
  description: string;
  estimated_minutes: number;
  incentive_usd: number;
}

async function getActiveStudies(): Promise<Study[]> {
  try {
    const res = await fetch(
      `${process.env.API_GATEWAY_URL}/studies?status=active`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function StudyDiscoveryPage() {
  const studies = await getActiveStudies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Available Studies</h1>
        <p className="mt-1 text-sm text-gray-500">
          Select a study to begin. You&apos;ll verify your age anonymously before participating.
        </p>
      </div>

      {studies.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-gray-400">
          No active studies at the moment. Check back soon.
        </div>
      ) : (
        <div className="grid gap-4">
          {studies.map((study) => (
            <div key={study.id} className="rounded-lg border bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900">{study.title}</h2>
                  <p className="mt-1 text-sm text-gray-500">{study.description}</p>
                  <p className="mt-2 text-xs text-gray-400">
                    ~{study.estimated_minutes} min · ${study.incentive_usd} USD
                  </p>
                </div>
                <Link
                  href={`/participate/verify?study=${study.id}`}
                  className="ml-4 shrink-0 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Participate
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
