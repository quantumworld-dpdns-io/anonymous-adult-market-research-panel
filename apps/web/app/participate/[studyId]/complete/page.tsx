import Link from 'next/link';

export default function CompletePage() {
  return (
    <div className="flex min-h-[calc(100vh-80px)] items-center justify-center">
      <div className="max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Thank you!</h1>
          <p className="mt-2 text-gray-600">
            Your responses have been recorded anonymously.
            Your participation helps researchers make better decisions.
          </p>
        </div>

        <div className="rounded-lg border bg-gray-50 p-4 text-left text-sm text-gray-500">
          <p className="font-medium text-gray-700">Privacy reminder</p>
          <p className="mt-1">
            No personal information was collected. Your session token has been discarded.
            Your responses were encrypted before submission.
          </p>
        </div>

        <Link
          href="/participate"
          className="inline-block rounded-lg bg-brand-500 px-6 py-3 font-semibold text-white hover:bg-brand-600"
        >
          Browse More Studies
        </Link>
      </div>
    </div>
  );
}
