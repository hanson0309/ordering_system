export function buildLocationLink(tenantSlug: string, regionSlug: string, storeSlug: string, origin = window.location.origin) {
  const base = origin.replace(/\/$/, '')
  return `${base}/${tenantSlug}/menu/${regionSlug}/${storeSlug}`
}
