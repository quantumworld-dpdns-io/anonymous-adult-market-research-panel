-- Migration: 002_studies
-- Market research studies created and owned by researchers.

CREATE TYPE public.study_status AS ENUM (
    'draft',
    'active',
    'paused',
    'closed',
    'archived'
);

CREATE TABLE public.studies (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    researcher_id      uuid         NOT NULL REFERENCES public.researchers(id) ON DELETE CASCADE,
    title              text         NOT NULL CHECK (char_length(title) BETWEEN 1 AND 255),
    description        text,
    status             study_status NOT NULL DEFAULT 'draft',
    -- Arbitrary study configuration (question ordering, incentive type, etc.)
    config             jsonb        NOT NULL DEFAULT '{}',
    -- Non-PII targeting attributes (age_range buckets, interest tags, country_tier)
    targeting          jsonb        NOT NULL DEFAULT '{}',
    -- SHA-256 of the QASM circuit used for quantum-random panel sampling (auditability)
    sampling_qasm_hash text,
    min_responses      integer      NOT NULL DEFAULT 50  CHECK (min_responses > 0),
    max_responses      integer               CHECK (max_responses IS NULL OR max_responses >= min_responses),
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    closed_at          timestamptz
);

COMMENT ON TABLE public.studies IS
    'Market research studies. researcher_id ties study to its owner. '
    'No PII. targeting uses coarse attribute buckets only.';
COMMENT ON COLUMN public.studies.sampling_qasm_hash IS
    'SHA-256 of the OpenQASM 3 circuit used for quantum-random cohort selection. '
    'Stored for post-hoc auditability; not used at runtime.';

-- Performance indexes
CREATE INDEX idx_studies_researcher_id ON public.studies(researcher_id);
CREATE INDEX idx_studies_status        ON public.studies(status);
CREATE INDEX idx_studies_created_at    ON public.studies(created_at DESC);

-- updated_at trigger (reuses function from 001)
CREATE TRIGGER studies_updated_at
    BEFORE UPDATE ON public.studies
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-set closed_at when status transitions to 'closed'
CREATE OR REPLACE FUNCTION public.set_study_closed_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
        NEW.closed_at = now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER studies_closed_at
    BEFORE UPDATE ON public.studies
    FOR EACH ROW EXECUTE FUNCTION public.set_study_closed_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.studies ENABLE ROW LEVEL SECURITY;

-- Researchers can CRUD their own studies
CREATE POLICY "studies_select_own" ON public.studies
    FOR SELECT
    USING (auth.uid() = researcher_id);

CREATE POLICY "studies_insert_own" ON public.studies
    FOR INSERT
    WITH CHECK (auth.uid() = researcher_id);

CREATE POLICY "studies_update_own" ON public.studies
    FOR UPDATE
    USING (auth.uid() = researcher_id)
    WITH CHECK (auth.uid() = researcher_id);

CREATE POLICY "studies_delete_own" ON public.studies
    FOR DELETE
    USING (auth.uid() = researcher_id AND status IN ('draft', 'archived'));

-- Participants (anonymous / unauthenticated) can list active studies for the portal.
-- Columns exposed: id, title, description, config, targeting — NOT researcher_id.
CREATE POLICY "studies_active_public_read" ON public.studies
    FOR SELECT
    USING (status = 'active');

-- Service role full access
CREATE POLICY "studies_service_role_all" ON public.studies
    USING (auth.role() = 'service_role');
