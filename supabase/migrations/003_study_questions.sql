-- Migration: 003_study_questions
-- Questions belonging to a study. Deleted when parent study is deleted.

CREATE TYPE public.question_type AS ENUM (
    'single_choice',
    'multiple_choice',
    'likert_scale',
    'open_text',
    'ranking',
    'matrix'
);

CREATE TABLE public.study_questions (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id      uuid          NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
    position      integer       NOT NULL CHECK (position >= 1),
    question_type question_type NOT NULL,
    text          text          NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
    -- JSON schema depends on question_type:
    --   single_choice / multiple_choice: { "options": [{ "id": "...", "label": "..." }, ...] }
    --   likert_scale: { "min": 1, "max": 5, "min_label": "...", "max_label": "..." }
    --   ranking: { "items": [{ "id": "...", "label": "..." }, ...] }
    --   matrix: { "rows": [...], "columns": [...] }
    --   open_text: null or { "max_chars": 500 }
    options       jsonb,
    required      boolean       NOT NULL DEFAULT true,
    created_at    timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.study_questions IS
    'Ordered list of questions for a study. Position is 1-based and unique per study.';

-- Enforce unique position within a study
CREATE UNIQUE INDEX idx_study_questions_position
    ON public.study_questions(study_id, position);

CREATE INDEX idx_study_questions_study_id
    ON public.study_questions(study_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.study_questions ENABLE ROW LEVEL SECURITY;

-- Researchers can CRUD questions for their own studies
CREATE POLICY "questions_researcher_rw" ON public.study_questions
    USING (
        EXISTS (
            SELECT 1 FROM public.studies s
            WHERE s.id = study_id
              AND s.researcher_id = auth.uid()
        )
    );

-- Participants can read questions of active studies (to display the questionnaire)
CREATE POLICY "questions_active_study_read" ON public.study_questions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.studies s
            WHERE s.id = study_id
              AND s.status = 'active'
        )
    );

-- Service role full access
CREATE POLICY "questions_service_role_all" ON public.study_questions
    USING (auth.role() = 'service_role');
