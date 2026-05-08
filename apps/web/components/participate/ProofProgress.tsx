'use client';

const STAGES = [
  'Loading ZK circuit...',
  'Generating blinding factor...',
  'Computing nullifier...',
  'Initializing proving backend...',
  'Generating zero-knowledge proof...',
  'Proof generated.',
];

interface Props {
  stage: string;
}

export function ProofProgress({ stage }: Props) {
  const currentIndex = STAGES.indexOf(stage);
  const progress = currentIndex >= 0
    ? Math.round(((currentIndex + 1) / STAGES.length) * 100)
    : 10;

  return (
    <div className="rounded-lg border bg-white p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <p className="text-sm font-medium text-gray-700">Proving your age in your browser...</p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-gray-500">
          <span>{stage || 'Initializing...'}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-brand-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
        {STAGES.map((s, i) => (
          <div key={s} className="flex items-center gap-2 text-xs">
            <span
              className={`h-2 w-2 rounded-full ${
                i < currentIndex
                  ? 'bg-green-500'
                  : i === currentIndex
                  ? 'bg-brand-500 animate-pulse'
                  : 'bg-gray-200'
              }`}
            />
            <span className={i <= currentIndex ? 'text-gray-700' : 'text-gray-400'}>{s}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 text-center">
        This may take 10–30 seconds depending on your device.
      </p>
    </div>
  );
}
