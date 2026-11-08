const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/

export function normalizeUsername(value: string): string | null {
  const username = value.trim().toLowerCase()
  return USERNAME_PATTERN.test(username) ? username : null
}
