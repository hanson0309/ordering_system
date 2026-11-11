export function buildLocationLink(tenantSlug: string, regionSlug: string, storeSlug: string, origin = window.location.origin) {
  const url = new URL(origin)
  if (import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '5174') {
    url.port = '5175'
  }
  const base = url.origin.replace(/\/$/, '')
  return `${base}/${tenantSlug}/menu/${regionSlug}/${storeSlug}`
}
