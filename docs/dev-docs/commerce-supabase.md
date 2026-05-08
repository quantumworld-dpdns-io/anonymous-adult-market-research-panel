# Commerce & Database Plan (Supabase)

## Supabase Integration

### 1. Database (PostgreSQL)
- **Schemas**:
    - `public`: Basic product info, public education content.
    - `private`: Encrypted user metadata (linked via ZK hashes).
    - `commerce`: Orders, inventory, and transaction history.
- **Row Level Security (RLS)**: Strict policies to ensure users only access their own (anonymized) data.

### 2. Authentication
- Use Supabase Auth for session management.
- Custom claims to store ZK proof verification status.

### 3. Edge Functions
- Use Deno-based Edge Functions for lightweight logic and Supabase integration.

## Marketplace Logic (Google UCP)

### 1. Protocol Implementation
- Adopt **Google Universal Commerce Protocol (UCP)** for standardized product schemas and transaction flows.
- Ensure interoperability with third-party wellness providers.

### 2. "Prescription-Like" Flow
1. User provides preference data (encrypted).
2. Safety module (Rust) validates data against wellness criteria.
3. System suggests "prescribed" products/content.
4. Transaction executed via UCP-compliant checkout.
