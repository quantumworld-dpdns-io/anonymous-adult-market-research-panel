// NoirJS in-browser ZK age proof generation.
// Birth date is NEVER transmitted — stays in this function's closure only.

export interface DateAttestation {
  current_date: { year: number; month: number; day: number };
  signed_at: number;
  study_id: string;
  signature: number[];
}

export interface AgeProofResult {
  proof: Uint8Array;
  publicInputs: string[];
  nullifier: string;
}

type ProgressCallback = (stage: string) => void;

export async function generateAgeProof(
  birthYear: number,
  birthMonth: number,
  birthDay: number,
  studyId: string,
  dateAttestation: DateAttestation,
  onProgress?: ProgressCallback,
): Promise<AgeProofResult> {
  onProgress?.('Loading ZK circuit...');

  // Dynamic imports so Barretenberg WASM only loads on this route
  const [{ Noir }, { BarretenbergBackend }, circuitJson] = await Promise.all([
    import('@noir-lang/noir_js'),
    import('@noir-lang/backend_barretenberg'),
    import('@/circuits/age_proof.json'),
  ]);

  onProgress?.('Generating blinding factor...');
  const blindingFactor = generateBlindingFactor();

  onProgress?.('Computing nullifier...');
  const nullifier = await computeNullifier(
    birthYear,
    birthMonth,
    birthDay,
    blindingFactor,
    studyId,
  );

  onProgress?.('Initializing proving backend...');
  const threads = Number(process.env.NEXT_PUBLIC_ZK_THREADS ?? 4);
  const backend = new BarretenbergBackend(circuitJson as any, { threads });
  const noir = new Noir(circuitJson as any, backend);

  const inputs = {
    birth_year: birthYear,
    birth_month: birthMonth,
    birth_day: birthDay,
    blinding_factor: blindingFactor,
    current_year: dateAttestation.current_date.year,
    current_month: dateAttestation.current_date.month,
    current_day: dateAttestation.current_date.day,
    study_id: studyId,
    nullifier,
  };

  onProgress?.('Generating zero-knowledge proof...');
  const { proof, publicInputs } = await noir.generateProof(inputs);

  onProgress?.('Proof generated.');

  // Birth date is cleared when this function returns — never stored
  return { proof, publicInputs, nullifier };
}

function generateBlindingFactor(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    '0x' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

async function computeNullifier(
  birthYear: number,
  birthMonth: number,
  birthDay: number,
  blindingFactor: string,
  studyId: string,
): Promise<string> {
  // Mirrors the Pedersen hash in the Noir circuit.
  // For browser compat, approximate with SHA-256 (server verifies via Barretenberg).
  const encoder = new TextEncoder();
  const data = encoder.encode(
    `${birthYear}:${birthMonth}:${birthDay}:${blindingFactor}:${studyId}`,
  );
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return '0x' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
