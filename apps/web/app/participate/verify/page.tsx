'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AgeVerificationForm } from '@/components/participate/AgeVerificationForm';
import { ProofProgress } from '@/components/participate/ProofProgress';
import { generateAgeProof } from '@/lib/zk/useAgeProof';
import { submitAgeProof } from '@/lib/zk/verifyAge';
import { storeSessionToken } from '@/lib/zk/sessionToken';

type Step = 'form' | 'proving' | 'submitting' | 'done' | 'error';

function VerifyAgeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studyId = searchParams.get('study') ?? '';

  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [proofStage, setProofStage] = useState<string>('');

  async function handleSubmit(birthYear: number, birthMonth: number, birthDay: number) {
    if (!studyId) {
      setError('No study selected. Please go back and select a study.');
      setStep('error');
      return;
    }

    try {
      // 1. Fetch server-signed date attestation
      const attestRes = await fetch(`/api/date-attestation?study=${studyId}`);
      if (!attestRes.ok) throw new Error('Failed to fetch date attestation');
      const attestation = await attestRes.json();

      // 2. Generate ZK proof in-browser (WASM)
      setStep('proving');
      setProofStage('Initializing circuit...');
      const proofResult = await generateAgeProof(
        birthYear, birthMonth, birthDay, studyId, attestation,
        (stage: string) => setProofStage(stage),
      );

      // 3. Submit proof to server
      setStep('submitting');
      const token = await submitAgeProof(proofResult, studyId, attestation);

      // 4. Store token in memory only — intentionally lost on refresh
      storeSessionToken(studyId, token);

      setStep('done');
      router.push(`/participate/${studyId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Age verification failed. Please try again.');
      setStep('error');
    }
  }

  return (
    <main className="flex min-h-[calc(100vh-80px)] items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Age Verification</h1>
          <p className="mt-2 text-sm text-gray-600">
            We use zero-knowledge proofs to confirm you are 18 or older.
            Your birth date is processed only in your browser and is never sent to our servers.
          </p>
        </div>

        {step === 'form' && (
          <AgeVerificationForm onSubmit={handleSubmit} />
        )}

        {step === 'proving' && (
          <ProofProgress stage={proofStage} />
        )}

        {step === 'submitting' && (
          <div className="rounded-lg border bg-blue-50 p-6 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-sm text-blue-700">Verifying proof with server...</p>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <button
              onClick={() => { setStep('form'); setError(null); }}
              className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Try Again
            </button>
          </div>
        )}

        <p className="text-center text-xs text-gray-400">
          Proof generated locally · No identity data transmitted · Anonymous credential issued
        </p>
      </div>
    </main>
  );
}

export default function VerifyAgePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <VerifyAgeContent />
    </Suspense>
  );
}
