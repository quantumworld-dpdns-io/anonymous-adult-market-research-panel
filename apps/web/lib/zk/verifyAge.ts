import type { AgeProofResult, DateAttestation } from './useAgeProof';

export async function submitAgeProof(
  proofResult: AgeProofResult,
  studyId: string,
  dateAttestation: DateAttestation,
): Promise<string> {
  const res = await fetch('/api/verify-age', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof: Array.from(proofResult.proof),
      public_inputs: proofResult.publicInputs,
      nullifier: proofResult.nullifier,
      study_id: studyId,
      date_attestation: dateAttestation,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `Verification failed (${res.status})`);
  }

  const { zk_session_token } = await res.json();
  if (!zk_session_token) throw new Error('No session token returned from server');
  return zk_session_token;
}
