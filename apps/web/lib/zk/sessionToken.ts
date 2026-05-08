// Tokens stored in module-level memory only.
// Intentionally lost on page refresh — this is a privacy feature, not a bug.

const tokenStore = new Map<string, { token: string; expiresAt: number }>();

export function storeSessionToken(studyId: string, token: string): void {
  const expiresAt = Date.now() + 55 * 60 * 1000; // 55 min (server TTL is 60 min)
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

export function clearSessionToken(studyId: string): void {
  tokenStore.delete(studyId);
}
