-- supabase/seed.sql
-- Development seed data — NO real PII. Safe to commit.
-- Applied automatically by `supabase db reset` in local dev.

-- ── Dev researcher ────────────────────────────────────────────────────────────
-- Supabase Auth does not allow direct inserts into auth.users via seed.
-- Use `supabase auth create-user` CLI or the Studio UI to create the dev user,
-- then insert a matching researcher row with that UUID.
--
-- For CI / automated environments, a placeholder UUID is used and the
-- auth.users row is created via the admin API in the test setup script.

DO $$
DECLARE
    v_researcher_id uuid := '00000000-0000-0000-0000-000000000099';
    v_study_id      uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- Insert researcher profile (auth.users row must exist first in real env)
    INSERT INTO public.researchers (id, display_name, org_name)
    VALUES (v_researcher_id, 'Dev Researcher', 'Dev Org')
    ON CONFLICT (id) DO NOTHING;

    -- ── Test study ────────────────────────────────────────────────────────────
    INSERT INTO public.studies (
        id, researcher_id, title, description, status,
        min_responses, max_responses, targeting
    )
    VALUES (
        v_study_id,
        v_researcher_id,
        'Test Study: Consumer Electronics Preferences',
        'A test study for local development. No real data.',
        'active',
        10,   -- Low threshold so dev rounds trigger quickly
        1000,
        '{"age_range": "18-99", "country_tier": "TIER_1", "interests": ["tech"]}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;

    -- ── Test questions ────────────────────────────────────────────────────────
    INSERT INTO public.study_questions (study_id, position, question_type, text, options)
    VALUES
        (
            v_study_id, 1, 'single_choice',
            'How often do you purchase new consumer electronics?',
            '{"options": [
                {"id": "monthly",    "label": "Monthly"},
                {"id": "quarterly",  "label": "Every few months"},
                {"id": "annually",   "label": "Once a year or less"},
                {"id": "rarely",     "label": "Rarely / Never"}
            ]}'::jsonb
        ),
        (
            v_study_id, 2, 'single_choice',
            'What is the primary factor in your purchase decision?',
            '{"options": [
                {"id": "price",       "label": "Price"},
                {"id": "brand",       "label": "Brand reputation"},
                {"id": "features",    "label": "Features / specs"},
                {"id": "reviews",     "label": "User reviews"}
            ]}'::jsonb
        ),
        (
            v_study_id, 3, 'likert_scale',
            'How satisfied are you with your most recent electronics purchase?',
            '{"min": 1, "max": 5, "min_label": "Very dissatisfied", "max_label": "Very satisfied"}'::jsonb
        ),
        (
            v_study_id, 4, 'multiple_choice',
            'Which categories did you purchase in the last 12 months? (Select all that apply)',
            '{"options": [
                {"id": "smartphone", "label": "Smartphone"},
                {"id": "laptop",     "label": "Laptop / tablet"},
                {"id": "wearable",   "label": "Wearable (watch, earbuds)"},
                {"id": "tv",         "label": "TV / display"},
                {"id": "gaming",     "label": "Gaming hardware"},
                {"id": "none",       "label": "None of the above"}
            ]}'::jsonb
        ),
        (
            v_study_id, 5, 'open_text',
            'Is there anything else you would like to share about your electronics buying habits?',
            '{"max_chars": 500}'::jsonb
        )
    ON CONFLICT DO NOTHING;

    -- ── Initial privacy budget row ─────────────────────────────────────────────
    INSERT INTO public.study_privacy_budgets (study_id, total_epsilon, spent_epsilon, rounds_run)
    VALUES (v_study_id, 10.0, 0.0, 0)
    ON CONFLICT (study_id) DO NOTHING;

END $$;
