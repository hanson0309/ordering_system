export interface Env {
  DB: D1Database
  DOCS_BUCKET: R2Bucket
  ENVIRONMENT: string
  PUBLIC_TENANT_SLUG?: string
  TELEGRAM_SETTINGS_ENCRYPTION_KEY?: string
}

export interface AuthContext {
  userId: string
  isPlatformAdmin: boolean
  /** Tenant authorized for the current session, resolved server-side. */
  activeTenantId: string | null
}

export interface TenantContext {
  tenantId: string
  role: 'owner' | 'admin' | 'staff' | 'viewer'
}

// Resolved from the public storefront slug. Deliberately a separate shape
// from TenantContext (no `role` — there is no authenticated membership here).
export interface PublicTenantContext {
  id: string
  slug: string
  name: string
}

export interface PublicBranchContext {
  id: string
  slug: string
  name: string
  regionSlug: string
  regionId: string
  deliveryPeriod: 'lunch' | 'dinner' | null
}

// Hono variable map used across the dashboard/admin route groups.
export type AppVariables = {
  auth: AuthContext
  tenant: TenantContext
  publicTenant: PublicTenantContext
  publicBranch: PublicBranchContext | null
}
