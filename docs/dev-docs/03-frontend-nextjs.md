# 03 — Frontend: Next.js

## Purpose

Define the complete implementation of the Next.js 15 frontend, covering the participant portal (anonymous ZK-based participation flow) and the researcher dashboard (study management and analytics visualization).

---

## 1. Technology Choices

| Tool | Version | Reason |
|---|---|---|
| Next.js | 15 (App Router) | Server Components for data fetching; Client Components only where browser APIs needed |
| TypeScript | 5.x | End-to-end type safety |
| Tailwind CSS | 4.x | Utility-first; no runtime style overhead |
| NoirJS | ^1.0.0-beta.20 | In-browser ZK proof generation |
| Barretenberg | ^0.65.0 | WASM proving backend for NoirJS |
| @supabase/ssr | latest | Server-side Supabase auth for researcher sessions |
| SWR | 2.x | Client-side data fetching with revalidation |
| Recharts | 2.x | Researcher analytics charts |
| Zod | 3.x | Runtime validation for API responses |
| OpenTelemetry JS | latest | Frontend traces |

---

## 2. Directory Structure

```
apps/web/
├── app/
│   ├── layout.tsx                   # Root layout: fonts, OTel provider
│   ├── page.tsx                     # Landing page
│   │
│   ├── participate/                 # Participant portal (anonymous)
│   │   ├── layout.tsx               # No auth required; ZK-only
│   │   ├── page.tsx                 # Study discovery
│   │   ├── verify/
│   │   │   └── page.tsx             # Age verification step
│   │   └── [studyId]/
│   │       ├── page.tsx             # Study intake + question flow
│   │       └── complete/
│   │           └── page.tsx         # Completion / incentive page
│   │
│   ├── dashboard/                   # Researcher dashboard (Supabase Auth)
│   │   ├── layout.tsx               # Auth guard; sidebar nav
│   │   ├── page.tsx                 # Overview: studies list, recent activity
│   │   ├── studies/
│   │   │   ├── page.tsx             # Study list + create button
│   │   │   ├── new/
│   │   │   │   └── page.tsx         # Study creation wizard
│   │   │   └── [studyId]/
│   │   │       ├── page.tsx         # Study overview: status, response count
│   │   │       ├── questions/
│   │   │       │   └── page.tsx     # Question builder
│   │   │       ├── cohort/
│   │   │       │   └── page.tsx     # Quantum sampling config
│   │   │       └── results/
│   │   │           └── page.tsx     # Federated analytics results
│   │   └── settings/
│   │       └── page.tsx             # API keys, team members
│   │
│   └── api/
│       ├── verify-age/route.ts      # Proxies to ZK Proving Service
│       ├── issue-credential/route.ts
│       ├── studies/route.ts
│       └── responses/route.ts
│
├── components/
│   ├── ui/                          # Shared primitives (Button, Input, Modal)
│   ├── participate/
│   │   ├── AgeVerificationForm.tsx  # Date-of-birth picker + proof generation
│   │   ├── ProofProgress.tsx        # WASM proof generation progress bar
│   │   └── StudyQuestion.tsx        # Single question renderer
│   └── dashboard/
│       ├── StudyCard.tsx
│       ├── ResponseChart.tsx        # Recharts wrapper for DP results
│       ├── CohortConfig.tsx         # Quantum sampling parameter UI
│       └── LiveCounter.tsx          # Supabase Realtime response counter
│
├── lib/
│   ├── zk/
│   │   ├── useAgeProof.ts           # NoirJS hook
│   │   ├── verifyAge.ts             # API client for /api/verify-age
│   │   └── sessionToken.ts          # In-memory ZK session token store
│   ├── supabase/
│   │   ├── client.ts                # Browser Supabase client
│   │   └── server.ts                # Server-side Supabase client (cookies)
│   ├── api/
│   │   ├── studies.ts               # API client for studies CRUD
│   │   └── responses.ts             # API client for response submission
│   └── telemetry/
│       └── otel.ts                  # OpenTelemetry Web SDK setup
│
├── circuits/
│   └── age_proof.json               # Compiled ACIR artifact (bundled at build time)
│
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## 3. Participant Portal Flow

### 3.1 Route: `/participate/verify`

This is the critical ZK age verification page. It runs entirely client-side.

```tsx
// app/participate/verify/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AgeVerificationForm } from '@/components/participate/AgeVerificationForm';
import { generateAgeProof } from '@/lib/zk/useAgeProof';
import { submitAgeProof } from '@/lib/zk/verifyAge';
import { storeSessionToken } from '@/lib/zk/sessionToken';

type Step = 'form' | 'proving' | 'submitting' | 'done' | 'error';

export default function VerifyAgePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studyId = searchParams.get('study') ?? '';

  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(
    birthYear: number,
    birthMonth: number,
    birthDay: number,
  ) {
    try {
      // 1. Fetch server-signed date attestation
      const attestRes = await fetch('/api/date-attestation?study=' + studyId);
      const attestation = await attestRes.json();

      // 2. Generate ZK proof in browser (WASM — may take 2-5 seconds)
      setStep('proving');
      const proofResult = await generateAgeProof(
        birthYear, birthMonth, birthDay, studyId, attestation,
      );

      // 3. Submit proof to server
      setStep('submitting');
      const token = await submitAgeProof(proofResult, studyId, attestation);

      // 4. Store token in memory (never in localStorage or cookies)
      storeSessionToken(studyId, token);

      setStep('done');
      router.push(`/participate/${studyId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setStep('error');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-2xl font-bold">Age Verification</h1>
        <p className="text-sm text-gray-600">
          We use zero-knowledge proofs to verify you are 18+.
          Your exact age is never shared with us.
        </p>

        {step === 'form' && (
          <AgeVerificationForm onSubmit={handleSubmit} />
        )}
        {step === 'proving' && (
          <div>
            <p>Generating proof in your browser... (this takes a few seconds)</p>
            {/* ProofProgress shows circuit execution steps */}
          </div>
        )}
        {step === 'submitting' && <p>Verifying proof...</p>}
        {step === 'error' && (
          <p className="text-red-500">{error}</p>
        )}
      </div>
    </main>
  );
}
```

### 3.2 Session Token In-Memory Store

```typescript
// lib/zk/sessionToken.ts
// IMPORTANT: Tokens are stored only in module-level memory.
// They are lost on page refresh, which is intentional privacy behavior.

const tokenStore = new Map<string, { token: string; expiresAt: number }>();

export function storeSessionToken(studyId: string, token: string): void {
  const expiresAt = Date.now() + 55 * 60 * 1000; // 55 minutes (token TTL is 60 min)
  tokenStore.set(studyId, { token, expiresAt });
}

export function getSessionToken(studyId: string): string | null {
  const entry = tokenStore.get(studyId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tokenStore.delete(studyId);
    return null;
  }
  return entry.token;
}
```

### 3.3 Route: `/participate/[studyId]`

```tsx
// app/participate/[studyId]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSessionToken } from '@/lib/zk/sessionToken';
import { StudyQuestion } from '@/components/participate/StudyQuestion';

export default function StudyPage() {
  const { studyId } = useParams<{ studyId: string }>();
  const router = useRouter();
  const token = getSessionToken(studyId);

  useEffect(() => {
    if (!token) {
      // No valid session — redirect to verification
      router.replace(`/participate/verify?study=${studyId}`);
    }
  }, [token, studyId, router]);

  // Fetch questions from Server Component via API route
  // (no PII in the request — only study_id)
  const [questions, setQuestions] = useState([]);
  useEffect(() => {
    fetch(`/api/studies/${studyId}/questions`)
      .then(r => r.json())
      .then(setQuestions);
  }, [studyId]);

  async function handleSubmit(responses: Record<string, string>) {
    await fetch('/api/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ZK-Token': token!, // Bearer token in custom header, not Authorization
      },
      body: JSON.stringify({ study_id: studyId, responses }),
    });
    router.push(`/participate/${studyId}/complete`);
  }

  if (!token) return null; // Redirect in progress

  return (
    <form onSubmit={e => {
      e.preventDefault();
      // Collect form data and call handleSubmit
    }}>
      {questions.map((q: any) => (
        <StudyQuestion key={q.id} question={q} />
      ))}
      <button type="submit">Submit Responses</button>
    </form>
  );
}
```

---

## 4. Researcher Dashboard

### 4.1 Auth Guard (Server Component)

```tsx
// app/dashboard/layout.tsx
import { createServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-64 border-r p-4">
        {/* Sidebar navigation */}
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

### 4.2 Study Results Page (Federated Analytics)

```tsx
// app/dashboard/studies/[studyId]/results/page.tsx
import { createServerClient } from '@/lib/supabase/server';
import { ResponseChart } from '@/components/dashboard/ResponseChart';

export default async function StudyResultsPage({
  params,
}: {
  params: { studyId: string };
}) {
  const supabase = createServerClient();

  // Fetch differentially private aggregates from Analytics Service
  // (via Go API Gateway — all raw responses stay in federated system)
  const res = await fetch(
    `${process.env.INTERNAL_API_URL}/analytics/${params.studyId}/results`,
    {
      headers: { 'X-Service-HMAC': generateServiceHmac('analytics', params.studyId) },
      next: { revalidate: 60 }, // Cache for 60 seconds
    },
  );
  const results = await res.json();

  return (
    <div>
      <h1>Study Results</h1>
      <p className="text-sm text-gray-500">
        Results are differentially private (ε={results.epsilon_budget_used}).
        Minimum {results.min_cohort_size} responses required before results are shown.
      </p>
      {results.questions.map((q: any) => (
        <ResponseChart key={q.id} question={q} data={q.aggregate_distribution} />
      ))}
    </div>
  );
}
```

### 4.3 Live Response Counter (Supabase Realtime)

```tsx
// components/dashboard/LiveCounter.tsx
'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

export function LiveCounter({ studyId }: { studyId: string }) {
  const [count, setCount] = useState<number | null>(null);
  const supabase = createBrowserClient();

  useEffect(() => {
    // Subscribe to INSERT events on encrypted_responses for this study
    const channel = supabase
      .channel(`responses:${studyId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'encrypted_responses',
        filter: `study_id=eq.${studyId}`,
      }, () => {
        setCount(c => (c ?? 0) + 1);
      })
      .subscribe();

    // Fetch initial count
    supabase
      .from('encrypted_responses')
      .select('id', { count: 'exact', head: true })
      .eq('study_id', studyId)
      .then(({ count }) => setCount(count ?? 0));

    return () => { supabase.removeChannel(channel); };
  }, [studyId, supabase]);

  return (
    <div className="text-2xl font-bold">
      {count === null ? '—' : count} responses
    </div>
  );
}
```

---

## 5. API Routes

### 5.1 `/api/verify-age/route.ts`

```typescript
// app/api/verify-age/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Proxy to Go API Gateway (internal network)
  const res = await fetch(`${process.env.API_GATEWAY_URL}/zk/verify-age`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    return NextResponse.json(err, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
```

### 5.2 `/api/responses/route.ts`

```typescript
// app/api/responses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const SubmitSchema = z.object({
  study_id: z.string().uuid(),
  responses: z.record(z.string()),
});

export async function POST(req: NextRequest) {
  const zkToken = req.headers.get('X-ZK-Token');
  if (!zkToken) {
    return NextResponse.json({ message: 'Missing ZK token' }, { status: 401 });
  }

  const body = SubmitSchema.parse(await req.json());

  const res = await fetch(`${process.env.API_GATEWAY_URL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${zkToken}`,
    },
    body: JSON.stringify(body),
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
```

---

## 6. Environment Variables

```bash
# .env.local (never commit)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # Server-side only

# Internal service URLs (not exposed to browser)
API_GATEWAY_URL=http://api-gateway:8080
INTERNAL_API_URL=http://api-gateway:8080/internal

# Feature flags
NEXT_PUBLIC_ZK_THREADS=4               # Barretenberg WASM thread count
NEXT_PUBLIC_MIN_COHORT_FOR_RESULTS=50  # Minimum responses before showing aggregates
```

---

## 7. Performance Considerations

| Concern | Approach |
|---|---|
| WASM prover size (~40MB) | Lazy-loaded only on `/participate/verify` route; not in initial bundle |
| Proof generation time | Show progress steps (witness generation → proof) to reduce perceived wait |
| Barretenberg thread count | Configurable via `NEXT_PUBLIC_ZK_THREADS`; default 4 (SharedArrayBuffer required) |
| SharedArrayBuffer | Requires COOP/COEP headers; set in `next.config.ts` for `/participate` routes |
| Dashboard data freshness | SWR with 60s revalidation; Realtime for response count only |
| Server Component caching | Analytics results cached 60s via `next: { revalidate: 60 }` fetch option |

### Required Headers for WASM Multithreading

```typescript
// next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: '/participate/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};
```

---

## 8. Testing Plan

| Test | Tool | Coverage |
|---|---|---|
| Age verification E2E | Playwright | Full browser flow: input DOB, generate proof, get token |
| Study submission E2E | Playwright | Submit response with valid ZK token |
| Token expiry handling | Playwright | Expired token → redirect to /verify |
| Auth guard | Jest + @testing-library | Dashboard redirects unauthenticated users |
| Live counter | Jest + Supabase mock | Realtime subscription increments count |
| API route validation | Jest | Zod schema rejects malformed requests |
| WASM SharedArrayBuffer | Playwright | Verify COOP/COEP headers present on /participate |
