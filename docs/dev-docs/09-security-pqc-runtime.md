# 09 — Security: PQC + Runtime Enforcement

## Purpose

Define the implementation of the post-quantum cryptography (PQC) migration strategy and Cilium Tetragon runtime enforcement policies for the platform. These layers provide defense against future quantum adversaries and against runtime attacks on deployed containers.

---

## 1. Post-Quantum Cryptography Strategy

### 1.1 Threat: Harvest Now, Decrypt Later

An adversary recording TLS traffic today can store encrypted payloads and decrypt them once cryptographically relevant quantum computers are available (estimated 5–15 year horizon). This is especially relevant for:

- Long-term identity credential metadata
- Research sponsor communications
- RISC Zero receipt archives
- Any data with confidentiality requirements > 5 years

### 1.2 PQC Algorithm Selections (NIST-standardized)

| Purpose | Algorithm | Standard | Library |
|---|---|---|---|
| Key encapsulation (TLS KEM) | ML-KEM-768 | FIPS 203 | Cloudflare CIRCL (Go) |
| Digital signatures (date attestations) | ML-DSA-65 | FIPS 204 | liboqs (Rust, via `oqs` crate) |
| Stateless hash signatures (CI/CD signing) | SLH-DSA-128s | FIPS 205 | liboqs |
| Key wrapping for study keys | ML-KEM-1024 | FIPS 203 | liboqs (Python, via `pyoqs`) |

### 1.3 Hybrid Mode Requirement

All PQC algorithms are deployed in **hybrid mode** — combined with a classical algorithm. This ensures:

- Security degrades gracefully if the PQC algorithm has an undiscovered vulnerability.
- Classical clients that don't support PQC can still negotiate a connection (ECDH fallback).

```
TLS 1.3 KEM negotiation:
  Priority 1: X25519MLKEM768 (X25519 + ML-KEM-768)  ← PQC clients
  Priority 2: X25519                                  ← Classical fallback
  Priority 3: P-256                                   ← Legacy fallback
```

---

## 2. PQC Implementation by Service

### 2.1 Go API Gateway: Hybrid TLS via CIRCL

Already defined in `04-go-api-gateway.md`. Key detail:

```go
// Cloudflare CIRCL registers X25519MLKEM768 as a tls.CurveID
// when the package is imported. No additional configuration needed.
import _ "github.com/cloudflare/circl/kem/hybrid"
```

### 2.2 Rust ZK Service: ML-DSA Date Signing

Already defined in `05-rust-zk-proving-service.md` (`DateSigner`). The `oqs` crate provides Rust bindings to liboqs.

```toml
# services/zk-proving/Cargo.toml
[dependencies]
oqs = { version = "0.9", features = ["ml-dsa", "ml-kem"] }
```

### 2.3 Python Analytics Service: ML-KEM Study Key Wrapping

Study decryption keys are wrapped with ML-KEM-1024 before storage in the secrets manager. This protects keys at rest from future quantum attacks.

```python
# services/analytics/crypto/key_wrapping.py
import pyoqs  # pip install pyoqs
from pyoqs import KEM

def wrap_study_key(
    plaintext_key: bytes,
    recipient_public_key: bytes,
) -> tuple[bytes, bytes]:
    """
    Wrap a study AES key using ML-KEM-1024.
    Returns (ciphertext, shared_secret_hash).
    The recipient decapsulates to recover shared_secret, then derives
    the AES unwrapping key from it.
    """
    kem = KEM("ML-KEM-1024")
    ciphertext, shared_secret = kem.encap_secret(recipient_public_key)
    # XOR plaintext_key with derived wrapping key (from shared_secret)
    wrapping_key = derive_wrapping_key(shared_secret)
    wrapped = bytes(a ^ b for a, b in zip(plaintext_key, wrapping_key[:len(plaintext_key)]))
    return ciphertext, wrapped

def unwrap_study_key(
    ciphertext: bytes,
    wrapped_key: bytes,
    recipient_secret_key: bytes,
) -> bytes:
    kem = KEM("ML-KEM-1024")
    shared_secret = kem.decap_secret(recipient_secret_key, ciphertext)
    wrapping_key = derive_wrapping_key(shared_secret)
    return bytes(a ^ b for a, b in zip(wrapped_key, wrapping_key[:len(wrapped_key)]))

def derive_wrapping_key(shared_secret: bytes) -> bytes:
    from hashlib import sha3_256
    return sha3_256(b"study-key-wrap-v1" + shared_secret).digest() * 2  # 64 bytes
```

---

## 3. Crypto-Agility Configuration

All cipher suite selections are driven by environment configuration, not hard-coded:

```yaml
# infra/helm/api-gateway/values.yaml
crypto:
  tls:
    minVersion: "TLS13"
    kemPreferences:
      - "X25519MLKEM768"   # Primary: hybrid PQC
      - "X25519"           # Fallback: classical
    cipherSuites:
      - "TLS_AES_256_GCM_SHA384"
      - "TLS_CHACHA20_POLY1305_SHA256"
  signatures:
    dateAttestation: "ML-DSA-65"    # Can switch to ML-DSA-87 without code change
  keyWrapping:
    algorithm: "ML-KEM-1024"        # Can switch to ML-KEM-768 for performance
```

---

## 4. Cilium Tetragon Runtime Enforcement

### 4.1 Installation

```bash
# Install Tetragon via Helm
helm repo add cilium https://helm.cilium.io
helm repo update
helm install tetragon cilium/tetragon \
    --namespace kube-system \
    --set tetragon.grpc.address="localhost:54321" \
    --set tetragon.exportFilename="/var/log/tetragon/tetragon.log" \
    --set tetragon.enableK8sAPI=true

# Verify DaemonSet rollout
kubectl rollout status -n kube-system ds/tetragon -w
```

### 4.2 Policy 1: Restrict Secret File Access

Blocks any process inside microservice containers from reading secret files outside expected paths.

```yaml
# infra/tetragon/policies/restrict-secret-access.yaml
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: restrict-secret-file-access
spec:
  kprobes:
    - call: "security_file_open"
      syscall: false
      args:
        - index: 0
          type: "file"
      selectors:
        - matchArgs:
            - index: 0
              operator: "Prefix"
              values:
                - "/etc/secrets"
                - "/run/secrets"
                - "/var/secrets"
          matchNamespaces:
            - namespace: default
          matchActions:
            - action: Signal
              argSig: SIGKILL
          matchPIDs:
            - operator: NotIn
              followForks: true
              isNamespacePID: false
              values: []   # All PIDs restricted
        # Allow the ZK service to access its own secret mount
        - matchBinaries:
            - operator: In
              values:
                - "/usr/local/bin/zk-proving-service"
          matchArgs:
            - index: 0
              operator: "Prefix"
              values:
                - "/run/secrets/zk-proving"
          matchActions:
            - action: Post   # Log only, don't kill
```

### 4.3 Policy 2: Block Shell Execution in Production Containers

```yaml
# infra/tetragon/policies/no-shell-in-containers.yaml
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: no-shell-execution
spec:
  kprobes:
    - call: "sys_execve"
      syscall: true
      args:
        - index: 0
          type: "string"
      selectors:
        - matchArgs:
            - index: 0
              operator: "In"
              values:
                - "/bin/sh"
                - "/bin/bash"
                - "/bin/dash"
                - "/usr/bin/sh"
                - "/usr/bin/bash"
                - "/bin/zsh"
          matchNamespaces:
            - namespace: default
          matchPods:
            - operator: In
              values:
                - "api-gateway"
                - "zk-proving"
                - "analytics"
                - "quantum"
          matchActions:
            - action: Sigkill   # Kill the shell process immediately
```

### 4.4 Policy 3: Monitor Outbound Network from ZK Service

```yaml
# infra/tetragon/policies/zk-service-network.yaml
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: zk-service-outbound-network
spec:
  kprobes:
    - call: "tcp_connect"
      syscall: false
      args:
        - index: 0
          type: "sock"
      selectors:
        - matchPods:
            - operator: In
              values: ["zk-proving"]
          matchArgs:
            - index: 0
              operator: "NotIn"
              # Only allow connections to Redis and Supabase; kill others
              values: []   # Defined by IP ranges of approved services
          matchActions:
            - action: Post    # Log unexpected connections
              rateLimit: "5/minute"
```

### 4.5 Policy 4: Detect Privilege Escalation

```yaml
# infra/tetragon/policies/privilege-escalation.yaml
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: detect-privilege-escalation
spec:
  kprobes:
    - call: "security_task_fix_setuid"
      syscall: false
      return: true
      args:
        - index: 0
          type: "int"    # new UID
      selectors:
        - matchArgs:
            - index: 0
              operator: "Equal"
              values:
                - "0"    # setuid to root
          matchNamespaces:
            - namespace: default
          matchActions:
            - action: Sigkill
```

### 4.6 Policy 5: Log All Process Execution (Audit Trail)

```yaml
# infra/tetragon/policies/process-execution-audit.yaml
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: process-execution-audit
spec:
  # Use built-in process lifecycle events (no kprobe needed)
  # Tetragon emits process_exec and process_exit automatically
  # This TracingPolicy adds binary + argument logging
  kprobes:
    - call: "sys_execve"
      syscall: true
      args:
        - index: 0
          type: "string"   # binary path
        - index: 1
          type: "string_array"  # arguments
      selectors:
        - matchNamespaces:
            - namespace: default
          matchActions:
            - action: Post
              rateLimit: "100/second"
```

---

## 5. Tetragon Event Export Pipeline

```yaml
# infra/tetragon/export-config.yaml
# Export Tetragon JSON events to log aggregation pipeline
exportAllowList:
  - event_set:
      - PROCESS_EXEC
      - PROCESS_EXIT
      - PROCESS_KPROBE
    # Never export from these containers (internal scaffolding)
    pod_regex: "^(?!kube-system).*"

# Forward to OpenTelemetry collector → Arize Phoenix / Grafana Loki
exportDenyList:
  - namespace: "kube-system"   # Exclude infra containers from event stream
```

---

## 6. Secrets Management Architecture

```
AWS Secrets Manager / HashiCorp Vault
      │
      │ (read at startup via IAM role or Vault Agent sidecar)
      ▼
┌─────────────────────────────────────────────────────────────┐
│ Secret              │ Service Consumer │ Rotation Schedule  │
├─────────────────────────────────────────────────────────────┤
│ ML-DSA signing key  │ ZK Proving Svc   │ Monthly            │
│ ZK token secret     │ ZK + Go Gateway  │ Weekly             │
│ Service HMAC secret │ All services     │ Monthly            │
│ Study AES keys      │ Analytics Svc    │ Per-study (never   │
│                     │                  │ rotated mid-study) │
│ IBM Quantum API key │ Quantum Svc      │ Quarterly          │
│ Supabase service key│ Backend services │ Quarterly          │
│ Redis password      │ ZK + Go Gateway  │ Monthly            │
│ gRPC mTLS certs     │ All services     │ Monthly (cert-     │
│                     │                  │ manager auto)      │
└─────────────────────────────────────────────────────────────┘
```

### 6.1 cert-manager for mTLS Certificates

```yaml
# infra/helm/cert-manager/issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: internal-ca
spec:
  ca:
    secretName: internal-ca-key-pair
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: zk-proving-server-cert
  namespace: default
spec:
  secretName: zk-proving-tls
  issuerRef:
    name: internal-ca
    kind: ClusterIssuer
  dnsNames:
    - zk-proving.default.svc.cluster.local
  duration: 720h      # 30 days
  renewBefore: 168h   # Renew 7 days before expiry
```

---

## 7. PQC Migration Roadmap

| Phase | Timeline | Action |
|---|---|---|
| **Phase 1 (Now)** | Current | Hybrid X25519+ML-KEM-768 for TLS; ML-DSA-65 for signatures; liboqs integrated |
| **Phase 2 (6 months)** | 2026-Q4 | Inventory all remaining classical key exchanges; plan certificate migration |
| **Phase 3 (12 months)** | 2027-Q2 | Pure ML-KEM-768 option for PQC-capable clients; classical KEM retained as fallback |
| **Phase 4 (18 months)** | 2027-Q4 | Deprecate non-PQC key exchange for internal mTLS; external TLS retains classical fallback |

---

## 8. Security Monitoring Dashboard

The following Tetragon events feed into Arize Phoenix and Grafana:

| Event | Alert Threshold | Response |
|---|---|---|
| Shell execution in prod container | Any occurrence | Page on-call immediately |
| Privilege escalation attempt | Any occurrence | Auto-kill + page on-call |
| Secret file access by unauthorized binary | Any occurrence | Alert + audit |
| Unexpected outbound connection from ZK service | > 0/hour | Investigate within 1 hour |
| Process exec from `/tmp` or `/dev/shm` | Any occurrence | Page on-call immediately |
| High-rate nullifier check failures | > 100/minute | DDoS alert |

---

## 9. Testing Plan

| Test | Type | Coverage |
|---|---|---|
| Hybrid TLS negotiation | Integration | Client connects with X25519MLKEM768; inspect curve via Wireshark |
| ML-DSA signature verify | Unit | Valid signature accepted; tampered rejected |
| ML-KEM key wrap/unwrap | Unit | Round-trip for study AES key |
| Tetragon shell block | Integration | `kubectl exec sh` into prod container → killed |
| Tetragon secret access | Integration | Access outside allowed path → SIGKILL |
| Tetragon event export | Integration | Events appear in Loki/Phoenix within 5 seconds |
| cert-manager renewal | Integration | Certificate renewed before expiry in test cluster |

---

## 10. Security Checklist

- [ ] NIST-standardized algorithms only: ML-KEM-768/1024, ML-DSA-65, SLH-DSA-128s
- [ ] All PQC in hybrid mode; classical algorithms retained as fallback
- [ ] Cipher suite preferences configuration-driven (not hard-coded)
- [ ] liboqs and CIRCL pinned to specific versions in all lockfiles
- [ ] Tetragon DaemonSet deployed before any application pods
- [ ] All shell-blocking policies tested in staging before production deployment
- [ ] Tetragon events exported to immutable log store (CloudTrail / S3 Object Lock)
- [ ] Secret rotation is automated (Vault Agent sidecar or AWS Secrets Manager rotation Lambda)
- [ ] mTLS certificates renewed automatically by cert-manager
- [ ] Crypto-agility: algorithm change requires only config update + deployment (no code change)
