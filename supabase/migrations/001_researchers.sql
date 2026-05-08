-- Migration: 001_researchers
-- Researcher profiles linked to Supabase Auth (auth.users).
-- No PII beyond what auth.users stores for researcher login.

CREATE TABLE public.researchers (
    id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name text        NOT NULL,
    org_name     text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.researchers IS
    'Researcher profiles. Linked 1:1 to auth.users. No participant data here.';

-- updated_at auto-maintenance
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER researchers_updated_at
    BEFORE UPDATE ON public.researchers
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.researchers ENABLE ROW LEVEL SECURITY;

-- A researcher may read their own profile
CREATE POLICY "researchers_select_own" ON public.researchers
    FOR SELECT
    USING (auth.uid() = id);

-- A researcher may update their own profile
CREATE POLICY "researchers_update_own" ON public.researchers
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Backend services (service_role) have full access
CREATE POLICY "researchers_service_role_all" ON public.researchers
    USING (auth.role() = 'service_role');

-- Allow insert during onboarding (user inserts their own row)
CREATE POLICY "researchers_insert_own" ON public.researchers
    FOR INSERT
    WITH CHECK (auth.uid() = id);
