export interface StoreInfo {
  name: string
  slug: string
  businessInfo: {
    design?: 'clean' | 'midnight' | 'warm'
    tagline?: string | null
    [key: string]: unknown
  } | null
  paymentQrUrl: string | null
}

export interface Category {
  id: string
  name: string
  sortOrder: number
}

export interface Product {
  id: string
  categoryId: string | null
  name: string
  imageUrl: string | null
  priceSen: number
}

export interface CreateOrderResponse {
  orderId: string
  orderNumber: string
  totalSen: number
  status: string
}

export interface Organization {
  tenantId: string
  slug: string
  name: string
  role: 'owner' | 'admin' | 'staff' | 'viewer'
}

export interface DashboardSummary {
  today: { count: number; totalSen: number }
  statuses: Record<string, { count: number; totalSen: number }>
}

export interface DashboardOrder {
  id: string
  orderNumber: string
  status: string
  totalSen: number
  createdAt: string
  customerName: string
  customerPhone: string
  notificationStatus: string | null
}

export interface DashboardProduct {
  id: string
  categoryId: string | null
  categoryName: string | null
  name: string
  priceSen: number
  isPublic: boolean
  isAvailable: boolean
}

export interface DashboardCategory {
  id: string
  name: string
  sortOrder: number
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? 'unknown_error')
  }
  return body as T
}

export function getStore(storePath: string) {
  return request<StoreInfo>(`/public/${storePath}`)
}

export function getCategories(storePath: string) {
  return request<{ categories: Category[] }>(`/public/${storePath}/categories`)
}

export function getProducts(storePath: string) {
  return request<{ products: Product[] }>(`/public/${storePath}/products`)
}

export interface SubmitOrderInput {
  idempotencyKey: string
  customer: { name: string; phone: string }
  remark?: string
  items: { productId: string; quantity: number }[]
}

export function submitOrder(storePath: string, input: SubmitOrderInput) {
  return request<CreateOrderResponse>(`/public/${storePath}/orders`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function uploadPaymentReceipt(storePath: string, orderId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/public/${storePath}/orders/${orderId}/payment-receipt`, { method: 'POST', body: form })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? 'unknown_error')
  return body as { orderId: string; uploaded: boolean }
}

export function login(email: string, password: string) {
  return request<{ userId: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function logout() {
  return request<{ ok: true }>('/auth/logout', { method: 'POST' })
}

export function getOrganizations() {
  return request<{ organizations: Organization[]; activeTenantId: string | null }>('/me/organizations')
}

export function switchOrganization(tenantId: string) {
  return request<{ tenantId: string; role: Organization['role'] }>('/auth/switch-organization', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  })
}

export function getDashboardSummary() {
  return request<DashboardSummary>('/dashboard/summary')
}

export function getDashboardOrders(params: { status?: string; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return request<{ orders: DashboardOrder[]; pagination: { limit: number; offset: number; total: number } }>(
    `/dashboard/orders${suffix}`,
  )
}

export function updateOrderStatus(orderId: string, status: string) {
  return request<{ orderId: string; status: string }>(`/dashboard/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function retryNotification(orderId: string) {
  return request<{ orderId: string; status: string }>(`/dashboard/orders/${orderId}/notification/retry`, {
    method: 'POST',
  })
}

export function getDashboardProducts() {
  return request<{ products: DashboardProduct[] }>('/dashboard/products')
}

export function getDashboardCategories() {
  return request<{ categories: DashboardCategory[] }>('/dashboard/categories')
}

export function createDashboardCategory(input: { name: string; sortOrder?: number }) {
  return request<{ category: DashboardCategory }>('/dashboard/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createDashboardProduct(input: {
  name: string
  priceSen: number
  categoryId: string | null
  isPublic: boolean
  isAvailable: boolean
}) {
  return request<{ product: DashboardProduct }>('/dashboard/products', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateDashboardProduct(productId: string, input: Partial<{
  name: string
  priceSen: number
  categoryId: string | null
  isPublic: boolean
  isAvailable: boolean
}>) {
  return request<{ productId: string }>(`/dashboard/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export interface DashboardSettings {
  tenant: { id: string; name: string; slug: string }
  settings: { businessInfo: Record<string, unknown> | null }
}

export function getDashboardSettings() {
  return request<DashboardSettings>('/dashboard/settings')
}

export function updateDashboardSettings(input: {
  businessInfo?: Record<string, unknown> | null
}) {
  return request<{ settings: typeof input }>('/dashboard/settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/** priceSen is an integer count of sen (1/100 of a Ringgit). Never use floats for money. */
export function formatSen(priceSen: number): string {
  return `RM ${(priceSen / 100).toFixed(2)}`
}
