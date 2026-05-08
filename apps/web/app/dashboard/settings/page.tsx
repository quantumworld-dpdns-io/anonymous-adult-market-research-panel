import { createServerClient } from '@/lib/supabase/server';

export default async function SettingsPage() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="rounded-lg border bg-white p-6 space-y-4">
        <h2 className="font-semibold">Account</h2>
        <div className="text-sm text-gray-600 space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-500">Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">User ID</span>
            <code className="text-xs">{user?.id}</code>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6 space-y-4">
        <h2 className="font-semibold">Privacy Policy</h2>
        <div className="text-sm text-gray-500 space-y-2">
          <p>All studies on this platform use differential privacy with ε=10.0, δ=1e-5 by default.</p>
          <p>Participant responses are encrypted end-to-end and never stored in plaintext.</p>
          <p>Age verification uses Noir zero-knowledge proofs — no identity information is transmitted.</p>
        </div>
      </div>
    </div>
  );
}
