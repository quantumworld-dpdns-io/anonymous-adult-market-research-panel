-- Migration: 005_credentials
-- Anonymous credential records produced by the RISC Zero zkVM during credential issuance.
-- All stored values are cryptographic commitments/hashes — no PII.

CREATE TABLE public.credentials (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- hex( RISC Zero credential commitment ) — unique per issued credential
    commitment      text        NOT NULL UNIQUE CHECK (char_length(commitment) = 64),
    -- hex( SHA-256(nullifier) ) — ties credential to the ZK nullifier without storing raw value
    nullifier_hash  text        NOT NULL CHECK (char_length(nullifier_hash) = 64),
    study_id        uuid        NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
    issued_at       timestamptz NOT NULL DEFAULT now(),
    -- hex( SHA-256(JSON-serialised study attribute object) ) — auditable eligibility proof
    attributes_hash text        NOT NULL CHECK (char_length(attributes_hash) = 64),
    -- RISC Zero receipt seal bytes (hex) stored for post-hoc auditability, not runtime use
    receipt_seal    text,

    -- One credential per participant per study
    CONSTRAINT unique_credential_per_nullifier_study
        UNIQUE (nullifier_hash, study_id)
);

COMMENT ON TABLE public.credentials IS
    'RISC Zero-issued anonymous credentials. All fields are hashes/commitments. '
    'receipt_seal enables post-hoc verification that correct code ran.';
COMMENT ON COLUMN public.credentials.receipt_seal IS
    'Hex-encoded RISC Zero seal. Can be used offline to re-verify the credential '
    'issuance receipt against the pinned Image ID.';

CREATE INDEX idx_credentials_nullifier ON public.credentials(nullifier_hash);
CREATE INDEX idx_credentials_study     ON public.credentials(study_id);
CREATE INDEX idx_credentials_issued    ON public.credentials(issued_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Never exposed to participants or researchers directly.
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credentials_service_role_only" ON public.credentials
    USING (auth.role() = 'service_role');
