-- Migration: 007_privacy_budgets
-- Differential privacy (DP) ε-budget accounting per study.
-- The DB-level CHECK constraint acts as a hard backstop in addition to
-- the application-layer budget tracker.

CREATE TABLE public.study_privacy_budgets (
    study_id        uuid    PRIMARY KEY REFERENCES public.studies(id) ON DELETE CASCADE,
    -- Total ε allocated to this study (default: 10.0)
    total_epsilon   numeric NOT NULL DEFAULT 10.0 CHECK (total_epsilon > 0),
    -- Cumulative ε consumed across all federated rounds
    spent_epsilon   numeric NOT NULL DEFAULT 0.0  CHECK (spent_epsilon >= 0),
    -- Number of completed federated rounds
    rounds_run      integer NOT NULL DEFAULT 0    CHECK (rounds_run >= 0),
    last_round_at   timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now(),

    -- Hard limit: spent must never exceed total
    CONSTRAINT budget_not_exceeded CHECK (spent_epsilon <= total_epsilon)
);

COMMENT ON TABLE public.study_privacy_budgets IS
    'Per-study differential privacy ε-budget ledger. '
    'DB-level CHECK constraint enforces spent_epsilon <= total_epsilon as a backstop.';
COMMENT ON COLUMN public.study_privacy_budgets.spent_epsilon IS
    'Sum of ε consumed by all completed federated rounds. '
    'Incremented atomically by the Analytics Service after each successful round.';

-- updated_at auto-maintenance (reuses function from 001)
CREATE TRIGGER privacy_budgets_updated_at
    BEFORE UPDATE ON public.study_privacy_budgets
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.study_privacy_budgets ENABLE ROW LEVEL SECURITY;

-- Researchers can read the ε budget for their own studies (informational)
CREATE POLICY "budgets_researcher_read" ON public.study_privacy_budgets
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.studies s
            WHERE s.id = study_id
              AND s.researcher_id = auth.uid()
        )
    );

-- Only service role may INSERT or UPDATE budgets
CREATE POLICY "budgets_service_role_all" ON public.study_privacy_budgets
    USING (auth.role() = 'service_role');

-- ── Helper: atomic ε deduction ────────────────────────────────────────────────
-- Called by Analytics Service via RPC to atomically deduct ε and increment rounds.
CREATE OR REPLACE FUNCTION public.deduct_epsilon(
    p_study_id uuid,
    p_epsilon  numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as owner (postgres), so CHECK constraint is still enforced
AS $$
BEGIN
    UPDATE public.study_privacy_budgets
    SET spent_epsilon = spent_epsilon + p_epsilon,
        rounds_run    = rounds_run + 1,
        last_round_at = now()
    WHERE study_id = p_study_id;

    IF NOT FOUND THEN
        -- First round: insert initial row
        INSERT INTO public.study_privacy_budgets(study_id, spent_epsilon, rounds_run, last_round_at)
        VALUES (p_study_id, p_epsilon, 1, now());
    END IF;
END;
$$;

COMMENT ON FUNCTION public.deduct_epsilon IS
    'Atomically deducts p_epsilon from a study budget. '
    'The budget_not_exceeded CHECK constraint will raise an error if the deduction '
    'would exceed total_epsilon, rolling back the calling transaction.';

-- Grant RPC access to service role only
REVOKE ALL ON FUNCTION public.deduct_epsilon(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_epsilon(uuid, numeric) TO service_role;
