# System Architecture Plan

## High-Level Overview

The Sexual Wellness Commerce Platform is designed as a federated microservices architecture, prioritizing privacy, security, and high-performance commerce.

### Core Components

1.  **Client Layer (Next.js)**: A responsive web interface for users to browse products, manage health/education preferences, and interact with safety modules.
2.  **API Gateway (Go)**: Centralized entry point handling routing, authentication (via Supabase), and rate limiting.
3.  **Compute Layer (Heterogeneous Microservices)**:
    - **Rust Services**: Safety modules and high-assurance logic running in Wasm/Fermyon Spin.
    - **Python Services**: AI-driven research panels and agentic orchestration (LangGraph).
    - **Go Services**: Standard business logic and high-throughput commerce operations.
    - **Quantum Services**: QASM-based simulations for complex preference matching.
4.  **Data & Identity (Supabase + ZKP)**:
    - Supabase for persistence and basic auth.
    - Noir/RISC Zero for private credential verification without data exposure.

## Communication Patterns

- **Synchronous**: REST/gRPC for internal service-to-service communication.
- **Asynchronous**: Message queues (Redis/RabbitMQ) for long-running AI tasks or quantum simulations.
- **Data Flow**: User -> Gateway -> Service -> Database/ZKP-Validator.

## Deployment Strategy

- **Containerization**: Docker for all services.
- **Orchestration**: Kubernetes for scaling and management.
- **Edge**: Next.js deployed on Vercel or similar; Wasm modules at the edge via Fermyon Spin.
