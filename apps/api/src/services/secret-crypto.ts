const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function getKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(value: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(secret), encoder.encode(value))
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`
}

export async function decryptSecret(value: string, secret: string) {
  const [version, iv, encrypted] = value.split('.')
  if (version !== 'v1' || !iv || !encrypted) throw new Error('invalid_encrypted_secret')
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, await getKey(secret), fromBase64Url(encrypted))
  return new TextDecoder().decode(decrypted)
}
