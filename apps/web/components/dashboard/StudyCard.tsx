import Link from 'next/link';

interface Study {
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  min_responses: number;
}

interface Props {
  study: Study;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-red-100 text-red-600',
  archived: 'bg-gray-100 text-gray-400',
};

export function StudyCard({ study }: Props) {
  return (
    <Link
      href={`/dashboard/studies/${study.id}`}
      className="block rounded-lg border bg-white p-5 hover:border-brand-500 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-gray-900">{study.title}</h3>
          <p className="mt-1 truncate text-sm text-gray-500">{study.description}</p>
          <p className="mt-2 text-xs text-gray-400">
            Created {new Date(study.created_at).toLocaleDateString()} ·
            Min {study.min_responses} responses
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            statusColors[study.status] ?? 'bg-gray-100 text-gray-500'
          }`}
        >
          {study.status}
        </span>
      </div>
    </Link>
  );
}
