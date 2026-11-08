export function getPublicStorePath(tenantSlug?: string, regionSlug?: string, storeSlug?: string) {
  return tenantSlug && regionSlug && storeSlug ? `${tenantSlug}/${regionSlug}/${storeSlug}` : ''
}

export function getStoreUrlBase(tenantSlug?: string, regionSlug?: string, storeSlug?: string) {
  return tenantSlug && regionSlug && storeSlug ? `/${tenantSlug}/menu/${regionSlug}/${storeSlug}` : ''
}
