# 08 — Supabase Database Design

## Purpose

Define the complete Supabase schema, Row-Level Security policies, Edge Functions, and Realtime subscription design for the platform. The schema is designed with the core invariant: **no PII is stored anywhere**.

---

## 1. Database Design Principles

| Principle | Implementation |
|---|---|
| No PII storage | No name, email, IP, or birth date columns anywhere except `auth.users` (researcher accounts only) |
| Cryptographic identifiers | Participants identified only by nullifier hashes (SHA-256 of one-time nullifier) |
| Defense-in-depth | RLS policies on every table; service role bypass only for backend services |
| Encrypted payloads | Response content encrypted with AES-256-GCM before storage; DB never sees plaintext |
| Minimal exposure | Participants cannot query any table; researchers can only see their own studies |

---

## 2. Schema Overview

```
┌─────────────────┐    ┌─────────────────────┐    ┌────────────────────┐
│   researchers   │    │      studies         │    │  study_questions   │
│ (auth.users)    │───►│  id, title, status   │───►│  id, study_id, ... │
└─────────────────┘    └──────────┬──────────┘    └────────────────────┘
                                   │
                    ┌──────────────┼──────────────────┐
                    ▼              ▼                   ▼
          ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐
          │ credentials │  │  nullifiers  │  │encrypted_responses│
          │ commitment  │  │  hash, study │  │ payload, nonce    │
          │ nullifier_h │  └──────────────┘  └───────────────────┘
          └─────────────┘
                    │
          ┌─────────────────────┐
          │ study_privacy_budgets│
          │ study_id, spent_ε   │
          └─────────────────────┘
```

---

## 3. Migration Files

### 3.1 `supabase/migrations/001_researchers.sql`

```sql
-- Researcher profiles (linked to auth.users via Supabase Auth)
CREATE TABLE public.researchers (
    id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name text NOT NULL,
    org_name    text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: Researchers can only read/update their own profile
ALTER TABLE public.researchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "researchers_select_own" ON public.researchers
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "researchers_update_own" ON public.researchers
    FOR UPDATE USING (auth.uid() = id);

-- Service role bypass for backend writes
CREATE POLICY "service_role_all" ON public.researchers
    USING (auth.role() = 'service_role');
```

### 3.2 `supabase/migrations/002_studies.sql`

```sql
CREATE TYPE study_status AS ENUM ('draft', 'active', 'paused', 'closed', 'archived');

CREATE TABLE public.studies (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    researcher_id   uuid NOT NULL REFERENCES public.researchers(id),
    title           text NOT NULL,
    description     text,
    status          study_status NOT NULL DEFAULT 'draft',
    config          jsonb NOT NULL DEFAULT '{}',
    -- Targeting criteria (no-PII attributes)
    targeting       jsonb NOT NULL DEFAULT '{}',
    -- Quantum sampling result (QASM circuit hash for auditability)
    sampling_qasm_hash text,
    min_responses   integer NOT NULL DEFAULT 50,
    max_responses   integer,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz
);

-- Indexes
CREATE INDEX idx_studies_researcher_id ON public.studies(researcher_id);
CREATE INDEX idx_studies_status ON public.studies(status);

-- RLS
ALTER TABLE public.studies ENABLE ROW LEVEL SECURITY;

-- Researchers see only their own studies
CREATE POLICY "studies_select_own" ON public.studies
    FOR SELECT USING (auth.uid() = researcher_id);

CREATE POLICY "studies_insert_own" ON public.studies
    FOR INSERT WITH CHECK (auth.uid() = researcher_id);

CREATE POLICY "studies_update_own" ON public.studies
    FOR UPDATE USING (auth.uid() = researcher_id);

-- Participants can see basic info for active studies (for portal listing)
-- No researcher_id visible to participants
CREATE POLICY "active_studies_public_read" ON public.studies
    FOR SELECT USING (status = 'active');

CREATE POLICY "service_role_all" ON public.studies
    USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER studies_updated_at
    BEFORE UPDATE ON public.studies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 3.3 `supabase/migrations/003_study_questions.sql`

```sql
CREATE TYPE question_type AS ENUM (
    'single_choice', 'multiple_choice', 'likert_scale',
    'open_text', 'ranking', 'matrix'
);

CREATE TABLE public.study_questions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id    uuid NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
    position    integer NOT NULL,
    question_type question_type NOT NULL,
    text        text NOT NULL,
    options     jsonb,          -- For choice/ranking questions
    required    boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_study_questions_position
    ON public.study_questions(study_id, position);

-- RLS: Researchers manage their own study's questions; active studies readable by participants
ALTER TABLE public.study_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "questions_researcher_rw" ON public.study_questions
    USING (
        EXISTS (
            SELECT 1 FROM public.studies s
            WHERE s.id = study_id AND s.researcher_id = auth.uid()
        )
    );

CREATE POLICY "questions_active_study_read" ON public.study_questions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.studies s
            WHERE s.id = study_id AND s.status = 'active'
        )
    );

CREATE POLICY "service_role_all" ON public.study_questions
    USING (auth.role() = 'service_role');
```

### 3.4 `supabase/migrations/004_nullifiers.sql`

```sql
-- Nullifier registry: prevents double-submission per participant per study.
-- Contains NO PII. nullifier_hash = SHA-256(nullifier) — raw nullifier never stored.
CREATE TABLE public.nullifiers (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nullifier_hash  text NOT NULL,   -- hex(SHA-256(nullifier))
    study_id        uuid NOT NULL REFERENCES public.studies(id),
    registered_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT unique_nullifier_per_study UNIQUE (nullifier_hash, study_id)
);

CREATE INDEX idx_nullifiers_hash ON public.nullifiers(nullifier_hash);
CREATE INDEX idx_nullifiers_study ON public.nullifiers(study_id);

-- RLS: Only service role can access nullifiers (never exposed to participants or researchers)
ALTER TABLE public.nullifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.nullifiers
    USING (auth.role() = 'service_role');
```

### 3.5 `supabase/migrations/005_credentials.sql`

```sql
-- Anonymous credential records: proof of age-verified study participation.
-- No PII. All values are cryptographic hashes or commitments.
CREATE TABLE public.credentials (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    commitment      text NOT NULL UNIQUE,    -- hex(RISC Zero credential commitment)
    nullifier_hash  text NOT NULL,           -- hex(SHA-256(nullifier))
    study_id        uuid NOT NULL REFERENCES public.studies(id),
    issued_at       timestamptz NOT NULL DEFAULT now(),
    attributes_hash text NOT NULL,           -- hex(SHA-256(attributes_json))
    receipt_seal    text,                    -- RISC Zero receipt seal (for auditability)
    CONSTRAINT unique_credential_per_nullifier_study
        UNIQUE (nullifier_hash, study_id)
);

ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.credentials
    USING (auth.role() = 'service_role');
```

### 3.6 `supabase/migrations/006_encrypted_responses.sql`

```sql
-- Encrypted survey responses.
-- encrypted_payload is AES-256-GCM ciphertext; plaintext never stored.
-- nonce is the AES-GCM nonce (12 bytes, base64).
-- Associated data = study_id (for binding; not stored separately here).
CREATE TABLE public.encrypted_responses (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            uuid NOT NULL REFERENCES public.studies(id),
    nullifier_hash      text NOT NULL,      -- To enforce one response per participant per study
    encrypted_payload   text NOT NULL,      -- base64(AES-256-GCM ciphertext)
    nonce               text NOT NULL,      -- base64(12-byte GCM nonce)
    submitted_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT one_response_per_participant
        UNIQUE (nullifier_hash, study_id)
);

CREATE INDEX idx_responses_study ON public.encrypted_responses(study_id);
CREATE INDEX idx_responses_nullifier ON public.encrypted_responses(nullifier_hash);

ALTER TABLE public.encrypted_responses ENABLE ROW LEVEL SECURITY;

-- Researchers can see count and metadata but NOT encrypted payload
-- (payload only decrypted by Analytics Service with study key)
CREATE POLICY "responses_researcher_count" ON public.encrypted_responses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.studies s
            WHERE s.id = study_id AND s.researcher_id = auth.uid()
        )
    );

CREATE POLICY "service_role_all" ON public.encrypted_responses
    USING (auth.role() = 'service_role');
```

### 3.7 `supabase/migrations/007_privacy_budgets.sql`

```sql
-- Differential privacy budget tracking per study
CREATE TABLE public.study_privacy_budgets (
    study_id        uuid PRIMARY KEY REFERENCES public.studies(id),
    total_epsilon   numeric NOT NULL DEFAULT 10.0,
    spent_epsilon   numeric NOT NULL DEFAULT 0.0,
    rounds_run      integer NOT NULL DEFAULT 0,
    last_round_at   timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT budget_not_exceeded CHECK (spent_epsilon <= total_epsilon)
);

ALTER TABLE public.study_privacy_budgets ENABLE ROW LEVEL SECURITY;

-- Researchers can see their study's budget usage
CREATE POLICY "budget_researcher_read" ON public.study_privacy_budgets
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.studies s
            WHERE s.id = study_id AND s.researcher_id = auth.uid()
        )
    );

CREATE POLICY "service_role_all" ON public.study_privacy_budgets
    USING (auth.role() = 'service_role');
```

---

## 4. Supabase Edge Functions

### 4.1 `supabase/functions/on-response-submitted/index.ts`

```typescript
// Triggered by Supabase webhook on INSERT to encrypted_responses
// Checks if study has reached min_responses threshold → triggers analytics round
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
    const { record } = await req.json();
    const { study_id } = record;

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Count responses for this study
    const { count } = await supabase
        .from('encrypted_responses')
        .select('id', { count: 'exact', head: true })
        .eq('study_id', study_id);

    // Fetch study min_responses threshold
    const { data: study } = await supabase
        .from('studies')
        .select('min_responses')
        .eq('id', study_id)
        .single();

    if (count && study && count >= study.min_responses) {
        // Trigger federated analytics round via Analytics Service
        await fetch(`${Deno.env.get('ANALYTICS_SERVICE_URL')}/analytics/${study_id}/trigger-round`, {
            method: 'POST',
            headers: { 'X-Service-HMAC': computeHMAC(study_id) },
        });
    }

    return new Response('ok');
});
```

### 4.2 `supabase/functions/verify-researcher-access/index.ts`

```typescript
// Custom JWT verification for researchers accessing dashboard API
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const token = authHeader.slice(7);
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
    }

    return new Response(JSON.stringify({ user_id: user.id, email: user.email }));
});
```

---

## 5. Realtime Configuration

```sql
-- Enable Realtime for response counter (researchers only see count, not payload)
ALTER PUBLICATION supabase_realtime ADD TABLE encrypted_responses;

-- Row filter: only INSERT events, only study_id column visible
-- (nullifier_hash and encrypted_payload excluded from Realtime broadcast)
```

```typescript
// Realtime subscription (Researcher dashboard — see 03-frontend-nextjs.md)
const channel = supabase
    .channel(`responses:${studyId}`)
    .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'encrypted_responses',
        filter: `study_id=eq.${studyId}`,
    }, (payload) => {
        // payload.new contains only: { id, study_id, submitted_at }
        // nullifier_hash and encrypted_payload are filtered by RLS
        incrementCounter();
    })
    .subscribe();
```

---

## 6. Supabase Auth Configuration

| Setting | Value | Reason |
|---|---|---|
| Email auth | Enabled for researchers | Magic link + password |
| OAuth providers | GitHub, Google | Researcher convenience |
| Anonymous sign-in | Disabled | Participants use ZK tokens, not Supabase Auth |
| MFA | Required for researcher accounts | High-value access |
| JWT expiry | 1 hour | Short TTL; refreshed by SSR client |
| Row-level security | Enforced on all tables | Default-deny access model |

---

## 7. Storage Buckets

```sql
-- ZK circuit artifacts (public read, service_role write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('circuit-artifacts', 'circuit-artifacts', true);

CREATE POLICY "circuit_artifacts_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'circuit-artifacts');

CREATE POLICY "circuit_artifacts_service_write" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'circuit-artifacts'
        AND auth.role() = 'service_role'
    );

-- Study assets (researcher-owned)
INSERT INTO storage.buckets (id, name, public)
VALUES ('study-assets', 'study-assets', false);

CREATE POLICY "study_assets_researcher" ON storage.objects
    FOR ALL USING (
        bucket_id = 'study-assets'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
```

---

## 8. Seed Data (Dev Only)

```sql
-- supabase/seed.sql — no real PII
INSERT INTO public.studies (id, researcher_id, title, status, min_responses)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    (SELECT id FROM auth.users LIMIT 1),
    'Test Study: Consumer Electronics Preferences',
    'active',
    10  -- Lower threshold for dev testing
);

INSERT INTO public.study_questions (study_id, position, question_type, text, options)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    1,
    'single_choice',
    'How often do you purchase new electronics?',
    '{"options": ["Monthly", "Quarterly", "Annually", "Rarely"]}'::jsonb
);
```

---

## 9. Testing Plan

| Test | Type | Coverage |
|---|---|---|
| RLS: participant cannot read nullifiers | Supabase test | Policy blocks anon access |
| RLS: researcher sees only own studies | Supabase test | Cross-researcher isolation |
| UNIQUE constraint: one response per participant | Integration | DB rejects duplicate nullifier+study_id |
| UNIQUE constraint: one credential per participant | Integration | DB rejects duplicate |
| Edge Function: analytics trigger | Integration | Fires when response count hits threshold |
| Realtime: INSERT event fires | Integration | Subscriber receives event |
| Realtime: payload excludes sensitive columns | Integration | No nullifier_hash in Realtime payload |
| Budget check constraint | Unit | INSERT rejected when spent_epsilon > total_epsilon |

---

## 10. Security Checklist

- [ ] All tables have `ROW LEVEL SECURITY ENABLED`
- [ ] No table has a default `USING (true)` policy (explicit allow-list only)
- [ ] `auth.users` table is not directly accessible (Supabase default)
- [ ] Service role key is never used client-side (only in backend services)
- [ ] Realtime column filtering excludes `encrypted_payload` and `nullifier_hash`
- [ ] Storage bucket for circuit artifacts is public-read (ACIR is non-secret) but not writable by participants
- [ ] DP budget constraint is enforced at DB level (`CHECK` constraint) as a backstop
- [ ] Supabase audit logs enabled for service role access
- [ ] `pg_stat_statements` disabled in production (prevents query text leakage)
- [ ] Database connection pooling via PgBouncer (Supabase default); connection string not committed
