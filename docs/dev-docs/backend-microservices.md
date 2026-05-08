# Backend Microservices Plan

## 1. Core Services (Go)
- **Purpose**: API Gateway, Order Management, User Profiles.
- **Framework**: Gin or Fiber.
- **Tools**: `sqlc` for type-safe database access to Supabase/PostgreSQL.

## 2. Safety & Assurance (Rust)
- **Purpose**: Safety modules, ZKP verification logic.
- **Runtime**: Fermyon Spin for serverless Wasm execution.
- **Libraries**: `noir_rs` for Noir circuit verification, `risc0-zkvm`.

## 3. AI & Research (Python)
- **Purpose**: Market research panels, agentic search for wellness products.
- **Framework**: FastAPI.
- **Agentic Stack**: LangGraph for workflow orchestration, CrewAI for multi-agent collaboration.
- **Observability**: Arize Phoenix for tracing and evaluation.

## 4. Quantum Simulation (QASM)
- **Purpose**: Complex matching algorithms for anonymous preference clusters.
- **Tools**: Qiskit (Python-based) for circuit design, NVIDIA CUDA-Q for high-performance simulation.
- **Interface**: Python microservice wrapping QASM circuits.

## Inter-Service Communication
- gRPC for low-latency internal calls.
- Protobuf definitions shared across Go, Rust, and Python.
