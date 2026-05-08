# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM rust:1.80-bookworm AS builder

WORKDIR /app

# System dependencies: liboqs and barretenberg need cmake + clang
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake clang libclang-dev liboqs-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Cache dependency layer
COPY Cargo.toml Cargo.lock ./
COPY guest/Cargo.toml guest/
RUN mkdir -p src guest/src && \
    echo 'fn main() {}' > src/main.rs && \
    echo 'fn main() {}' > guest/src/main.rs && \
    cargo build --release 2>/dev/null || true && \
    rm -rf src guest/src

# Copy real source
COPY . .

# Build in release mode
ENV RISC0_DEV_MODE=0
RUN cargo build --release

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates liboqs2 \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd --uid 10001 --no-create-home --shell /bin/false zkprover
USER zkprover

WORKDIR /app

COPY --from=builder /app/target/release/zk-proving /app/zk-proving

# Circuits directory is read-only at runtime (VK embedded in binary)
# Mount secrets via Kubernetes secret volume or environment variables

EXPOSE 8080 50051

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
    CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/zk-proving"]
