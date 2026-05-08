# Frontend Implementation Plan (Next.js)

## Tech Stack
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Vanilla CSS for core UI, Tailwind for utility-first layouts.
- **State**: TanStack Query for server state, Zustand or Context for local UI state.

## Core Features

### 1. Anonymous Onboarding
- Zero-knowledge identity linking.
- Preference collection using privacy-preserving UI components.

### 2. Wellness Marketplace
- "Prescription-like" product filtering.
- Secure checkout integration using Google UCP.

### 3. Education Portal
- Gated content based on verified credentials.
- Interactive wellness modules.

## Security Considerations
- Client-side encryption for sensitive preference data before submission.
- Strict CSP and XSS protection.
- Integration with Supabase Auth (Magic Links, OAuth).

## Directory Structure
```
/src
  /app          # App router pages
  /components   # Shared UI components
  /hooks        # Custom React hooks
  /services     # API client logic
  /store        # Global state management
  /utils        # Helper functions
```
