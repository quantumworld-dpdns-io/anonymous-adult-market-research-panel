-- Migration: 006_encrypted_responses
-- Encrypted survey response payloads.
-- AES-256-GCM ciphertext only — the DB never sees plaintext responses.
-- Decryption happens inside the federated learning workers using per-study keys
-- retrieved from the secrets manager.

CREATE TABLE public.encrypted_responses (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id          uuid        NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
    -- hex( SHA-256(nullifier) ) — used to enforce one response per participant per study
    nullifier_hash    text        NOT NULL CHECK (char_length(nullifier_hash) = 64),
    -- base64( AES-256-GCM ciphertext of JSON response object )
    -- Associated data used during encryption: study_id bytes
    encrypted_payload text        NOT NULL,
    -- base64( 12-byte random GCM nonce ) — unique per response
    nonce             text        NOT NULL,
    submitted_at      timestamptz NOT NULL DEFAULT now(),

    -- Core invariant: exactly one response per participant per study
    CONSTRAINT one_response_per_participant UNIQUE (nullifier_hash, study_id)
);

COMMENT ON TABLE public.encrypted_responses IS
    'AES-256-GCM encrypted survey responses. Plaintext never stored. '
    'Decrypted only by federated learning workers with the per-study key.';
COMMENT ON COLUMN public.encrypted_responses.encrypted_payload IS
    'base64( AES-256-GCM ciphertext ). Associated data = study_id bytes. '
    'Key stored in secrets manager, not in DB.';
COMMENT ON COLUMN public.encrypted_responses.nonce IS
    'base64( 12-byte GCM nonce ). Must be unique per (study_id, participant).';

CREATE INDEX idx_responses_study      ON public.encrypted_responses(study_id);
CREATE INDEX idx_responses_nullifier  ON public.encrypted_responses(nullifier_hash);
CREATE INDEX idx_responses_submitted  ON public.encrypted_responses(submitted_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.encrypted_responses ENABLE ROW LEVEL SECURITY;

-- Researchers can query count and metadata (id, study_id, submitted_at) for their studies.
-- RLS does NOT restrict which columns are returned — use column-level grants or
-- views to hide encrypted_payload and nullifier_hash from researcher queries.
CREATE POLICY "responses_researcher_meta" ON public.encrypted_responses
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.studies s
            WHERE s.id = study_id
              AND s.researcher_id = auth.uid()
        )
    );

-- Service role (backend analytics workers) full access for FL decryption
CREATE POLICY "responses_service_role_all" ON public.encrypted_responses
    USING (auth.role() = 'service_role');

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Enable Realtime so the researcher dashboard can live-count submissions.
-- Column-level filtering keeps encrypted_payload and nullifier_hash off the wire.
ALTER PUBLICATION supabase_realtime ADD TABLE public.encrypted_responses;

-- ── Column-level grants ───────────────────────────────────────────────────────
-- Revoke sensitive columns from the authenticated role so they are never returned
-- via the auto-generated REST API or Realtime to researcher sessions.
REVOKE SELECT (encrypted_payload, nullifier_hash)
    ON public.encrypted_responses
    FROM authenticated;
