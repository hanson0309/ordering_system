// Opaque session tokens. The raw token is only ever held by the client
// (as an HttpOnly cookie); the DB stores a SHA-256 hash of it so a leaked
// database never yields usable session tokens.
export const SESSION_COOKIE_NAME = 'ordering_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
