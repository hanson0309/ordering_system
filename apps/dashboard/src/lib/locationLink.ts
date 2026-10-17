export function buildLocationLink(regionSlug: string, locationSlug: string, origin = window.location.origin) {
  return `${origin.replace(/\/$/, '')}/${regionSlug}/${locationSlug}`
}
