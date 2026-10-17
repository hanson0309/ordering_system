// Password hashing using Web Crypto PBKDF2. Cloudflare Workers' SubtleCrypto
// implementation caps PBKDF2 at 100,000 iterations and does not expose
// bcrypt/scrypt, so this is the strongest practical option on this runtime.
const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_LENGTH_BITS = 256

function toHex(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

async function derive(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS,
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const derived = await derive(password, salt)
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(derived)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations <= 0) return false
  const salt = fromHex(parts[2])
  const expected = fromHex(parts[3])

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      KEY_LENGTH_BITS,
    ),
  )

  if (derived.length !== expected.length) return false
  // Constant-time comparison.
  let diff = 0
  for (let i = 0; i < derived.length; i++) {
    diff |= derived[i] ^ expected[i]
  }
  return diff === 0
}
