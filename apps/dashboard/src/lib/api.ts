export interface StoreInfo {
  name: string
  slug: string
  businessInfo: Record<string, unknown> | null
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

export interface DashboardUser {
  id: string
  username: string
  role: 'owner' | 'admin' | 'staff' | 'viewer'
  tenantId?: string
  tenantName?: string
  tenantSlug?: string
  isCurrentUser?: boolean
}

export interface DashboardSummary {
  period: DashboardAnalyticsPeriod
  orderCount: number
  totalSen: number
  averageOrderValueSen: number
  trend: { label: string; orderCount: number; totalSen: number }[]
  topProducts: { name: string; quantity: number; totalSen: number }[]
}

export type DashboardAnalyticsPeriod = 'today' | 'week' | 'month'

export interface DashboardOrder {
  id: string
  orderNumber: string
  status: string
  totalSen: number
  createdAt: string
  customerName: string
  customerPhone: string
  remark: string | null
  regionName: string | null
  branchName: string | null
  hasPaymentReceipt: boolean
  notificationStatus: string | null
  notificationError: string | null
}

export interface DashboardProduct {
  id: string
  categoryId: string | null
  categoryName: string | null
  name: string
  imageUrl: string | null
  priceSen: number
  isPublic: boolean
  isAvailable: boolean
  serviceDate: string | null
  servicePeriod: 'lunch' | 'dinner' | null
  orderCutoffAt: string | null
  weeklyDay: number | null
  weeklyCutoffTime: string | null
  rulePrices: { pricingRuleId: string; priceSen: number }[]
}

export interface DashboardPricingRule {
  id: string
  name: string
  deliveryFeeSen: number
  isActive: boolean
  sortOrder: number
}

export interface DashboardCategory {
  id: string
  name: string
  sortOrder: number
}

export interface DashboardBranch {
  id: string
  regionId: string
  name: string
  slug: string | null
  address: string | null
  isDefault: boolean
  hasPaymentQr: boolean
  pricingRuleId?: string | null
  deliveryPeriod?: 'lunch' | 'dinner' | null
}

export interface DashboardRegion {
  id: string
  tenantId: string
  name: string
  slug: string
  isDefault: boolean
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

export function getStore(slug: string) {
  return request<StoreInfo>(`/public/${slug}`)
}

export function getCategories(slug: string) {
  return request<{ categories: Category[] }>(`/public/${slug}/categories`)
}

export function getProducts(slug: string) {
  return request<{ products: Product[] }>(`/public/${slug}/products`)
}

export interface SubmitOrderInput {
  idempotencyKey: string
  customer: { name: string; phone: string }
  items: { productId: string; quantity: number }[]
}

export function submitOrder(slug: string, input: SubmitOrderInput) {
  return request<CreateOrderResponse>(`/public/${slug}/orders`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function login(username: string, password: string) {
  return request<{ userId: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function logout() {
  return request<{ ok: true }>('/auth/logout', { method: 'POST' })
}

export function getOrganizations() {
  return request<{ organizations: Organization[]; activeTenantId: string | null; isPlatformAdmin: boolean }>('/me/organizations')
}

export interface TelegramAccount {
  id: string
  username: string
  configured: boolean
}

export function getTelegramAccounts() {
  return request<{ accounts: TelegramAccount[] }>('/dashboard/telegram-accounts')
}

export function getTelegramSettings(accountUserId: string) {
  return request<{ configured: boolean; chatId: string }>(`/dashboard/telegram-settings?accountUserId=${encodeURIComponent(accountUserId)}`)
}

export function saveTelegramSettings(input: { accountUserId: string; botToken?: string; chatId: string }) {
  return request<{ configured: boolean; chatId: string }>('/dashboard/telegram-settings', { method: 'PUT', body: JSON.stringify(input) })
}

export function testTelegramSettings(accountUserId: string) {
  return request<{ sent: true }>('/dashboard/telegram-settings/test', { method: 'POST', body: JSON.stringify({ accountUserId }) })
}

export function getDashboardUsers() {
  return request<{ users: DashboardUser[] }>('/dashboard/users')
}

export function createDashboardUser(input: { username: string; password: string; role: 'admin' | 'staff' | 'viewer' }) {
  return request<{ user: DashboardUser; membership: { id: string; tenantId: string; role: DashboardUser['role'] } }>('/dashboard/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateDashboardUser(userId: string, input: { role?: DashboardUser['role']; password?: string }) {
  return request<{ user: DashboardUser; updated: { role: boolean; password: boolean } }>(`/dashboard/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function switchOrganization(tenantId: string) {
  return request<{ tenantId: string; role: Organization['role'] }>('/auth/switch-organization', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  })
}

function branchSuffix(branchId?: string | null) {
  return branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''
}

export function getDashboardRegions() {
  return request<{ regions: DashboardRegion[] }>('/dashboard/regions')
}

export function createDashboardRegion(input: { name: string; slug: string }) {
  return request<{ region: DashboardRegion }>('/dashboard/regions', { method: 'POST', body: JSON.stringify(input) })
}

export function renameDashboardRegion(regionId: string, name: string) {
  return request<{ regionId: string; name: string }>(`/dashboard/regions/${encodeURIComponent(regionId)}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export function getDashboardBranches(regionId?: string | null) {
  return request<{ branches: DashboardBranch[] }>(`/dashboard/branches${regionId ? `?regionId=${encodeURIComponent(regionId)}` : ''}`)
}

export function getDashboardPricingRules() {
  return request<{ pricingRules: DashboardPricingRule[] }>('/dashboard/pricing-rules')
}

export function createDashboardPricingRule(input: { name: string; deliveryFeeSen?: number; isActive?: boolean; sortOrder?: number }) {
  return request<{ pricingRule: DashboardPricingRule }>('/dashboard/pricing-rules', { method: 'POST', body: JSON.stringify(input) })
}

export function updateDashboardPricingRule(pricingRuleId: string, input: Partial<{ name: string; deliveryFeeSen: number; isActive: boolean; sortOrder: number }>) {
  return request<{ pricingRuleId: string }>(`/dashboard/pricing-rules/${pricingRuleId}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function deleteDashboardPricingRule(pricingRuleId: string) {
  return request<{ deleted: true }>(`/dashboard/pricing-rules/${pricingRuleId}`, { method: 'DELETE' })
}

export function assignDashboardBranchPricingRule(branchId: string, pricingRuleId: string | null) {
  return request<{ branchId: string; pricingRuleId: string | null }>(`/dashboard/branches/${branchId}/pricing-rule`, {
    method: 'PATCH', body: JSON.stringify({ pricingRuleId }),
  })
}

export function createDashboardBranch(input: { regionId: string; name: string; slug: string; address?: string | null; deliveryPeriod?: 'lunch' | 'dinner' | null; syncDefault: boolean; makeDefault: boolean }) {
  return request<{ branch: DashboardBranch; syncedDefault: boolean }>('/dashboard/branches', { method: 'POST', body: JSON.stringify(input) })
}

export function renameDashboardBranch(branchId: string, name: string) {
  return request<{ branchId: string; name: string }>(`/dashboard/branches/${encodeURIComponent(branchId)}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export function makeDashboardBranchDefault(branchId: string) {
  return request<{ branchId: string; isDefault: boolean }>(`/dashboard/branches/${branchId}/default`, { method: 'POST' })
}

export async function uploadDashboardPaymentQr(branchId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/dashboard/branches/${branchId}/payment-qr`, { method: 'POST', credentials: 'include', body: form })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? 'unknown_error')
  return body as { branchId: string; paymentQrUrl: string }
}

export function deleteDashboardPaymentQr(branchId: string) {
  return request<{ branchId: string; paymentQrUrl: null }>(`/dashboard/branches/${branchId}/payment-qr`, { method: 'DELETE' })
}

export function getDashboardSummary(branchId?: string | null, period: DashboardAnalyticsPeriod = 'month', regionId?: string | null) {
  const query = new URLSearchParams({ period })
  if (branchId) query.set('branchId', branchId)
  if (regionId) query.set('regionId', regionId)
  return request<DashboardSummary>(`/dashboard/summary?${query.toString()}`)
}

export function getDashboardOrders(params: { status?: string; limit?: number; offset?: number; branchId?: string | null; regionId?: string | null } = {}) {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))
  if (params.branchId) query.set('branchId', params.branchId)
  if (params.regionId) query.set('regionId', params.regionId)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return request<{ orders: DashboardOrder[]; pagination: { limit: number; offset: number; total: number } }>(
    `/dashboard/orders${suffix}`,
  )
}

export function sendDashboardOrderListNow(regionId?: string | null) {
  const suffix = regionId ? `?regionId=${encodeURIComponent(regionId)}` : ''
  return request<{ sent: true; orderCount: number }>(`/dashboard/orders/order-list/send-now${suffix}`, { method: 'POST' })
}

export function getDashboardPaymentReceipt(orderId: string, branchId?: string | null) {
  return `/api/dashboard/orders/${orderId}/payment-receipt${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`
}

export function getDashboardPaymentReceiptDownload(orderId: string, branchId?: string | null) {
  const params = new URLSearchParams({ download: '1' })
  if (branchId) params.set('branchId', branchId)
  return `/api/dashboard/orders/${orderId}/payment-receipt?${params.toString()}`
}

export function updateOrderStatus(orderId: string, status: string, branchId?: string | null) {
  return request<{ orderId: string; status: string }>(`/dashboard/orders/${orderId}/status${branchSuffix(branchId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function retryNotification(orderId: string, branchId?: string | null) {
  return request<{ orderId: string; status: string }>(`/dashboard/orders/${orderId}/notification/retry${branchSuffix(branchId)}`, {
    method: 'POST',
  })
}

export function getDashboardProducts(branchId?: string | null) {
  return request<{ products: DashboardProduct[] }>(`/dashboard/products${branchSuffix(branchId)}`)
}

export function getDashboardCategories(branchId?: string | null) {
  return request<{ categories: DashboardCategory[] }>(`/dashboard/categories${branchSuffix(branchId)}`)
}

export function createDashboardCategory(input: { name: string; sortOrder?: number; branchId?: string | null }) {
  const suffix = branchSuffix(input.branchId)
  const { branchId: _branchId, ...body } = input
  return request<{ category: DashboardCategory }>(`/dashboard/categories${suffix}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteDashboardCategory(categoryId: string, branchId?: string | null) {
  return request<{ deleted: true }>(`/dashboard/categories/${categoryId}${branchSuffix(branchId)}`, {
    method: 'DELETE',
  })
}

export function createDashboardProduct(input: {
  name: string
  imageUrl?: string | null
  priceSen: number
  categoryId: string | null
  isPublic: boolean
  isAvailable: boolean
  kind?: 'add_on' | 'scheduled_meal' | 'recurring_meal'
  serviceDate?: string
  servicePeriod?: 'lunch' | 'dinner'
  cutoffMalaysiaTime?: string
  weeklyDay?: number
  weeklyCutoffTime?: string
  rulePrices?: { pricingRuleId: string; priceSen: number }[]
  branchId?: string | null
}) {
  const suffix = branchSuffix(input.branchId)
  const { branchId: _branchId, ...body } = input
  return request<{ product: DashboardProduct }>(`/dashboard/products${suffix}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateDashboardProduct(productId: string, input: Partial<{
  name: string
  imageUrl: string | null
  priceSen: number
  categoryId: string | null
  isPublic: boolean
  isAvailable: boolean
  kind: 'add_on' | 'scheduled_meal' | 'recurring_meal'
  serviceDate: string
  servicePeriod: 'lunch' | 'dinner'
  cutoffMalaysiaTime: string
  weeklyDay: number
  weeklyCutoffTime: string
  rulePrices: { pricingRuleId: string; priceSen: number }[]
}>, branchId?: string | null) {
  return request<{ productId: string }>(`/dashboard/products/${productId}${branchSuffix(branchId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteDashboardProduct(productId: string, branchId?: string | null) {
  return request<{ deleted: true }>(`/dashboard/products/${productId}${branchSuffix(branchId)}`, {
    method: 'DELETE',
  })
}

export interface DashboardSettings {
  tenant: { id: string; name: string; slug: string }
  settings: { businessInfo: Record<string, unknown> | null; orderListSendTime: string | null }
}

export function getDashboardSettings() {
  return request<DashboardSettings>('/dashboard/settings')
}

export function updateDashboardSettings(input: {
  name?: string
  slug?: string
  businessInfo?: Record<string, unknown> | null
  orderListSendTime?: string | null
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
