import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ApiError,
  createDashboardCategory,
  createDashboardBranch,
  createDashboardProduct,
  createDashboardStore,
  getDashboardCategories,
  deleteDashboardCategory,
  getDashboardBranches,
  getDashboardOrders,
  sendDashboardOrderListNow,
  getDashboardProducts,
  deleteDashboardProduct,
  getDashboardSettings,
  getTelegramAccounts,
  getTelegramSettings,
  saveTelegramSettings,
  testTelegramSettings,
  getDashboardUsers,
  createDashboardUser,
  updateDashboardUser,
  getDashboardSummary,
  getOrganizations,
  logout,
  switchOrganization,
  updateDashboardProduct,
  makeDashboardBranchDefault,
  updateDashboardSettings,
  retryNotification,
  formatSen,
  uploadDashboardPaymentQr,
  deleteDashboardPaymentQr,
  getDashboardPaymentReceipt,
  getDashboardPaymentReceiptDownload,
} from '../lib/api'
import type {
  DashboardCategory,
  DashboardBranch,
  DashboardProduct,
  DashboardSettings,
  DashboardSummary,
  DashboardAnalyticsPeriod,
  DashboardOrder,
  Organization,
  DashboardUser,
} from '../lib/api'
import { LanguageToggle, useLanguage } from '../lib/i18n'
import { compressImage } from '../lib/image'
import { buildLocationLink } from '../lib/locationLink'

type Tab = 'overview' | 'orders' | 'catalog' | 'stores' | 'settings' | 'users'
export default function DashboardPage() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [analyticsPeriod, setAnalyticsPeriod] = useState<DashboardAnalyticsPeriod>('month')
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [orders, setOrders] = useState<DashboardOrder[]>([])
  const [products, setProducts] = useState<DashboardProduct[]>([])
  const [categories, setCategories] = useState<DashboardCategory[]>([])
  const [branches, setBranches] = useState<DashboardBranch[]>([])
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)
  const [settings, setSettings] = useState<DashboardSettings | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [dashboardUsers, setDashboardUsers] = useState<DashboardUser[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newOrderCount, setNewOrderCount] = useState(0)
  const [sendingOrderList, setSendingOrderList] = useState(false)

  const activeOrganization = useMemo(
    () => organizations.find((organization) => organization.tenantId === activeTenantId) ?? null,
    [organizations, activeTenantId],
  )
  const canManageCatalog = activeOrganization?.role === 'owner' || activeOrganization?.role === 'admin'

  async function loadDashboard(branchOverride?: string | null) {
    setLoading(true)
    setError(null)
    try {
      const orgs = await getOrganizations()
      setOrganizations(orgs.organizations)
      setIsPlatformAdmin(orgs.isPlatformAdmin)
      setActiveTenantId(orgs.activeTenantId)
      if (!orgs.activeTenantId && orgs.organizations[0]) {
        await switchOrganization(orgs.organizations[0].tenantId)
        setActiveTenantId(orgs.organizations[0].tenantId)
      }
      if (!orgs.activeTenantId && !orgs.organizations[0]) return

      const branchRes = await getDashboardBranches()
      setBranches(branchRes.branches)
      const selectedBranchId = branchOverride !== undefined
        ? branchOverride
        : activeBranchId && branchRes.branches.some((branch) => branch.id === activeBranchId)
        ? activeBranchId
        : branchRes.branches.find((branch) => branch.isDefault)?.id ?? branchRes.branches[0]?.id ?? null
      setActiveBranchId(selectedBranchId)
      const [summaryRes, ordersRes, productsRes, categoriesRes, settingsRes, usersRes] = await Promise.all([
        getDashboardSummary(selectedBranchId, analyticsPeriod),
        getDashboardOrders({ limit: 50, branchId: selectedBranchId }),
        getDashboardProducts(selectedBranchId),
        getDashboardCategories(selectedBranchId),
        getDashboardSettings(),
        orgs.isPlatformAdmin ? getDashboardUsers() : Promise.resolve({ users: [] as DashboardUser[] }),
      ])
      setSummary(summaryRes)
      setOrders(ordersRes.orders)
      setProducts(productsRes.products)
      setCategories(categoriesRes.categories)
      setSettings(settingsRes)
      setDashboardUsers(usersRes.users)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        navigate('/dashboard/login', { replace: true })
      } else {
        setError(t('Dashboard data failed to load. Please try again.'))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDashboard()
  }, [])

  useEffect(() => {
    if (!activeOrganization || loading) return
    const refresh = window.setInterval(async () => {
      try {
        const [summaryRes, ordersRes] = await Promise.all([getDashboardSummary(activeBranchId, analyticsPeriod), getDashboardOrders({ limit: 50, branchId: activeBranchId })])
        const previousIds = new Set(orders.map((order) => order.id))
        const newOrders = ordersRes.orders.filter((order) => !previousIds.has(order.id) && order.status === 'pending')
        if (newOrders.length > 0) setNewOrderCount((count) => count + newOrders.length)
        setSummary(summaryRes)
        setOrders(ordersRes.orders)
      } catch {
        // The regular dashboard request will surface an auth or server error.
      }
    }, 15000)
    return () => window.clearInterval(refresh)
  }, [activeOrganization, activeBranchId, analyticsPeriod, loading, orders])

  async function handleAnalyticsPeriodChange(period: DashboardAnalyticsPeriod) {
    setAnalyticsPeriod(period)
    setAnalyticsLoading(true)
    setError(null)
    try {
      setSummary(await getDashboardSummary(activeBranchId, period))
    } catch {
      setError(t('Analytics data failed to load. Please try again.'))
    } finally {
      setAnalyticsLoading(false)
    }
  }

  async function handleOrganizationChange(tenantId: string) {
    setMessage(null)
    try {
      await switchOrganization(tenantId)
      setActiveTenantId(tenantId)
      setActiveBranchId(null)
      await loadDashboard()
    } catch {
      setError(t('Unable to switch organization.'))
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined)
    navigate('/dashboard/login', { replace: true })
  }

  async function handleRetryNotification(orderId: string) {
    try {
      await retryNotification(orderId, activeBranchId)
      setOrders((current) => current.map((order) => (order.id === orderId ? { ...order, notificationStatus: 'pending' } : order)))
      setMessage(t('Notification queued again.'))
    } catch {
      setError(t('Notification retry failed.'))
    }
  }

  async function handleSendOrderListNow() {
    setSendingOrderList(true)
    setError(null)
    setMessage(null)
    try {
      const result = await sendDashboardOrderListNow()
      setMessage(t('Order list sent successfully ({count} orders).', { count: result.orderCount }))
      await loadDashboard()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_pending_orders') setError(t('There are no new orders to summarize.'))
      else if (err instanceof ApiError && err.code === 'telegram_not_configured') setError(t('Telegram is not configured for this account. Ask the platform administrator to add its bot token and chat ID.'))
      else if (err instanceof ApiError && err.code === 'telegram_rejected') setError(t('Telegram rejected the order list. Check this account’s bot token and chat ID.'))
      else if (err instanceof ApiError && err.code === 'telegram_unreachable') setError(t('Could not connect to Telegram. Please try again.'))
      else setError(t('Order list could not be sent.'))
    } finally {
      setSendingOrderList(false)
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">{t('Loading dashboard...')}</div>
  if (!activeOrganization) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-center text-slate-600">{t('This account has no manageable organization.')}</div>
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-600">Operations</p>
            <h1 className="mt-1 text-xl font-semibold">{activeOrganization.name}</h1>
            {isPlatformAdmin && <p className="mt-1 text-xs font-medium text-slate-500">{t('Viewing account data for {name}', { name: activeOrganization.name })}</p>}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label htmlFor="organization" className="sr-only">{t('Current organization')}</label>
            <select
              id="organization"
              value={activeTenantId ?? ''}
              onChange={(event) => void handleOrganizationChange(event.target.value)}
              className="min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:max-w-52"
            >
              {organizations.map((organization) => <option key={organization.tenantId} value={organization.tenantId}>{organization.name}</option>)}
            </select>
            {branches.length > 0 && <><label htmlFor="branch" className="sr-only">{t('Current location')}</label><select id="branch" value={activeBranchId ?? ''} onChange={(event) => { const next = event.target.value || null; setActiveBranchId(next); void loadDashboard(next) }} className="min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:max-w-52">{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.isDefault ? ` (${t('Default')})` : ''}</option>)}</select></>}
            <LanguageToggle /><Link to={activeBranchId ? `/${activeOrganization.slug}/${branches.find((branch) => branch.id === activeBranchId)?.slug ?? ''}` : `/${activeOrganization.slug}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">{t('Open store')}</Link>
            <button type="button" onClick={() => void handleLogout()} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900">{t('Log out')}</button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        <nav aria-label={t('Dashboard navigation')} className="flex gap-2 overflow-x-auto lg:w-44 lg:flex-col">
          {([['overview', 'Overview'], ['orders', 'Orders'], ['catalog', 'Product catalog'], ['stores', 'Store management'], ['settings', 'Organization settings'], ...(isPlatformAdmin ? [['users', 'User management'] as const] : [])] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium ${tab === key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-white'}`}>
              {t(label)}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {message && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}
          {newOrderCount > 0 && <button type="button" onClick={() => { setNewOrderCount(0); setTab('orders') }} className="mb-4 w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-medium text-amber-900">{t('There are {count} new orders. Click to view.', { count: newOrderCount })}</button>}
          {tab === 'overview' && <Overview summary={summary} period={analyticsPeriod} analyticsLoading={analyticsLoading} onPeriodChange={handleAnalyticsPeriodChange} orders={orders} branchId={activeBranchId} onRetryNotification={handleRetryNotification} />}
          {tab === 'orders' && <Orders orders={orders} branchId={activeBranchId} canManage={canManageCatalog} sendingOrderList={sendingOrderList} onSendOrderListNow={handleSendOrderListNow} onRetryNotification={handleRetryNotification} />}
          {tab === 'catalog' && <Catalog products={products} categories={categories} branchId={activeBranchId} canManage={canManageCatalog} onCreated={loadDashboard} />}
          {tab === 'stores' && <Stores organizations={organizations} activeTenantId={activeTenantId} branches={branches} canCreate={activeOrganization.role === 'owner'} canManage={canManageCatalog} onCreated={async (tenantId) => { await handleOrganizationChange(tenantId) }} onBranchesChanged={loadDashboard} />}
          {tab === 'settings' && <div className="space-y-6"><Settings settings={settings} canManage={canManageCatalog} onSaved={loadDashboard} />{isPlatformAdmin && <TelegramSettings />}</div>}
          {tab === 'users' && isPlatformAdmin && <Users users={dashboardUsers} onCreated={loadDashboard} />}
        </main>
      </div>
    </div>
  )
}

function Overview({ summary, period, analyticsLoading, onPeriodChange, orders, branchId, onRetryNotification }: { summary: DashboardSummary | null; period: DashboardAnalyticsPeriod; analyticsLoading: boolean; onPeriodChange: (period: DashboardAnalyticsPeriod) => Promise<void>; orders: DashboardOrder[]; branchId: string | null; onRetryNotification: (orderId: string) => Promise<void> }) {
  const { t } = useLanguage()
  const periods: [DashboardAnalyticsPeriod, string][] = [['today', t('Today')], ['week', t('This week')], ['month', t('This month')]]
  const maxTrendValue = Math.max(...(summary?.trend.map((point) => point.totalSen) ?? [0]), 1)
  return <div className="space-y-6"><section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{t('Data analysis')}</h2><p className="mt-1 text-sm text-slate-500">{t('Track orders, revenue, and product performance.')}</p></div><div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">{periods.map(([key, label]) => <button key={key} type="button" onClick={() => void onPeriodChange(key)} disabled={analyticsLoading} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${period === key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>{label}</button>)}</div></div></section><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{t('Orders')}</p><p className="mt-2 text-2xl font-semibold">{summary?.orderCount ?? 0}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{t('Sales')}</p><p className="mt-2 text-2xl font-semibold">{formatSen(summary?.totalSen ?? 0)}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{t('Average order value')}</p><p className="mt-2 text-2xl font-semibold">{formatSen(summary?.averageOrderValueSen ?? 0)}</p></div></div><div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]"><section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-4"><h2 className="font-semibold">{t('Order and sales trend')}</h2></div>{summary?.trend.length ? <div className="space-y-3 p-4">{summary.trend.map((point) => <div key={point.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-sm"><span className="text-slate-500">{point.label}</span><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.max((point.totalSen / maxTrendValue) * 100, 3)}%` }} /></div><span className="text-right font-medium">{formatSen(point.totalSen)}</span></div>)}</div> : <p className="px-4 py-10 text-center text-sm text-slate-500">{t('No data for this period.')}</p>}</section><section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-4"><h2 className="font-semibold">{t('Top products')}</h2></div>{summary?.topProducts.length ? <div className="divide-y divide-slate-100">{summary.topProducts.map((product, index) => <div key={product.name} className="flex items-center justify-between gap-3 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="text-sm font-semibold text-slate-400">{index + 1}</span><span className="truncate font-medium">{product.name}</span></div><div className="shrink-0 text-right"><p className="text-sm font-medium">{product.quantity} {t('sold')}</p><p className="text-xs text-slate-400">{formatSen(product.totalSen)}</p></div></div>)}</div> : <p className="px-4 py-10 text-center text-sm text-slate-500">{t('No data for this period.')}</p>}</section></div><section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-4"><h2 className="font-semibold">{t('Recent orders')}</h2></div><OrdersTable orders={orders.slice(0, 8)} branchId={branchId} onRetryNotification={onRetryNotification} /></section></div>
}

function Orders({ orders, branchId, canManage, sendingOrderList, onSendOrderListNow, onRetryNotification }: { orders: DashboardOrder[]; branchId: string | null; canManage: boolean; sendingOrderList: boolean; onSendOrderListNow: () => Promise<void>; onRetryNotification: (orderId: string) => Promise<void> }) {
  const { t } = useLanguage()
  return <section className="rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4"><div><h2 className="font-semibold">{t('Order list')}</h2><p className="mt-1 text-sm text-slate-500">{t('Only orders from the current organization are shown.')}</p></div>{canManage && <button type="button" onClick={() => void onSendOrderListNow()} disabled={sendingOrderList} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{sendingOrderList ? t('Sending order list...') : t('Summarize and send now')}</button>}</div><OrdersTable orders={orders} branchId={branchId} onRetryNotification={onRetryNotification} /></section>
}

function OrdersTable({ orders, branchId, onRetryNotification }: { orders: DashboardOrder[]; branchId: string | null; onRetryNotification: (orderId: string) => Promise<void> }) {
  const { t, language } = useLanguage()
  if (orders.length === 0) return <p className="px-4 py-12 text-center text-sm text-slate-500">{t('No orders yet.')}</p>
  const notificationLabel = (status: string | null) => status === 'sent' ? t('Sent') : status === 'failed' ? t('Failed') : status === 'retry_scheduled' ? t('Retry scheduled') : t('Pending')
  return <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 font-medium">{t('Order')}</th><th className="px-4 py-3 font-medium">{t('Customer')}</th><th className="px-4 py-3 font-medium">{t('Remark')}</th><th className="px-4 py-3 font-medium">{t('Amount')}</th><th className="px-4 py-3 font-medium">{t('Time')}</th><th className="px-4 py-3 font-medium">{t('Notification')}</th><th className="px-4 py-3 font-medium">{t('Payment')}</th><th className="px-4 py-3 font-medium">{t('File')}</th></tr></thead><tbody className="divide-y divide-slate-100">{orders.map((order) => <tr key={order.id}><td className="px-4 py-3 font-medium">{order.orderNumber}</td><td className="px-4 py-3"><div>{order.customerName}</div><div className="text-xs text-slate-400">{order.customerPhone}</div></td><td className="px-4 py-3 text-xs text-slate-500"><div className="max-w-[220px] whitespace-normal [overflow-wrap:anywhere]" title={order.remark || undefined}>{order.remark || '—'}</div></td><td className="px-4 py-3">{formatSen(order.totalSen)}</td><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{new Date(order.createdAt).toLocaleString(language === 'en' ? 'en-MY' : 'zh-CN')}</td><td className="px-4 py-3"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${order.notificationStatus === 'sent' ? 'bg-emerald-50 text-emerald-700' : order.notificationStatus === 'failed' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{notificationLabel(order.notificationStatus)}</span>{order.notificationStatus === 'failed' && <button type="button" onClick={() => void onRetryNotification(order.id)} className="text-xs font-medium text-amber-700 hover:text-amber-900">{t('Retry')}</button>}</div></td><td className="px-4 py-3">{order.hasPaymentReceipt ? <div className="flex flex-wrap items-center gap-2"><a href={getDashboardPaymentReceipt(order.id, branchId)} target="_blank" rel="noreferrer" className="text-sm font-medium text-emerald-700 hover:text-emerald-900">{t('Preview receipt')}</a><a href={getDashboardPaymentReceiptDownload(order.id, branchId)} className="text-sm font-medium text-amber-700 hover:text-amber-900">{t('Download receipt')}</a></div> : <span className="text-xs text-slate-400">{t('No receipt')}</span>}</td><td className="px-4 py-3"><a href={`/api/dashboard/orders/${order.id}/pdf${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-amber-700 hover:text-amber-900">{t('Download PDF')}</a></td></tr>)}</tbody></table></div>
}

function Stores({ organizations, activeTenantId, branches, canCreate, canManage, onCreated, onBranchesChanged }: { organizations: Organization[]; activeTenantId: string | null; branches: DashboardBranch[]; canCreate: boolean; canManage: boolean; onCreated: (tenantId: string) => Promise<void>; onBranchesChanged: () => Promise<void> }) {
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [design, setDesign] = useState<'clean' | 'midnight' | 'warm'>('clean')
  const [tagline, setTagline] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('')
  const [branchSlug, setBranchSlug] = useState('')
  const [syncDefault, setSyncDefault] = useState(true)
  const [copiedBranchId, setCopiedBranchId] = useState<string | null>(null)

  async function createStore(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setError(null)
    try {
      const result = await createDashboardStore({ name: name.trim(), slug: slug.trim().toLowerCase(), design, tagline: tagline.trim() || undefined })
      setName(''); setSlug(''); setTagline(''); setDesign('clean')
      await onCreated(result.organization.tenantId)
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'slug_taken' ? t('This ordering link is already in use.') : err instanceof ApiError && err.code === 'invalid_input' ? t('Check the store name and link format.') : t('Store creation failed. Please try again later.'))
    } finally { setSaving(false) }
  }

  async function createBranch(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null)
    try { await createDashboardBranch({ name: branchName.trim(), slug: branchSlug.trim().toLowerCase(), syncDefault, makeDefault: branches.length === 0 }); setBranchName(''); setBranchSlug(''); await onBranchesChanged() } catch (err) { setError(err instanceof ApiError && err.code === 'slug_taken' ? t('Location link is already in use.') : t('Location creation failed.')) } finally { setSaving(false) }
  }

  async function setDefault(branchId: string) {
    try { await makeDashboardBranchDefault(branchId); await onBranchesChanged() } catch { setError(t('Location update failed.')) }
  }

  async function uploadQr(branchId: string, file: File | undefined) {
    if (!file) return
    try { await uploadDashboardPaymentQr(branchId, file); await onBranchesChanged() } catch (err) { setError(err instanceof ApiError && err.code === 'file_too_large' ? t('Payment QR is too large.') : t('Payment QR update failed.')) }
  }

  async function removeQr(branchId: string) {
    try { await deleteDashboardPaymentQr(branchId); await onBranchesChanged() } catch { setError(t('Payment QR update failed.')) }
  }

  async function copyLocationLink(branch: DashboardBranch) {
    const regionSlug = organizations.find((organization) => organization.tenantId === activeTenantId)?.slug
    if (!regionSlug || !branch.slug) return
    try {
      await navigator.clipboard.writeText(buildLocationLink(regionSlug, branch.slug))
      setCopiedBranchId(branch.id)
      window.setTimeout(() => setCopiedBranchId((current) => current === branch.id ? null : current), 1800)
    } catch {
      setError(t('Could not copy link.'))
    }
  }

  return <div className="space-y-6">
    <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{t('My stores')}</h2><p className="mt-1 text-sm text-slate-500">{t('Each store has its own menu, orders, design, and public ordering link.')}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{t('{count} stores', { count: organizations.length })}</span></div><div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">{organizations.map((organization) => <div key={organization.tenantId} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{organization.name}{organization.tenantId === activeTenantId && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{t('Current store')}</span>}</p><p className="mt-1 text-sm text-slate-500">{t('Ordering link: /{slug} · {role}', { slug: organization.slug, role: t(organization.role === 'owner' ? 'Store owner' : organization.role[0].toUpperCase() + organization.role.slice(1)) })}</p></div><div className="flex items-center gap-2"><a href={`/${organization.slug}`} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">{t('Open store')}</a>{organization.tenantId !== activeTenantId && <button type="button" onClick={() => void onCreated(organization.tenantId)} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">{t('Switch')}</button>}</div></div>)}</div></section>
    {canCreate ? <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{t('Create new store')}</h2><p className="mt-1 text-sm text-slate-500">{t('A separate customer ordering link will be created automatically.')}</p><form onSubmit={createStore} className="mt-5 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">{t('Store name')}<input required value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder={t('e.g. UPM Cafe')} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label><label className="text-sm font-medium">{t('Link name')}<div className="mt-2 flex"><span className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">/</span><input required value={slug} onChange={(event) => setSlug(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={80} placeholder={t('upm-cafe')} className="min-w-0 flex-1 rounded-r-lg border border-slate-300 px-3 py-2.5 font-normal" /></div></label></div><label className="block text-sm font-medium">{t('Store style')}<select value={design} onChange={(event) => setDesign(event.target.value as typeof design)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"><option value="clean">{t('Clean white')}</option><option value="midnight">{t('Midnight blue')}</option><option value="warm">{t('Warm orange')}</option></select></label><label className="block text-sm font-medium">{t('Welcome tagline (optional)')}<input value={tagline} onChange={(event) => setTagline(event.target.value)} maxLength={160} placeholder={t('e.g. Freshly made every day')} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>{error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<button type="submit" disabled={saving || !name.trim() || !slug.trim()} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? t('Creating...') : t('Create store and open')}</button></form></section> : <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">{t('Only store owners can create new stores.')}</p>}
    <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{t('Locations')}</h2><p className="mt-1 text-sm text-slate-500">{t('Each location has its own ordering link and menu copy.')}</p></div></div>{branches.length > 0 && <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">{branches.map((branch) => { const regionSlug = organizations.find((organization) => organization.tenantId === activeTenantId)?.slug; const link = regionSlug && branch.slug ? buildLocationLink(regionSlug, branch.slug) : ''; return <div key={branch.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="font-medium">{branch.name}{branch.isDefault && <span className="ml-2 rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">{t('Default')}</span>}</p><p className="text-sm text-slate-500">{link || `/${regionSlug ?? ''}/${branch.slug ?? ''}`}</p><div className="mt-3 flex items-center gap-3">{branch.hasPaymentQr && <img src={`/api/dashboard/branches/${branch.id}/payment-qr`} alt={t('Payment QR code')} className="h-16 w-16 rounded border border-slate-200 object-contain p-1" />}<label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50">{branch.hasPaymentQr ? t('Change payment QR') : t('Upload payment QR')}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void uploadQr(branch.id, event.target.files?.[0])} /></label>{branch.hasPaymentQr && <button type="button" onClick={() => void removeQr(branch.id)} className="text-xs font-medium text-red-600 hover:text-red-800">{t('Remove payment QR')}</button>}{!branch.hasPaymentQr && !branch.isDefault && <span className="text-xs text-slate-400">{t('Uses default payment QR')}</span>}</div></div><div className="flex items-center gap-2">{link && <button type="button" onClick={() => void copyLocationLink(branch)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50">{copiedBranchId === branch.id ? t('Copied') : t('Copy link')}</button>}{canManage && !branch.isDefault && <button type="button" onClick={() => void setDefault(branch.id)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50">{t('Make default')}</button>}</div></div>})}</div>}{canManage && <form onSubmit={createBranch} className="mt-5 space-y-3 border-t border-slate-100 pt-4"><div className="grid gap-3 sm:grid-cols-2"><input required value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder={t('Location name')} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /><input required value={branchSlug} onChange={(event) => setBranchSlug(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder={t('location-link')} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></div><label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={syncDefault} onChange={(event) => setSyncDefault(event.target.checked)} />{t('Copy the default menu once')}</label><button type="submit" disabled={saving || !branchName.trim() || !branchSlug.trim()} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{t('Add location')}</button></form>}</section>
  </div>
}

function Catalog({ products, categories, branchId, canManage, onCreated }: { products: DashboardProduct[]; categories: DashboardCategory[]; branchId: string | null; canManage: boolean; onCreated: () => Promise<void> }) {
  const { t } = useLanguage()
  const [productName, setProductName] = useState('')
  const [price, setPrice] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingPrice, setEditingPrice] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState('')
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null)
  const [editingAvailable, setEditingAvailable] = useState(true)
  const [imageLoading, setImageLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addCategory(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setError(null)
    try { await createDashboardCategory({ name: categoryName.trim(), branchId }); setCategoryName(''); await onCreated() } catch { setError(t('Category creation failed.')) } finally { setSaving(false) }
  }

  async function deleteCategory(category: DashboardCategory) {
    if (!window.confirm(t('Delete category "{name}"? Its products will be kept as uncategorized.', { name: category.name }))) return
    setSaving(true)
    setError(null)
    try {
      await deleteDashboardCategory(category.id, branchId)
      await onCreated()
    } catch {
      setError(t('Category deletion failed.'))
    } finally {
      setSaving(false)
    }
  }

  async function addProduct() {
    const priceSen = Math.round(Number(price) * 100)
    if (!productName.trim() || !Number.isFinite(priceSen) || priceSen < 0) { setError(t('Enter a valid product name and price.')); return }
    setSaving(true); setError(null)
    try { await createDashboardProduct({ name: productName.trim(), imageUrl, priceSen, categoryId: categoryId || null, isPublic: true, isAvailable: true, branchId }); setProductName(''); setPrice(''); setCategoryId(''); setImageUrl(null); await onCreated() } catch { setError(t('Product creation failed.')) } finally { setSaving(false) }
  }

  async function toggleAvailability(product: DashboardProduct) {
    try { await updateDashboardProduct(product.id, { isAvailable: !product.isAvailable }, branchId); await onCreated() } catch { setError(t('Product status update failed.')) }
  }

  async function deleteProduct(product: DashboardProduct) {
    if (!window.confirm(t('Delete this product? This cannot be undone.'))) return
    setError(null)
    try {
      await deleteDashboardProduct(product.id, branchId)
      await onCreated()
    } catch {
      setError(t('Product deletion failed.'))
    }
  }

  function startEditing(product: DashboardProduct) {
    setEditingId(product.id)
    setEditingName(product.name)
    setEditingPrice((product.priceSen / 100).toFixed(2))
    setEditingCategoryId(product.categoryId ?? '')
    setEditingImageUrl(product.imageUrl)
    setEditingAvailable(product.isAvailable)
    setError(null)
  }

  function cancelEditing() {
    setEditingId(null)
    setEditingName('')
    setEditingPrice('')
    setEditingCategoryId('')
    setEditingImageUrl(null)
  }

  async function saveProduct(productId: string) {
    const priceSen = Math.round(Number(editingPrice) * 100)
    if (!editingName.trim() || !Number.isFinite(priceSen) || priceSen < 0) { setError(t('Enter a valid product name and price.')); return }
    setSaving(true); setError(null)
    try {
      await updateDashboardProduct(productId, { name: editingName.trim(), priceSen, categoryId: editingCategoryId || null, imageUrl: editingImageUrl, isAvailable: editingAvailable }, branchId)
      cancelEditing()
      await onCreated()
    } catch { setError(t('Product update failed.')) } finally { setSaving(false) }
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>, target: 'new' | 'edit') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImageLoading(true); setError(null)
    try {
      const compressed = await compressImage(file)
      if (target === 'new') setImageUrl(compressed)
      else setEditingImageUrl(compressed)
    } catch (imageError) { setError((imageError as Error).message === 'image_too_large' ? t('Image is too large after compression.') : t('Please choose an image file.')) } finally { setImageLoading(false) }
  }

  return <div className="space-y-6">
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{t('Product catalog')}</h2><p className="mt-1 text-sm text-slate-500">{t("Manage products in the current organization's public stores.")}</p></div>{!canManage && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">{t('Read only')}</span>}</div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {canManage && <div className="mt-4 space-y-3 border-t border-slate-100 pt-4"><div className="grid gap-3 md:grid-cols-[1fr_140px_180px_auto]"><input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder={t('Product name')} aria-label={t('Product name')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={price} onChange={(event) => setPrice(event.target.value)} placeholder={t('Price RM')} type="number" min="0" step="0.01" aria-label={t('Price RM')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label={t('Product category')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">{t('Uncategorized')}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><button type="button" onClick={() => void addProduct()} disabled={saving || imageLoading} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{t('Add product')}</button></div><div className="flex flex-wrap items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"><input type="file" accept="image/*" onChange={(event) => void handleImage(event, 'new')} className="sr-only" />{imageLoading ? t('Image is being optimized...') : imageUrl ? t('Change image') : t('Upload image')}</label>{imageUrl && <><img src={imageUrl} alt={t('Product image')} className="h-12 w-12 rounded-lg object-cover" /><button type="button" onClick={() => setImageUrl(null)} className="text-xs font-medium text-red-600">{t('Remove image')}</button></>}</div></div>}
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-4"><h3 className="font-semibold">{t('Existing products')}</h3></div>{products.length === 0 ? <p className="px-4 py-10 text-center text-sm text-slate-500">{t('No products yet.')}</p> : <div className="divide-y divide-slate-100">{products.map((product) => editingId === product.id ? <div key={product.id} className="space-y-3 bg-slate-50 px-4 py-4"><div className="grid gap-3 md:grid-cols-[1fr_140px_180px]"><input value={editingName} onChange={(event) => setEditingName(event.target.value)} aria-label={t('Product name')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /><input value={editingPrice} onChange={(event) => setEditingPrice(event.target.value)} aria-label={t('Price RM')} type="number" min="0" step="0.01" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /><select value={editingCategoryId} onChange={(event) => setEditingCategoryId(event.target.value)} aria-label={t('Product category')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">{t('Uncategorized')}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div className="flex flex-wrap items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"><input type="file" accept="image/*" onChange={(event) => void handleImage(event, 'edit')} className="sr-only" />{imageLoading ? t('Image is being optimized...') : editingImageUrl ? t('Change image') : t('Upload image')}</label>{editingImageUrl && <><img src={editingImageUrl} alt={t('Product image')} className="h-12 w-12 rounded-lg object-cover" /><button type="button" onClick={() => setEditingImageUrl(null)} className="text-xs font-medium text-red-600">{t('Remove image')}</button></>}<label className="inline-flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={editingAvailable} onChange={(event) => setEditingAvailable(event.target.checked)} />{t('Available')}</label></div><div className="flex flex-wrap gap-2"><button type="button" disabled={saving || imageLoading} onClick={() => void saveProduct(product.id)} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{t('Save changes')}</button><button type="button" disabled={saving} onClick={cancelEditing} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">{t('Cancel')}</button></div></div> : <div key={product.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"><div className="flex min-w-0 items-center gap-3">{product.imageUrl && <img src={product.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />}<div className="min-w-0"><p className="break-words font-medium">{product.name}</p><p className="text-sm text-slate-500">{formatSen(product.priceSen)} · {product.categoryName ?? t('Uncategorized')}</p></div></div><div className="flex flex-wrap items-center gap-2"><button type="button" disabled={!canManage} onClick={() => startEditing(product)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t('Edit')}</button><button type="button" disabled={!canManage} onClick={() => void toggleAvailability(product)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${product.isAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{product.isAvailable ? t('Available') : t('Unavailable')}</button><button type="button" disabled={!canManage} onClick={() => void deleteProduct(product)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">{t('Delete')}</button></div></div>)}</div>}</section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">{t('Categories')}</h3>{canManage && <form onSubmit={addCategory} className="mt-3 flex gap-2"><input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder={t('New category name')} aria-label={t('New category name')} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="submit" disabled={saving} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">{t('Add category')}</button></form>}<div className="mt-4 flex flex-wrap gap-2">{categories.map((category) => <span key={category.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 pl-3 pr-2 py-1 text-sm text-slate-600">{category.name}{canManage && <button type="button" disabled={saving} onClick={() => void deleteCategory(category)} className="rounded-full px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50">{t('Delete')}</button>}</span>)}</div></section>
  </div>
}

function Settings({ settings, canManage, onSaved }: { settings: DashboardSettings | null; canManage: boolean; onSaved: () => Promise<void> }) {
  const { t } = useLanguage()
  const [storeName, setStoreName] = useState(settings?.tenant.name ?? '')
  const [storeSlug, setStoreSlug] = useState(settings?.tenant.slug ?? '')
  const [design, setDesign] = useState<'clean' | 'midnight' | 'warm'>('clean')
  const [tagline, setTagline] = useState('')
  const [orderListSendTime, setOrderListSendTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setStoreName(settings?.tenant.name ?? '')
    setStoreSlug(settings?.tenant.slug ?? '')
    const businessInfo = settings?.settings.businessInfo
    const savedDesign = businessInfo?.design
    setDesign(savedDesign === 'midnight' || savedDesign === 'warm' ? savedDesign : 'clean')
    setTagline(typeof businessInfo?.tagline === 'string' ? businessInfo.tagline : '')
    setOrderListSendTime(settings?.settings.orderListSendTime ?? '')
  }, [settings])
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null)
    try {
      await updateDashboardSettings({ name: storeName.trim(), slug: storeSlug.trim().toLowerCase(), businessInfo: { ...(settings?.settings.businessInfo ?? {}), design, tagline: tagline.trim() || null }, orderListSendTime: orderListSendTime || null })
      await onSaved()
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'slug_taken' ? t('This link name is already in use.') : err instanceof ApiError && err.code === 'invalid_input' ? t('Link names may only contain lowercase letters, numbers, and hyphens.') : t('Store settings could not be saved.'))
    } finally { setSaving(false) }
  }
  return <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{t('Store settings')}</h2><p className="mt-1 text-sm text-slate-500">{t('Update the store name and public link used by customers.')}</p><form onSubmit={save} className="mt-6 space-y-4">
    <div><label htmlFor="store-name" className="mb-1.5 block text-sm font-medium">{t('Store name')}</label><input id="store-name" value={storeName} onChange={(event) => setStoreName(event.target.value)} disabled={!canManage} maxLength={120} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-100" /></div>
    <div><label htmlFor="store-slug" className="mb-1.5 block text-sm font-medium">{t('Public link name')}</label><div className="flex items-center"><span className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">/</span><input id="store-slug" value={storeSlug} onChange={(event) => setStoreSlug(event.target.value)} disabled={!canManage} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={80} className="min-w-0 flex-1 rounded-r-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-100" /></div><p className="mt-1 text-xs text-slate-400">{t('Use lowercase letters, numbers, and hyphens only.')}</p></div>
    <div><label htmlFor="store-design" className="mb-1.5 block text-sm font-medium">{t('Store style')}</label><select id="store-design" value={design} onChange={(event) => setDesign(event.target.value as typeof design)} disabled={!canManage} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-100"><option value="clean">{t('Clean white')}</option><option value="midnight">{t('Midnight blue')}</option><option value="warm">{t('Warm orange')}</option></select></div>
    <div><label htmlFor="store-tagline" className="mb-1.5 block text-sm font-medium">{t('Welcome tagline (optional)')}</label><input id="store-tagline" value={tagline} onChange={(event) => setTagline(event.target.value)} disabled={!canManage} maxLength={160} placeholder={t('e.g. Freshly made every day')} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-100" /></div>
    <div><label htmlFor="order-list-send-time" className="mb-1.5 block text-sm font-medium">{t('Daily order list time')}</label><input id="order-list-send-time" type="time" value={orderListSendTime} onChange={(event) => setOrderListSendTime(event.target.value)} disabled={!canManage} className="rounded-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-100" /><p className="mt-1 text-xs text-slate-400">{t('Leave empty to disable the daily Telegram order list. Malaysia time.')}</p></div>
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{t('The daily order list is sent to the configured Telegram recipient.')}</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    {canManage && <button type="submit" disabled={saving || !storeName.trim() || !storeSlug.trim()} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? t('Saving...') : t('Save settings')}</button>}
  </form></section>
}

function TelegramSettings() {
  const { t } = useLanguage()
  const [accounts, setAccounts] = useState<{ id: string; email: string; configured: boolean }[]>([])
  const [accountUserId, setAccountUserId] = useState('')
  const [configured, setConfigured] = useState(false)
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadAccounts() {
    setLoading(true)
    try {
      const result = await getTelegramAccounts()
      setAccounts(result.accounts)
      if (!accountUserId && result.accounts[0]) setAccountUserId(result.accounts[0].id)
    } catch {
      setError(t('Telegram accounts could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadAccounts() }, [])

  useEffect(() => {
    if (!accountUserId) return
    let active = true
    setConfigured(false)
    setChatId('')
    setBotToken('')
    setMessage(null)
    setError(null)
    void getTelegramSettings(accountUserId).then((result) => {
      if (!active) return
      setConfigured(result.configured)
      setChatId(result.chatId)
      setAccounts((current) => current.map((account) => account.id === accountUserId ? { ...account, configured: result.configured } : account))
    }).catch(() => {
      if (active) setError(t('Telegram settings could not be loaded.'))
    })
    return () => { active = false }
  }, [accountUserId])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      await saveTelegramSettings({ accountUserId, ...(botToken.trim() ? { botToken: botToken.trim() } : {}), chatId: chatId.trim() })
      setBotToken('')
      setConfigured(true)
      setMessage(t('Telegram settings saved.'))
      await loadAccounts()
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'telegram_encryption_not_configured'
        ? t('Telegram encryption is not configured on the API.')
        : err instanceof ApiError && err.code === 'bot_token_required'
          ? t('Enter the bot token to configure Telegram for the first time.')
          : t('Telegram settings could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    setMessage(null)
    setError(null)
    try {
      await testTelegramSettings(accountUserId)
      setMessage(t('Telegram test message sent.'))
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'telegram_not_configured'
        ? t('Save Telegram settings before sending a test.')
        : err instanceof ApiError && err.code === 'telegram_rejected'
          ? t('Telegram rejected the test message. Check the bot token and chat ID.')
          : t('Could not connect to Telegram. Please try again.'))
    } finally {
      setTesting(false)
    }
  }

  return <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="font-semibold">{t('Telegram API settings')}</h2>
    <p className="mt-1 text-sm text-slate-500">{t('Each dashboard account has its own Telegram bot and recipient. Only the platform administrator can change them.')}</p>
    {loading ? <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{t('Loading Telegram accounts...')}</p> : accounts.length === 0 ? <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{t('No dashboard accounts available.')}</p> : <form onSubmit={save} className="mt-5 space-y-4">
      <div><label htmlFor="telegram-account" className="mb-1.5 block text-sm font-medium">{t('Dashboard account')}</label><select id="telegram-account" value={accountUserId} onChange={(event) => setAccountUserId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5">{accounts.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}</select></div>
      <div><label htmlFor="telegram-bot-token" className="mb-1.5 block text-sm font-medium">{t('Bot token')}</label><input id="telegram-bot-token" type="password" autoComplete="new-password" value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder={configured ? t('Saved securely. Leave blank to keep the current token.') : '123456:ABC-DEF...'} className="w-full rounded-lg border border-slate-300 px-3 py-2.5" /><p className="mt-1 text-xs text-slate-400">{t('The token is encrypted before it is stored and is never shown again.')}</p></div>
      <div><label htmlFor="telegram-chat-id" className="mb-1.5 block text-sm font-medium">{t('Recipient chat ID')}</label><input id="telegram-chat-id" required value={chatId} onChange={(event) => setChatId(event.target.value)} placeholder={t('For example, 123456789 or a group ID')} className="w-full rounded-lg border border-slate-300 px-3 py-2.5" /></div>
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{configured ? t('Telegram is configured for this dashboard account and its stores.') : t('Telegram is not configured yet for this account.')}</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={saving || !chatId.trim()} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? t('Saving...') : t('Save Telegram settings')}</button>{configured && <button type="button" onClick={() => void sendTest()} disabled={testing} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50">{testing ? t('Sending test...') : t('Send test message')}</button>}</div>
    </form>
    }
  </section>
}

function Users({ users, onCreated }: { users: DashboardUser[]; onCreated: () => Promise<void> }) {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'staff' | 'viewer'>('staff')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingRole, setEditingRole] = useState<DashboardUser['role']>('staff')
  const [editingPassword, setEditingPassword] = useState('')

  async function createUser(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await createDashboardUser({ email: email.trim(), password, role })
      setEmail('')
      setPassword('')
      setRole('staff')
      await onCreated()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_taken') setError(t('This email is already in use.'))
      else if (err instanceof ApiError && err.code === 'invalid_input') setError(t('Enter a valid email, password, and role.'))
      else setError(t('Account creation failed.'))
    } finally {
      setSaving(false)
    }
  }

  function startEditing(user: DashboardUser) {
    setEditingId(user.id)
    setEditingRole(user.role)
    setEditingPassword('')
    setError(null)
  }

  async function saveUser(user: DashboardUser) {
    setSaving(true)
    setError(null)
    try {
      await updateDashboardUser(user.id, { role: editingRole, ...(editingPassword ? { password: editingPassword } : {}) })
      setEditingId(null)
      setEditingPassword('')
      await onCreated()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_input') setError(t('Enter a valid role and password.'))
      else setError(t('Role and password update failed.'))
    } finally {
      setSaving(false)
    }
  }

  return <div className="space-y-6">
    <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">{t('User management')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('Only the platform administrator can add dashboard accounts.')}</p>
      <p className="mt-1 text-sm text-slate-500">{t('Each account starts with its own empty data space.')}</p>
      <form onSubmit={createUser} className="mt-5 space-y-4">
        <label className="block text-sm font-medium">{t('Email')}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
        <label className="block text-sm font-medium">{t('Password')}<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /><span className="mt-1 block text-xs font-normal text-slate-400">{t('At least 8 characters.')}</span></label>
        <label className="block text-sm font-medium">{t('Account role')}<select value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"><option value="admin">{t('Admin')}</option><option value="staff">{t('Staff')}</option><option value="viewer">{t('Viewer')}</option></select></label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={saving || !email.trim() || password.length < 8} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? t('Creating...') : t('Add account')}</button>
      </form>
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4"><h3 className="font-semibold">{t('Organization accounts')}</h3></div>
      <div className="divide-y divide-slate-100">{users.map((user) => editingId === user.id ? <div key={user.id} className="space-y-3 bg-slate-50 px-4 py-3"><p className="break-all text-sm font-medium">{user.email}</p><div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"><select disabled={user.role === 'owner'} value={editingRole} onChange={(event) => setEditingRole(event.target.value as typeof editingRole)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"><option value="admin">{t('Admin')}</option><option value="staff">{t('Staff')}</option><option value="viewer">{t('Viewer')}</option></select><input type="password" value={editingPassword} onChange={(event) => setEditingPassword(event.target.value)} minLength={8} placeholder={t('Password (leave blank to keep current)')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /><button type="button" disabled={saving || (editingPassword.length > 0 && editingPassword.length < 8)} onClick={() => void saveUser(user)} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{t('Save changes')}</button><button type="button" disabled={saving} onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">{t('Cancel')}</button></div></div> : <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{user.tenantName ?? user.email}</p><p className="break-all text-xs text-slate-500">{user.email}</p>{user.isCurrentUser && <span className="ml-2 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">{t('Your account')}</span>}</div><div className="flex items-center gap-2"><span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{t(user.role === 'owner' ? 'Store owner' : user.role[0].toUpperCase() + user.role.slice(1))}</span>{!user.isCurrentUser && <button type="button" onClick={() => startEditing(user)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">{t('Edit')}</button>}</div></div>)}</div>
    </section>
  </div>
}
