import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <div className="max-w-2xl space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">
          Anonymous Market Research Panel
        </h1>
        <p className="text-lg text-gray-600">
          Participate in paid research studies with complete anonymity.
          We use zero-knowledge proofs to verify your age — your identity stays yours.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/participate"
            className="rounded-lg bg-brand-500 px-6 py-3 font-semibold text-white hover:bg-brand-600 transition-colors"
          >
            Browse Studies
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 px-6 py-3 font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Researcher Login
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-6 pt-8 text-left">
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold">Zero-Knowledge Proofs</h3>
            <p className="mt-1 text-sm text-gray-500">
              Prove you&apos;re 18+ without revealing your birth date.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold">No PII Stored</h3>
            <p className="mt-1 text-sm text-gray-500">
              No name, email, or IP address ever touches our servers.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold">Federated Analytics</h3>
            <p className="mt-1 text-sm text-gray-500">
              Responses computed with differential privacy guarantees.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
