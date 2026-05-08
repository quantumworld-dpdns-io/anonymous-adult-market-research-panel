-- Migration: 004_nullifiers
-- Nullifier registry: one row per (participant × study) participation event.
-- Contains ZERO PII. The nullifier_hash is SHA-256(raw_nullifier) — the raw
-- nullifier itself is never stored anywhere server-side.

CREATE TABLE public.nullifiers (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- hex( SHA-256(nullifier) ) — derived from participant's ZK proof blinding factor
    nullifier_hash text        NOT NULL CHECK (char_length(nullifier_hash) = 64),
    study_id       uuid        NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
    registered_at  timestamptz NOT NULL DEFAULT now(),

    -- Core invariant: one proof per participant per study
    CONSTRAINT unique_nullifier_per_study UNIQUE (nullifier_hash, study_id)
);

COMMENT ON TABLE public.nullifiers IS
    'Prevents ZK proof replay. nullifier_hash = hex(SHA-256(nullifier)). '
    'No PII. raw nullifier is never stored.';
COMMENT ON COLUMN public.nullifiers.nullifier_hash IS
    '64-char lowercase hex string = SHA-256 of the one-time nullifier from the ZK circuit output.';

CREATE INDEX idx_nullifiers_hash    ON public.nullifiers(nullifier_hash);
CREATE INDEX idx_nullifiers_study   ON public.nullifiers(study_id);
CREATE INDEX idx_nullifiers_regtime ON public.nullifiers(registered_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- This table is NEVER directly accessible by participants or researchers.
-- Only the backend ZK proving service (service_role) may read/write it.
ALTER TABLE public.nullifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nullifiers_service_role_only" ON public.nullifiers
    USING (auth.role() = 'service_role');
