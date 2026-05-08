# Anonymous Adult Market Research Panel

> **Verified adults participate in market research studies via ZK age proofs and anonymous credentials — no PII stored, no identity linkage.**

---

## Overview

This repository is part of the [quantumworld-dpdns-io](https://github.com/quantumworld-dpdns-io) Wild SaaS & Tech Development initiative.

The Anonymous Adult Market Research Panel enables brands and researchers to run high-quality adult consumer studies while guaranteeing participant anonymity. Participants prove they are adults without revealing their identity, receive unlinkable anonymous credentials, join studies, and submit responses — all without any personally identifiable information ever touching the platform.

The system combines **zero-knowledge proofs**, **post-quantum cryptography**, **federated learning**, and **quantum-enhanced randomization** into a privacy-first research infrastructure that is audit-ready and regulatorily defensible.

---

## Key Features

| Feature | Description |
|---|---|
| ZK Age Verification | Participants prove age ≥ 18 using Noir circuits + RISC Zero zkVM — no birth date transmitted |
| Anonymous Credentials | One-time unlinkable credential tokens issued per study session |
| No PII Storage | Supabase stores only ZK nullifiers and encrypted payloads; no name, email, or IP logged |
| Privacy-Preserving Analytics | Survey insights computed via federated learning (Flower); raw responses never centralized |
| Post-Quantum Security | All key establishment uses ML-KEM (FIPS 203); signatures use ML-DSA (FIPS 204) |
| Quantum Randomness | QASM / Qiskit-backed true random panel sampling for unbiased cohort selection |
| Runtime Security | Cilium Tetragon eBPF runtime enforcement on all microservice containers |
| Researcher Dashboard | Next.js dashboard for study configuration, cohort targeting (no-PII attributes), and results |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Participants                              │
│          Browser  ←→  Next.js Frontend (Vercel/Edge)            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS + ML-KEM hybrid TLS
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Go API Gateway (Chi + gRPC)                    │
│   Auth · Rate-limit · Request routing · JWT + ZK token verify    │
└──────┬──────────────┬───────────────┬───────────────┬───────────┘
       │              │               │               │
       ▼              ▼               ▼               ▼
┌──────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐
│  Rust ZK │  │  Python    │  │  Python    │  │  Fermyon Spin  │
│  Proving │  │  Analytics │  │  Quantum   │  │  WASM Edge     │
│  Service │  │  + Flower  │  │  (Qiskit)  │  │  Microservice  │
│ (RISC0)  │  │  Federated │  │  QASM RNG  │  │  (Lightweight  │
│  + Noir  │  │  Learning  │  │  Sampling  │  │   Handlers)    │
└──────────┘  └────────────┘  └────────────┘  └────────────────┘
       │              │               │               │
       └──────────────┴───────────────┴───────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Supabase (PostgreSQL + RLS)                      │
│  studies · nullifiers · encrypted_responses · cohort_configs     │
│  Storage: ZK circuit artifacts · Supabase Auth: researcher login  │
└─────────────────────────────────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
    ┌──────────┐     ┌───────────┐     ┌───────────┐
    │  Qdrant  │     │  DuckDB   │     │  Redis /  │
    │  Vector  │     │ Analytics │     │ Dragonfly │
    │    DB    │     │  Engine   │     │   Cache   │
    └──────────┘     └───────────┘     └───────────┘
```

---

## Tech Stack

### Frontend
| Tool | Version | Role |
|---|---|---|
| **Next.js** | 15 (App Router) | Primary UI — researcher dashboard, participant portal, SSR/SSG pages |
| TypeScript | 5.x | Type-safe client and server components |
| Tailwind CSS | 4.x | Utility-first styling |
| NoirJS | latest | In-browser ZK proof generation for age verification circuit |
| OpenTelemetry JS | latest | Frontend traces sent to Phoenix/Weave |

### Backend Microservices
| Service | Language | Framework | Role |
|---|---|---|---|
| **API Gateway** | **Go** | Chi + gRPC-gateway | Central ingress, auth, routing, rate-limiting, ML-KEM TLS termination |
| **ZK Proving Service** | **Rust** | RISC Zero zkVM + Axum | Age proof verification, anonymous credential issuance, nullifier registry |
| **Analytics Service** | **Python** | FastAPI + Flower | Federated survey analytics, aggregation server, differential privacy |
| **Quantum Service** | **Python** | FastAPI + Qiskit | QASM-based true random panel sampling, quantum-enhanced randomization |
| **Edge Handlers** | **WASM** | Fermyon Spin | Lightweight request handlers at edge nodes (proof submission, ping) |

### Zero-Knowledge Proof Stack
| Tool | Role |
|---|---|
| **Noir** (Aztec) | DSL for age predicate circuits (`age >= 18` without revealing birthdate); compiles to ACIR |
| **Barretenberg** | Default Noir proving backend; generates SNARK proofs in-browser and server-side |
| **RISC Zero zkVM** | General-purpose zkVM for verifiable server-side computation (credential issuance logic) |
| **NoirJS** | JavaScript bindings — runs Noir proving in the participant's browser (no server sees private inputs) |

### Database & Storage
| Tool | Role |
|---|---|
| **Supabase** | Managed PostgreSQL with Row-Level Security (RLS); primary data store |
| **Supabase Auth** | Researcher authentication (OAuth + magic link); participants are anonymous |
| **Supabase Storage** | ZK circuit artifacts, study media assets |
| **Supabase Realtime** | Live study progress updates to researcher dashboard |
| **Redis / DragonflyDB** | Session cache, rate-limit counters, nullifier bloom filter |
| **Qdrant** | Vector database for survey question embeddings; semantic search across study corpus |
| **DuckDB** | Embedded analytical queries over aggregated (non-PII) Arrow-format result exports |
| **Apache Arrow** | In-memory columnar format for fast analytics data interchange between services |

### Privacy & Cryptography
| Tool | Role |
|---|---|
| **liboqs** (Open Quantum Safe) | Post-quantum algorithm library (ML-KEM-768, ML-DSA-65) |
| **Cloudflare CIRCL** | Go PQC bindings for API gateway hybrid key establishment |
| **Hybrid TLS 1.3** | X25519 + ML-KEM-768 combined — classical + post-quantum key establishment |
| **Flower (flwr)** | Federated learning framework; survey analytics computed without raw response centralization |

### Security & Observability
| Tool | Role |
|---|---|
| **Cilium Tetragon** | eBPF runtime enforcement — process execution, file access, network anomaly detection |
| **OpenTelemetry** | Distributed tracing across all microservices |
| **Arize Phoenix** | LLM / AI observability, trace visualization, prompt iteration tracking |
| **Weights & Biases Weave** | ML experiment tracking for federated model training runs |

### Quantum Computing
| Tool | Role |
|---|---|
| **Qiskit** | IBM Quantum SDK — QASM circuit construction, transpilation, execution |
| **NVIDIA CUDA-Q** | GPU-accelerated quantum circuit simulation for large sampling circuits |
| **OpenQASM 3** | Circuit serialization format for panel sampling circuits |

### AI & Orchestration
| Tool | Role |
|---|---|
| **LangGraph** | Stateful multi-step agent workflows for study design assistance |
| **CrewAI** | Role-based AI agent crew for automated study QA and analysis narration |
| **Model Context Protocol (MCP)** | Standard integration layer connecting AI agents to internal tools and Supabase |
| **Claude API** | Sonnet/Opus models for study question generation, response analysis, report drafting |

### Infrastructure
| Tool | Role |
|---|---|
| **Fermyon Spin** | WASM serverless edge microservices (SpinKube for Kubernetes deployment) |
| **Apache Teaclave** | Confidential computing TEE for the most sensitive credential issuance computations |
| **WASI 0.3** | Async-capable WASM component model used by Spin edge handlers |
| **GitHub Actions** | CI/CD pipelines: Noir circuit tests, Rust zkVM tests, Go/Python service tests |

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/quantumworld-dpdns-io/anonymous-adult-market-research-panel.git
cd anonymous-adult-market-research-panel

# Install language toolchains
noirup                          # Noir/Nargo (ZK circuits)
cargo install cargo-risczero    # RISC Zero zkVM
# Go 1.23+, Python 3.12+, Node.js 22+ required

# Copy and configure environment variables
cp .env.example .env.local
# Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# Fill in: RISC_ZERO_API_KEY (for remote proving), OPENAI_API_KEY or ANTHROPIC_API_KEY

# Start the full dev stack
docker compose up -d            # Supabase local, Redis, Qdrant, Tetragon
cd services/api-gateway && go run . &
cd services/zk-proving && cargo run &
cd services/analytics && uvicorn main:app --reload &
cd apps/web && npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the researcher dashboard.
Open [http://localhost:3000/participate](http://localhost:3000/participate) to see the participant portal.

---

## Project Structure

```
.
├── apps/
│   └── web/                    # Next.js 15 frontend (App Router, TypeScript)
│       ├── app/                # Route segments: dashboard, participate, studies
│       ├── components/         # Shared UI components
│       └── lib/                # NoirJS client, API clients, ZK helpers
│
├── services/
│   ├── api-gateway/            # Go: Chi router, gRPC gateway, ML-KEM TLS
│   ├── zk-proving/             # Rust: RISC Zero host+guest, Axum HTTP server
│   ├── analytics/              # Python: FastAPI + Flower federated server
│   └── quantum/                # Python: Qiskit QASM sampling circuits
│
├── circuits/
│   └── age-proof/              # Noir circuit: age >= 18 predicate
│       ├── src/main.nr         # Circuit definition
│       └── Nargo.toml
│
├── supabase/
│   ├── migrations/             # PostgreSQL schema migrations
│   ├── seed.sql                # Dev seed data (no PII)
│   └── functions/              # Supabase Edge Functions (Deno)
│
├── infra/
│   ├── docker-compose.yml      # Local dev stack
│   ├── helm/                   # Kubernetes Helm charts
│   ├── tetragon/               # Cilium Tetragon TracingPolicy CRDs
│   └── spin/                   # Fermyon Spin app manifests
│
├── docs/
│   ├── CONTRIBUTING.md
│   └── dev-docs/               # Detailed implementation plans (see below)
│
└── tests/
    ├── integration/            # Cross-service integration tests
    ├── e2e/                    # Playwright end-to-end tests
    └── circuits/               # Noir circuit tests (nargo test)
```

### Implementation Plans (`docs/dev-docs/`)

| Document | Coverage | Status |
|---|---|---|
| `00-architecture-overview.md` | System design, service boundaries, data flows, threat model | Design doc |
| `01-zk-age-verification.md` | Noir circuit design, NoirJS browser proving, server verification | Implemented |
| `02-anonymous-credentials.md` | Credential issuance with RISC Zero, nullifier registry, unlinkability | Implemented |
| `03-frontend-nextjs.md` | Next.js app structure, participant portal, researcher dashboard | Implemented |
| `04-go-api-gateway.md` | Go service: routing, gRPC, PQC TLS, auth middleware | Implemented |
| `05-rust-zk-proving-service.md` | Rust RISC Zero host/guest, Axum API, Noir verifier integration | Implemented |
| `06-python-analytics-service.md` | Federated learning with Flower, differential privacy, result aggregation | Implemented |
| `07-quantum-sampling-service.md` | Qiskit QASM circuits for panel randomization, CUDA-Q simulation | Implemented |
| `08-supabase-database-design.md` | Schema, RLS policies, Edge Functions, Realtime setup | Implemented |
| `09-security-pqc-runtime.md` | PQC migration, Tetragon policies, secrets management | Implemented |
| `10-federated-learning-design.md` | Flower federation topology, aggregation strategy, privacy accounting | Implemented |
| `PROGRESS.md` | Agent implementation log, follow-up items, boot instructions | Live tracker |

---

## Implementation Status

> **171 files scaffolded across all services** — 2026-05-08, via 8 parallel implementation agents.

| Service | Path | Files | Notes |
|---|---|---|---|
| Noir ZK Circuit | `circuits/age-proof/` | 5 | 9 nargo tests; `nargo compile` required before dev |
| Rust ZK Proving Service | `services/zk-proving/` | 27 | Axum + Tonic + RISC Zero + ML-DSA-65; 3 follow-ups |
| Next.js Frontend | `apps/web/` | 40 | App Router; ZK prove flow; researcher dashboard |
| Go API Gateway | `services/api-gateway/` | 26 | CIRCL PQC TLS; gRPC; rate-limit; OTel |
| Python Analytics + FL | `services/analytics/` | 22 | Flower DPFedAvg; Gaussian DP; DuckDB cache |
| Python Quantum Sampling | `services/quantum/` | 19 | Qiskit Aer/IBM/CUDA-Q; chi-squared tests |
| Supabase DB + Functions | `supabase/` | 13 | 7 migrations; 2 Edge Functions; column-level RLS |
| Infra + Security | `infra/` + `.github/` | 19 | docker-compose; 5 Tetragon policies; 3 CI workflows |

### Outstanding Follow-Ups Before First Boot

1. **Copy circuit artifact**: `nargo compile` in `circuits/age-proof/`, then copy `target/age_proof.json` → `apps/web/circuits/` and `.vk` → `services/zk-proving/circuits/`
2. **Generate gRPC stubs**: `cd services/api-gateway && make proto` (requires protoc + Go plugins)
3. **Wire RISC Zero timestamp**: host-side `issued_at` injection into guest journal (`services/zk-proving/src/handlers/issue_credential.rs`)
4. **Complete Axum+Tonic dual server**: finish TODO in `services/zk-proving/src/main.rs`

See [`docs/dev-docs/PROGRESS.md`](docs/dev-docs/PROGRESS.md) for full agent logs and boot instructions.

---

## Contributing

Please read [CONTRIBUTING.md](docs/CONTRIBUTING.md) before opening a pull request.

---

## License

[MIT](LICENSE)
