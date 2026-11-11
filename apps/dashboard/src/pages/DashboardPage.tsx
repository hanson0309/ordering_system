import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ApiError,
  createDashboardCategory,
  createDashboardBranch,
  createDashboardRegion,
  renameDashboardRegion,
  renameDashboardBranch,
  createDashboardProduct,
  getDashboardCategories,
  deleteDashboardCategory,
  getDashboardBranches,
  getDashboardRegions,
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
  updateDashboardSettings,
  retryNotification,
  formatSen,
  uploadDashboardPaymentQr,
  deleteDashboardPaymentQr,
  getDashboardPaymentReceipt,
  getDashboardPaymentReceiptDownload,
  getDashboardPricingRules,
  createDashboardPricingRule,
  updateDashboardPricingRule,
  deleteDashboardPricingRule,
  assignDashboardBranchPricingRule,
} from '../lib/api'
import type {
  DashboardCategory,
  DashboardBranch,
  DashboardRegion,
  DashboardProduct,
  DashboardSettings,
  DashboardSummary,
  DashboardAnalyticsPeriod,
  DashboardOrder,
  Organization,
  DashboardUser,
  DashboardPricingRule,
} from '../lib/api'
import { LanguageToggle, useLanguage } from '../lib/i18n'
import { compressImage } from '../lib/image'
import { buildLocationLink } from '../lib/locationLink'
import { selectBranchId } from '../lib/branchSelection'
import { buildStoreCreationInput, groupStoresForActiveRegion } from '../lib/storeManagement'
import { validateScheduledMealDraft } from '../lib/pricingRules'
import { formatMalaysiaTime, getProductKind, type ProductKind } from '../lib/productSchedule'

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
  const [allBranches, setAllBranches] = useState<DashboardBranch[]>([])
  const [regions, setRegions] = useState<DashboardRegion[]>([])
  const [pricingRules, setPricingRules] = useState<DashboardPricingRule[]>([])
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
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

  async function loadDashboard(branchOverride?: string | null, regionOverride?: string | null) {
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

      const regionRes = await getDashboardRegions()
      setRegions(regionRes.regions)
      const selectedRegionId = regionOverride !== undefined
        ? regionOverride
        : activeRegionId && regionRes.regions.some((region) => region.id === activeRegionId)
        ? activeRegionId
        : regionRes.regions.find((region) => region.isDefault)?.id ?? regionRes.regions[0]?.id ?? null
      setActiveRegionId(selectedRegionId)
      const allBranchRes = await getDashboardBranches()
      const branchRes = { branches: allBranchRes.branches.filter((branch) => branch.regionId === selectedRegionId) }
      setAllBranches(allBranchRes.branches)
      setBranches(branchRes.branches)
      const selectedBranchId = selectBranchId(branchRes.branches, activeBranchId, branchOverride)
      setActiveBranchId(selectedBranchId)
      const [summaryRes, ordersRes, productsRes, categoriesRes, settingsRes, usersRes, pricingRulesRes] = await Promise.all([
        getDashboardSummary(null, analyticsPeriod, selectedRegionId),
        getDashboardOrders({ limit: 50, regionId: selectedRegionId }),
        getDashboardProducts(selectedBranchId),
        getDashboardCategories(selectedBranchId),
        getDashboardSettings(),
        orgs.isPlatformAdmin ? getDashboardUsers() : Promise.resolve({ users: [] as DashboardUser[] }),
        getDashboardPricingRules(),
      ])
      setSummary(summaryRes)
      setOrders(ordersRes.orders.map((order) => order.notificationError ? { ...order, notificationStatus: order.notificationError } : order))
      setProducts(productsRes.products)
      setCategories(categoriesRes.categories)
      setSettings(settingsRes)
      setDashboardUsers(usersRes.users)
      setPricingRules(pricingRulesRes.pricingRules)
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
        const [summaryRes, ordersRes] = await Promise.all([getDashboardSummary(null, analyticsPeriod, activeRegionId), getDashboardOrders({ limit: 50, regionId: activeRegionId })])
        const previousIds = new Set(orders.map((order) => order.id))
        const newOrders = ordersRes.orders.filter((order) => !previousIds.has(order.id) && order.status === 'pending')
        if (newOrders.length > 0) setNewOrderCount((count) => count + newOrders.length)
        setSummary(summaryRes)
        setOrders(ordersRes.orders.map((order) => order.notificationError ? { ...order, notificationStatus: order.notificationError } : order))
      } catch {
        // The regular dashboard request will surface an auth or server error.
      }
    }, 15000)
    return () => window.clearInterval(refresh)
  }, [activeOrganization, activeBranchId, activeRegionId, analyticsPeriod, loading, orders])

  async function handleAnalyticsPeriodChange(period: DashboardAnalyticsPeriod) {
    setAnalyticsPeriod(period)
    setAnalyticsLoading(true)
    setError(null)
    try {
      setSummary(await getDashboardSummary(null, period, activeRegionId))
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
      setActiveRegionId(null)
      await loadDashboard(null, null)
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
      await retryNotification(orderId)
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
      const result = await sendDashboardOrderListNow(activeRegionId)
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
            {regions.length > 0 && <><label htmlFor="region" className="sr-only">{t('Current region')}</label><select id="region" value={activeRegionId ?? ''} onChange={(event) => { const next = event.target.value || null; setActiveRegionId(next); void loadDashboard(null, next) }} className="min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:max-w-52">{regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></>}
            {branches.length > 0 && <><label htmlFor="branch" className="sr-only">{t('Current store')}</label><select id="branch" value={activeBranchId ?? ''} onChange={(event) => { const next = event.target.value || null; setActiveBranchId(next); void loadDashboard(next) }} className="min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:max-w-52">{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></>}
            <LanguageToggle />
            <button type="button" onClick={() => void handleLogout()} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900">{t('Log out')}</button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        <nav aria-label={t('Dashboard navigation')} className="flex gap-2 overflow-x-auto lg:w-44 lg:flex-col">
          {([['overview', 'Overview'], ['orders', 'Orders'], ['catalog', 'Product catalog'], ['stores', 'Regions and stores'], ['settings', 'Organization settings'], ...(isPlatformAdmin ? [['users', 'User management'] as const] : [])] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium ${tab === key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-white'}`}>
              {t(label)}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {message && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}
          {newOrderCount > 0 && <button type="button" onClick={() => { setNewOrderCount(0); setTab('orders') }} className="mb-4 w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-medium text-amber-900">{t('There are {count} new orders. Click to view.', { count: newOrderCount })}</button>}
          {tab === 'overview' && <Overview summary={summary} period={analyticsPeriod} analyticsLoading={analyticsLoading} onPeriodChange={handleAnalyticsPeriodChange} orders={orders} onRetryNotification={handleRetryNotification} />}
          {tab === 'orders' && <Orders orders={orders} canManage={canManageCatalog} sendingOrderList={sendingOrderList} onSendOrderListNow={handleSendOrderListNow} onRetryNotification={handleRetryNotification} />}
          {tab === 'catalog' && <Catalog products={products} categories={categories} pricingRules={pricingRules} branchId={activeBranchId} canManage={canManageCatalog} onCreated={loadDashboard} />}
          {tab === 'stores' && <Stores tenantSlug={activeOrganization.slug} regions={regions} activeRegionId={activeRegionId} allBranches={allBranches} pricingRules={pricingRules} canManage={canManageCatalog} onBranchesChanged={loadDashboard} />}
          {tab === 'settings' && <div className="space-y-6"><Settings settings={settings} canManage={canManageCatalog} onSaved={loadDashboard} />{isPlatformAdmin && <TelegramSettings />}</div>}
          {tab === 'users' && isPlatformAdmin && <Users users={dashboardUsers} onCreated={loadDashboard} />}
        </main>
      </div>
    </div>
  )
}

function Overview({ summary, period, analyticsLoading, onPeriodChange, orders, onRetryNotification }: { summary: DashboardSummary | null; period: DashboardAnalyticsPeriod; analyticsLoading: boolean; onPeriodChange: (period: DashboardAnalyticsPeriod) => Promise<void>; orders: DashboardOrder[]; onRetryNotification: (orderId: string) => Promise<void> }) {
  const { t } = useLanguage()
  const periods: [DashboardAnalyticsPeriod, string][] = [['today', t('Today')], ['week', t('This week')], ['month', t('This month')]]
  const maxTrendValue = Math.max(...(summary?.trend.map((point) => point.totalSen) ?? [0]), 1)
  return <div className="space-y-6"><section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{t('Data analysis')}</h2><p className="mt-1 text-sm text-slate-500">{t('Track orders, revenue, and product performance.')}</p></div><div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">{periods.map(([key, label]) => <button key={key} type="button" onClick={() => void onPeriodChange(key)} disabled={analyticsLoading} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${period === key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>{label}</button>)}</div></div></section><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{t('Orders')}</p><p className="mt-2 text-2xl font-semibold">{summary?.orderCount ?? 0}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{t('Sales')}</p><p className="mt-2 text-2xl font-semibold">{formatSen(summary?.totalSen ?? 0)}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{t('Average order value')}</p><p className="mt-2 text-2xl font-semibold">{formatSen(summary?.averageOrderValueSen ?? 0)}</p></div></div><div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]"><section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-4"><h2 className="font-semibold">{t('Order and sales trend')}</h2></div>{summary?.trend.length ? <div className="space-y-3 p-4">{summary.trend.map((point) => <div key={point.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-sm"><span className="text-slate-500">{point.label}</span><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.max((point.totalSen / maxTrendValue) * 100, 3)}%` }} /></div><span className="text-right font-medium">{formatSen(point.totalSen)}</span></div>)}</div> : <p className="px-4 py-10 text-center text-sm text-slate-500">{t('No data for this period.')}</p>}</section><section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-4"><h2 className="font-semibold">{t('Top products')}</h2></div>{summary?.topProducts.length ? <div className="divide-y divide-slate-100">{summary.topProducts.map((product, index) => <div key={product.name} className="flex items-center justify-between gap-3 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="text-sm font-semibold text-slate-400">{index + 1}</span><span className="truncate font-medium">{product.name}</span></div><div className="shrink-0 text-right"><p className="text-sm font-medium">{product.quantity} {t('sold')}</p><p className="text-xs text-slate-400">{formatSen(product.totalSen)}</p></div></div>)}</div> : <p className="px-4 py-10 text-center text-sm text-slate-500">{t('No data for this period.')}</p>}</section></div><section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-4"><h2 className="font-semibold">{t('Recent orders')}</h2></div><OrdersTable orders={orders.slice(0, 8)} onRetryNotification={onRetryNotification} /></section></div>
}

function Orders({ orders, canManage, sendingOrderList, onSendOrderListNow, onRetryNotification }: { orders: DashboardOrder[]; canManage: boolean; sendingOrderList: boolean; onSendOrderListNow: () => Promise<void>; onRetryNotification: (orderId: string) => Promise<void> }) {
  const { t } = useLanguage()
  return <section className="rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4"><div><h2 className="font-semibold">{t('Order list')}</h2><p className="mt-1 text-sm text-slate-500">{t('Only orders from the selected region are shown.')}</p></div>{canManage && <button type="button" onClick={() => void onSendOrderListNow()} disabled={sendingOrderList} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{sendingOrderList ? t('Sending order list...') : t('Summarize and send now')}</button>}</div><OrdersTable orders={orders} onRetryNotification={onRetryNotification} /></section>
}

function OrdersTable({ orders, onRetryNotification }: { orders: DashboardOrder[]; onRetryNotification: (orderId: string) => Promise<void> }) {
  const { t, language } = useLanguage()
  if (orders.length === 0) return <p className="px-4 py-12 text-center text-sm text-slate-500">{t('No orders yet.')}</p>
  const notificationLabel = (status: string | null, error: string | null = null) => error === 'telegram_not_configured' || status === 'telegram_not_configured' ? (language === 'en' ? 'Telegram not configured' : 'Telegram 未配置') : status === 'sent' ? t('Sent') : status === 'failed' ? t('Failed') : status === 'retry_scheduled' ? t('Retry scheduled') : t('Pending')
  return <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 font-medium">{t('Order')}</th><th className="px-4 py-3 font-medium">{t('Region')}</th><th className="px-4 py-3 font-medium">{t('Store')}</th><th className="px-4 py-3 font-medium">{t('Customer')}</th><th className="px-4 py-3 font-medium">{t('Remark')}</th><th className="px-4 py-3 font-medium">{t('Amount')}</th><th className="px-4 py-3 font-medium">{t('Time')}</th><th className="px-4 py-3 font-medium">{t('Notification')}</th><th className="px-4 py-3 font-medium">{t('Payment')}</th><th className="px-4 py-3 font-medium">{t('File')}</th></tr></thead><tbody className="divide-y divide-slate-100">{orders.map((order) => <tr key={order.id}><td className="px-4 py-3 font-medium">{order.orderNumber}</td><td className="px-4 py-3 text-slate-600">{order.regionName ?? t('Unassigned')}</td><td className="px-4 py-3 text-slate-600">{order.branchName ?? t('General')}</td><td className="px-4 py-3"><div>{order.customerName}</div><div className="text-xs text-slate-400">{order.customerPhone}</div></td><td className="px-4 py-3 text-xs text-slate-500"><div className="max-w-[220px] whitespace-normal [overflow-wrap:anywhere]" title={order.remark || undefined}>{order.remark || '—'}</div></td><td className="px-4 py-3">{formatSen(order.totalSen)}</td><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{new Date(order.createdAt).toLocaleString(language === 'en' ? 'en-MY' : 'zh-CN')}</td><td className="px-4 py-3"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${order.notificationStatus === 'sent' ? 'bg-emerald-50 text-emerald-700' : order.notificationStatus === 'failed' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{notificationLabel(order.notificationStatus)}</span>{order.notificationStatus === 'failed' && <button type="button" onClick={() => void onRetryNotification(order.id)} className="text-xs font-medium text-amber-700 hover:text-amber-900">{t('Retry')}</button>}</div></td><td className="px-4 py-3">{order.hasPaymentReceipt ? <div className="flex flex-wrap items-center gap-2"><a href={getDashboardPaymentReceipt(order.id)} target="_blank" rel="noreferrer" className="text-sm font-medium text-emerald-700 hover:text-emerald-900">{t('Preview receipt')}</a><a href={getDashboardPaymentReceiptDownload(order.id)} className="text-sm font-medium text-amber-700 hover:text-amber-900">{t('Download receipt')}</a></div> : <span className="text-xs text-slate-400">{t('No receipt')}</span>}</td><td className="px-4 py-3"><a href={`/api/dashboard/orders/${order.id}/pdf`} target="_blank" rel="noreferrer" className="text-sm font-medium text-amber-700 hover:text-amber-900">{t('Download PDF')}</a></td></tr>)}</tbody></table></div>
}

function Stores({ tenantSlug, regions, activeRegionId, allBranches, pricingRules, canManage, onBranchesChanged }: { tenantSlug: string; regions: DashboardRegion[]; activeRegionId: string | null; allBranches: DashboardBranch[]; pricingRules: DashboardPricingRule[]; canManage: boolean; onBranchesChanged: (branchId?: string | null, regionId?: string | null) => Promise<void> }) {
  const { t } = useLanguage()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branchDrafts, setBranchDrafts] = useState<Record<string, { name: string; slug: string }>>({})
  const [regionName, setRegionName] = useState('')
  const [regionSlug, setRegionSlug] = useState('')
  const [editingName, setEditingName] = useState<{ type: 'region' | 'branch'; id: string } | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [syncDefault, setSyncDefault] = useState(true)
  const [copiedBranchId, setCopiedBranchId] = useState<string | null>(null)
  const [newRuleName, setNewRuleName] = useState('')
  const [deliveryFeeDrafts, setDeliveryFeeDrafts] = useState<Record<string, string>>({})
  const [newDeliveryPeriod, setNewDeliveryPeriod] = useState<'lunch' | 'dinner' | ''>('')

  useEffect(() => {
    setDeliveryFeeDrafts(Object.fromEntries(pricingRules.map((rule) => [rule.id, (rule.deliveryFeeSen / 100).toFixed(2)])))
  }, [pricingRules])

  async function createBranch(event: FormEvent, regionId: string, regionStoreCount: number) {
    event.preventDefault(); setSaving(true); setError(null)
    const draft = branchDrafts[regionId] ?? { name: '', slug: '' }
    try { await createDashboardBranch({ ...buildStoreCreationInput(regionId, draft.name.trim(), draft.slug.trim().toLowerCase(), syncDefault, regionStoreCount === 0), deliveryPeriod: newDeliveryPeriod || null }); setBranchDrafts((current) => ({ ...current, [regionId]: { name: '', slug: '' } })); await onBranchesChanged() } catch (err) { setError(err instanceof ApiError && err.code === 'slug_taken' ? t('Store link is already in use.') : t('Store creation failed.')) } finally { setSaving(false) }
  }

  async function createRegion(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null)
    try { const result = await createDashboardRegion({ name: regionName.trim(), slug: regionSlug.trim().toLowerCase() }); setRegionName(''); setRegionSlug(''); await onBranchesChanged(null, result.region.id) }
    catch (err) { setError(err instanceof ApiError && err.code === 'slug_taken' ? 'That region link is already in use.' : 'Region creation failed.') }
    finally { setSaving(false) }
  }

  function beginNameEdit(type: 'region' | 'branch', id: string, name: string) {
    setEditingName({ type, id })
    setNameDraft(name)
    setError(null)
  }

  async function saveName(event: FormEvent) {
    event.preventDefault()
    if (!editingName || !nameDraft.trim()) return
    setSaving(true); setError(null)
    try {
      if (editingName.type === 'region') await renameDashboardRegion(editingName.id, nameDraft.trim())
      else await renameDashboardBranch(editingName.id, nameDraft.trim())
      setEditingName(null)
      setNameDraft('')
      await onBranchesChanged()
    } catch {
      setError(t('Name update failed.'))
    } finally { setSaving(false) }
  }

  async function uploadQr(branchId: string, file: File | undefined) {
    if (!file) return
    try { await uploadDashboardPaymentQr(branchId, file); await onBranchesChanged() } catch (err) { setError(err instanceof ApiError && err.code === 'file_too_large' ? t('Payment QR is too large.') : t('Payment QR update failed.')) }
  }

  async function removeQr(branchId: string) {
    try { await deleteDashboardPaymentQr(branchId); await onBranchesChanged() } catch { setError(t('Payment QR update failed.')) }
  }

  async function copyStoreLink(branch: DashboardBranch) {
    if (!branch.slug) return
    try {
      const regionSlug = regions.find((region) => region.id === branch.regionId)?.slug
      if (!regionSlug) return
      await navigator.clipboard.writeText(buildLocationLink(tenantSlug, regionSlug, branch.slug))
      setCopiedBranchId(branch.id)
      window.setTimeout(() => setCopiedBranchId((current) => current === branch.id ? null : current), 1800)
    } catch {
      setError(t('Could not copy link.'))
    }
  }

  async function createRule(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null)
    try { await createDashboardPricingRule({ name: newRuleName.trim(), sortOrder: pricingRules.length }); setNewRuleName(''); await onBranchesChanged() }
    catch { setError('Price rule could not be created.') } finally { setSaving(false) }
  }

  async function saveDeliveryFee(rule: DashboardPricingRule) {
    const amount = Number(deliveryFeeDrafts[rule.id])
    const deliveryFeeSen = Math.round(amount * 100)
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(deliveryFeeSen)) {
      setError('Enter a valid delivery fee.')
      return
    }
    setSaving(true); setError(null)
    try { await updateDashboardPricingRule(rule.id, { deliveryFeeSen }); await onBranchesChanged() }
    catch { setError('Delivery fee could not be updated.') } finally { setSaving(false) }
  }

  async function changeBranchRule(branchId: string, pricingRuleId: string) {
    setSaving(true); setError(null)
    try { await assignDashboardBranchPricingRule(branchId, pricingRuleId || null); await onBranchesChanged() }
    catch { setError('Location price rule could not be updated.') } finally { setSaving(false) }
  }

  const regionViews = groupStoresForActiveRegion(regions, allBranches, activeRegionId)
  return <div className="space-y-6">
    <section className="max-w-3xl rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">{t('Regions and stores')}</h2>
      {canManage && <form onSubmit={createRegion} className="mt-4 grid gap-3 border-b border-slate-100 pb-5 sm:grid-cols-[1fr_1fr_auto]"><input required value={regionName} onChange={(event) => setRegionName(event.target.value)} placeholder={t('Region name')} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /><input required value={regionSlug} onChange={(event) => setRegionSlug(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder={t('region-link')} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /><button type="submit" disabled={saving || !regionName.trim() || !regionSlug.trim()} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{t('Add region')}</button></form>}
      <div className="mt-5 space-y-4">
        {regionViews.map(({ region, stores, isActive }) => <section key={region.id} className={`rounded-xl border p-4 ${isActive ? 'border-slate-400 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="flex flex-wrap items-center gap-2">{editingName?.type === 'region' && editingName.id === region.id ? <form onSubmit={(event) => void saveName(event)} className="flex flex-wrap items-center gap-2"><input autoFocus required maxLength={120} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} aria-label={t('Region name')} className="rounded border border-slate-300 px-2 py-1.5 text-sm" /><button type="submit" disabled={saving || !nameDraft.trim()} className="rounded border border-slate-300 px-2 py-1.5 text-xs disabled:opacity-50">{t('Save changes')}</button><button type="button" disabled={saving} onClick={() => setEditingName(null)} className="rounded border border-slate-300 px-2 py-1.5 text-xs">{t('Cancel')}</button></form> : <><h3 className="font-semibold text-slate-950">{region.name}</h3>{canManage && <button type="button" onClick={() => beginNameEdit('region', region.id, region.name)} className="text-xs font-medium text-slate-600 hover:text-slate-950">{t('Edit')}</button>}</>} </div><span className="text-xs text-slate-400">/{region.slug}</span></div>
          <div className="mt-3 space-y-2">
            {stores.length > 0 ? stores.map((branch) => { const link = branch.slug ? buildLocationLink(tenantSlug, region.slug, branch.slug) : ''; return <div key={branch.id} className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0">{editingName?.type === 'branch' && editingName.id === branch.id ? <form onSubmit={(event) => void saveName(event)} className="flex flex-wrap items-center gap-2"><input autoFocus required maxLength={120} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} aria-label={t('Store name')} className="min-w-0 rounded border border-slate-300 px-2 py-1.5 text-sm" /><button type="submit" disabled={saving || !nameDraft.trim()} className="rounded border border-slate-300 px-2 py-1.5 text-xs disabled:opacity-50">{t('Save changes')}</button><button type="button" disabled={saving} onClick={() => setEditingName(null)} className="rounded border border-slate-300 px-2 py-1.5 text-xs">{t('Cancel')}</button></form> : <div className="flex items-center gap-2"><p className="font-medium text-slate-900">{branch.name}</p>{canManage && <button type="button" onClick={() => beginNameEdit('branch', branch.id, branch.name)} className="text-xs font-medium text-slate-600 hover:text-slate-950">{t('Edit')}</button>}</div>}<p className="truncate text-xs text-slate-500">{link}</p></div><div className="flex items-center gap-2"><a href={link} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-xs">{t('Open store')}</a><button type="button" onClick={() => void copyStoreLink(branch)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">{copiedBranchId === branch.id ? t('Copied') : t('Copy link')}</button></div></div><div className="mt-3 flex flex-wrap items-center gap-3">{branch.hasPaymentQr && <img src={`/api/dashboard/branches/${branch.id}/payment-qr`} alt={t('Payment QR code')} className="h-16 w-16 rounded border border-slate-200 object-contain p-1" />}<label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50">{branch.hasPaymentQr ? t('Change payment QR') : t('Upload payment QR')}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void uploadQr(branch.id, event.target.files?.[0])} /></label>{branch.hasPaymentQr && <button type="button" onClick={() => void removeQr(branch.id)} className="text-xs text-red-600">{t('Remove payment QR')}</button>}{canManage && <label className="ml-auto text-xs font-medium text-slate-600">Price rule <select value={branch.pricingRuleId ?? ''} disabled={saving} onChange={(event) => void changeBranchRule(branch.id, event.target.value)} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1.5"><option value="">Not set</option>{pricingRules.filter((rule) => rule.isActive).map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select></label>}</div></div> }) : <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">{t('No stores in this region yet.')}</p>}
          </div>
          {canManage && <form onSubmit={(event) => void createBranch(event, region.id, stores.length)} className="mt-4 border-t border-slate-200 pt-4"><div className="grid gap-3 sm:grid-cols-2"><input required value={branchDrafts[region.id]?.name ?? ''} onChange={(event) => setBranchDrafts((current) => ({ ...current, [region.id]: { ...current[region.id], name: event.target.value, slug: current[region.id]?.slug ?? '' } }))} placeholder={t('Store name')} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /><input required value={branchDrafts[region.id]?.slug ?? ''} onChange={(event) => setBranchDrafts((current) => ({ ...current, [region.id]: { ...current[region.id], name: current[region.id]?.name ?? '', slug: event.target.value } }))} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder={t('store-link')} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /><select aria-label="Delivery period" value={newDeliveryPeriod} onChange={(event) => setNewDeliveryPeriod(event.target.value as 'lunch' | 'dinner' | '')} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Any meal period</option><option value="lunch">Morning / lunch</option><option value="dinner">Afternoon / dinner</option></select></div><label className="mt-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={syncDefault} onChange={(event) => setSyncDefault(event.target.checked)} />{t('Copy the default menu once')}</label><button type="submit" disabled={saving || !branchDrafts[region.id]?.name.trim() || !branchDrafts[region.id]?.slug.trim()} className="mt-3 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{t('Add store')}</button></form>}
        </section>)}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </section>
    <section className="max-w-3xl rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Price rules</h2><p className="mt-1 text-sm text-slate-500">Set the fixed delivery fee charged once per order. Meal prices stay at their listed base price.</p>{canManage && <form onSubmit={createRule} className="mt-4 flex gap-2"><input required value={newRuleName} onChange={(event) => setNewRuleName(event.target.value)} maxLength={80} placeholder="e.g. Klang Valley delivery" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /><button type="submit" disabled={saving || !newRuleName.trim()} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">Add rule</button></form>}<div className="mt-4 divide-y divide-slate-100">{pricingRules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><span className="font-medium">{rule.name}</span><label className="ml-4 text-xs text-slate-600">Delivery fee (RM)<input disabled={!canManage || saving} value={deliveryFeeDrafts[rule.id] ?? '0.00'} onChange={(event) => setDeliveryFeeDrafts((current) => ({ ...current, [rule.id]: event.target.value }))} type="number" min="0" step="0.01" className="ml-2 w-28 rounded border border-slate-300 px-2 py-1.5 text-sm" /></label></div>{canManage && <div className="flex items-center gap-2"><button type="button" disabled={saving || deliveryFeeDrafts[rule.id] === (rule.deliveryFeeSen / 100).toFixed(2)} onClick={() => void saveDeliveryFee(rule)} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">Save fee</button><button type="button" onClick={() => void updateDashboardPricingRule(rule.id, { isActive: !rule.isActive }).then(() => onBranchesChanged())} className="rounded border border-slate-300 px-2 py-1 text-xs">{rule.isActive ? 'Active' : 'Inactive'}</button><button type="button" onClick={() => void deleteDashboardPricingRule(rule.id).then(() => onBranchesChanged()).catch(() => setError('This price rule is still used by a location or meal.'))} className="text-xs text-red-600">Delete</button></div>}</div>)}{pricingRules.length === 0 && <p className="py-4 text-sm text-slate-500">Add a rule before creating scheduled meals.</p>}</div></section>
  </div>
}

function Catalog({ products, categories, pricingRules, branchId, canManage, onCreated }: { products: DashboardProduct[]; categories: DashboardCategory[]; pricingRules: DashboardPricingRule[]; branchId: string | null; canManage: boolean; onCreated: () => Promise<void> }) {
  const { t } = useLanguage()
  const [productName, setProductName] = useState('')
  const [price, setPrice] = useState('')
  const [kind, setKind] = useState<'add_on' | 'scheduled_meal' | 'recurring_meal'>('add_on')
  const [serviceDate, setServiceDate] = useState('')
  const [servicePeriod, setServicePeriod] = useState<'lunch' | 'dinner'>('lunch')
  const [cutoffMalaysiaTime, setCutoffMalaysiaTime] = useState('09:00')
  const [weeklyDay, setWeeklyDay] = useState(1)
  const [weeklyCutoffTime, setWeeklyCutoffTime] = useState('09:00')
  const [categoryId, setCategoryId] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingPrice, setEditingPrice] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState('')
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null)
  const [editingAvailable, setEditingAvailable] = useState(true)
  const [editingKind, setEditingKind] = useState<ProductKind>('add_on')
  const [editingServiceDate, setEditingServiceDate] = useState('')
  const [editingServicePeriod, setEditingServicePeriod] = useState<'lunch' | 'dinner'>('lunch')
  const [editingCutoffMalaysiaTime, setEditingCutoffMalaysiaTime] = useState('09:00')
  const [editingWeeklyDay, setEditingWeeklyDay] = useState(1)
  const [editingWeeklyCutoffTime, setEditingWeeklyCutoffTime] = useState('09:00')
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
    const scheduleError = validateScheduledMealDraft({ kind, serviceDate, servicePeriod, cutoffMalaysiaTime, weeklyDay, weeklyCutoffTime })
    if (scheduleError) { setError(scheduleError); return }
    setSaving(true); setError(null)
    try { await createDashboardProduct({ name: productName.trim(), imageUrl, priceSen, categoryId: categoryId || null, isPublic: true, isAvailable: true, kind, serviceDate: kind === 'scheduled_meal' ? serviceDate : undefined, servicePeriod, cutoffMalaysiaTime, weeklyDay: kind === 'recurring_meal' ? weeklyDay : undefined, weeklyCutoffTime: kind === 'recurring_meal' ? weeklyCutoffTime : undefined, branchId }); setProductName(''); setPrice(''); setCategoryId(''); setImageUrl(null); setServiceDate(''); await onCreated() } catch (err) { setError(err instanceof ApiError && err.code === 'invalid_scheduled_meal' ? 'Assign an active price rule to this location before publishing a meal.' : t('Product creation failed.')) } finally { setSaving(false) }
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
    const nextKind = getProductKind(product)
    setEditingId(product.id)
    setEditingName(product.name)
    setEditingPrice((product.priceSen / 100).toFixed(2))
    setEditingCategoryId(product.categoryId ?? '')
    setEditingImageUrl(product.imageUrl)
    setEditingAvailable(product.isAvailable)
    setEditingKind(nextKind)
    setEditingServiceDate(product.serviceDate ?? '')
    setEditingServicePeriod(product.servicePeriod ?? 'lunch')
    setEditingCutoffMalaysiaTime(formatMalaysiaTime(product.orderCutoffAt) || (product.servicePeriod === 'dinner' ? '13:00' : '09:00'))
    setEditingWeeklyDay(product.weeklyDay ?? 1)
    setEditingWeeklyCutoffTime(product.weeklyCutoffTime ?? (product.servicePeriod === 'dinner' ? '13:00' : '09:00'))
    setError(null)
  }

  function cancelEditing() {
    setEditingId(null)
    setEditingName('')
    setEditingPrice('')
    setEditingCategoryId('')
    setEditingImageUrl(null)
    setEditingKind('add_on')
    setEditingServiceDate('')
    setEditingServicePeriod('lunch')
    setEditingCutoffMalaysiaTime('09:00')
    setEditingWeeklyDay(1)
    setEditingWeeklyCutoffTime('09:00')
  }

  async function saveProduct(productId: string) {
    const priceSen = Math.round(Number(editingPrice) * 100)
    if (!editingName.trim() || !Number.isFinite(priceSen) || priceSen < 0) { setError(t('Enter a valid product name and price.')); return }
    const scheduleError = validateScheduledMealDraft({
      kind: editingKind,
      serviceDate: editingServiceDate,
      servicePeriod: editingServicePeriod,
      cutoffMalaysiaTime: editingCutoffMalaysiaTime,
      weeklyDay: editingWeeklyDay,
      weeklyCutoffTime: editingWeeklyCutoffTime,
    })
    if (scheduleError) { setError(scheduleError); return }
    setSaving(true); setError(null)
    try {
      await updateDashboardProduct(productId, {
        name: editingName.trim(), priceSen, categoryId: editingCategoryId || null, imageUrl: editingImageUrl, isAvailable: editingAvailable,
        kind: editingKind,
        serviceDate: editingKind === 'scheduled_meal' ? editingServiceDate : undefined,
        servicePeriod: editingKind === 'add_on' ? undefined : editingServicePeriod,
        cutoffMalaysiaTime: editingKind === 'scheduled_meal' ? editingCutoffMalaysiaTime : undefined,
        weeklyDay: editingKind === 'recurring_meal' ? editingWeeklyDay : undefined,
        weeklyCutoffTime: editingKind === 'recurring_meal' ? editingWeeklyCutoffTime : undefined,
      }, branchId)
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
      {canManage && <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex gap-1 rounded-md bg-slate-200/70 p-1"><button type="button" onClick={() => setKind('add_on')} className={`rounded px-3 py-1.5 text-sm ${kind === 'add_on' ? 'bg-white shadow-sm' : 'text-slate-600'}`}>Add-on</button><button type="button" onClick={() => setKind('scheduled_meal')} className={`rounded px-3 py-1.5 text-sm ${kind === 'scheduled_meal' ? 'bg-white shadow-sm' : 'text-slate-600'}`}>One-time meal</button><button type="button" onClick={() => setKind('recurring_meal')} className={`rounded px-3 py-1.5 text-sm ${kind === 'recurring_meal' ? 'bg-white shadow-sm' : 'text-slate-600'}`}>Weekly meal</button></div>{kind !== 'add_on' && <div className="mt-3 grid gap-3 md:grid-cols-3">{kind === 'recurring_meal' ? <><label className="text-sm font-medium">Repeat every week<select value={weeklyDay} onChange={(event) => setWeeklyDay(Number(event.target.value))} className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5"><option value={1}>Monday</option><option value={2}>Tuesday</option><option value={3}>Wednesday</option><option value={4}>Thursday</option><option value={5}>Friday</option></select></label><label className="text-sm font-medium">Meal period<select value={servicePeriod} onChange={(event) => { const next = event.target.value as 'lunch' | 'dinner'; setServicePeriod(next); setWeeklyCutoffTime(next === 'lunch' ? '09:00' : '13:00') }} className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5"><option value="lunch">Lunch</option><option value="dinner">Dinner</option></select></label><label className="text-sm font-medium">Order cutoff, Malaysia time<input value={weeklyCutoffTime} onChange={(event) => setWeeklyCutoffTime(event.target.value)} type="time" className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5" /></label></> : <><label className="text-sm font-medium">Service date<input value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} type="date" className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5" /></label><label className="text-sm font-medium">Meal period<select value={servicePeriod} onChange={(event) => { const next = event.target.value as 'lunch' | 'dinner'; setServicePeriod(next); setCutoffMalaysiaTime(next === 'lunch' ? '09:00' : '13:00') }} className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5"><option value="lunch">Lunch</option><option value="dinner">Dinner</option></select></label><label className="text-sm font-medium">Cutoff, Malaysia time<input value={cutoffMalaysiaTime} onChange={(event) => setCutoffMalaysiaTime(event.target.value)} type="time" className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5" /></label></>}{pricingRules.filter((rule) => rule.isActive).length === 0 && <p className="col-span-full text-sm text-amber-800">Assign a price rule to this location before publishing a meal.</p>}</div>}</div>}
      {canManage && <div className="mt-4 space-y-3 border-t border-slate-100 pt-4"><div className="grid gap-3 md:grid-cols-[1fr_140px_180px_auto]"><input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder={t('Product name')} aria-label={t('Product name')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={price} onChange={(event) => setPrice(event.target.value)} placeholder={t('Price RM')} type="number" min="0" step="0.01" aria-label={t('Price RM')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label={t('Product category')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">{t('Uncategorized')}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><button type="button" onClick={() => void addProduct()} disabled={saving || imageLoading} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{t('Add product')}</button></div><div className="flex flex-wrap items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"><input type="file" accept="image/*" onChange={(event) => void handleImage(event, 'new')} className="sr-only" />{imageLoading ? t('Image is being optimized...') : imageUrl ? t('Change image') : t('Upload image')}</label>{imageUrl && <><img src={imageUrl} alt={t('Product image')} className="h-12 w-12 rounded-lg object-cover" /><button type="button" onClick={() => setImageUrl(null)} className="text-xs font-medium text-red-600">{t('Remove image')}</button></>}</div></div>}
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4"><h3 className="font-semibold">{t('Existing products')}</h3></div>
      {products.length === 0 ? <p className="px-4 py-10 text-center text-sm text-slate-500">{t('No products yet.')}</p> : <div className="divide-y divide-slate-100">{products.map((product) => editingId === product.id
        ? <ProductEditPanel key={product.id} categories={categories} name={editingName} price={editingPrice} categoryId={editingCategoryId} imageUrl={editingImageUrl} available={editingAvailable} kind={editingKind} serviceDate={editingServiceDate} servicePeriod={editingServicePeriod} cutoffMalaysiaTime={editingCutoffMalaysiaTime} weeklyDay={editingWeeklyDay} weeklyCutoffTime={editingWeeklyCutoffTime} saving={saving} imageLoading={imageLoading} onNameChange={setEditingName} onPriceChange={setEditingPrice} onCategoryChange={setEditingCategoryId} onImage={(event) => void handleImage(event, 'edit')} onImageRemove={() => setEditingImageUrl(null)} onAvailableChange={setEditingAvailable} onKindChange={setEditingKind} onServiceDateChange={setEditingServiceDate} onServicePeriodChange={setEditingServicePeriod} onCutoffChange={setEditingCutoffMalaysiaTime} onWeeklyDayChange={setEditingWeeklyDay} onWeeklyCutoffChange={setEditingWeeklyCutoffTime} onSave={() => void saveProduct(product.id)} onCancel={cancelEditing} />
        : <div key={product.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"><div className="flex min-w-0 items-center gap-3">{product.imageUrl && <img src={product.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="break-words font-medium">{product.name}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{productKindLabel(getProductKind(product))}</span></div><p className="text-sm text-slate-500">{formatSen(product.priceSen)} · {product.categoryName ?? t('Uncategorized')}</p></div></div><div className="flex flex-wrap items-center gap-2"><button type="button" disabled={!canManage} onClick={() => startEditing(product)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t('Edit')}</button><button type="button" disabled={!canManage} onClick={() => void toggleAvailability(product)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${product.isAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{product.isAvailable ? t('Available') : t('Unavailable')}</button><button type="button" disabled={!canManage} onClick={() => void deleteProduct(product)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">{t('Delete')}</button></div></div>)} </div>}
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">{t('Categories')}</h3>{canManage && <form onSubmit={addCategory} className="mt-3 flex gap-2"><input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder={t('New category name')} aria-label={t('New category name')} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="submit" disabled={saving} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">{t('Add category')}</button></form>}<div className="mt-4 flex flex-wrap gap-2">{categories.map((category) => <span key={category.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 pl-3 pr-2 py-1 text-sm text-slate-600">{category.name}{canManage && <button type="button" disabled={saving} onClick={() => void deleteCategory(category)} className="rounded-full px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50">{t('Delete')}</button>}</span>)}</div></section>
  </div>
}

function productKindLabel(kind: ProductKind) {
  return kind === 'add_on' ? 'Add-on' : kind === 'scheduled_meal' ? 'One-time meal' : 'Weekly meal'
}

type ProductEditPanelProps = {
  categories: DashboardCategory[]
  name: string
  price: string
  categoryId: string
  imageUrl: string | null
  available: boolean
  kind: ProductKind
  serviceDate: string
  servicePeriod: 'lunch' | 'dinner'
  cutoffMalaysiaTime: string
  weeklyDay: number
  weeklyCutoffTime: string
  saving: boolean
  imageLoading: boolean
  onNameChange: (value: string) => void
  onPriceChange: (value: string) => void
  onCategoryChange: (value: string) => void
  onImage: (event: ChangeEvent<HTMLInputElement>) => void
  onImageRemove: () => void
  onAvailableChange: (value: boolean) => void
  onKindChange: (value: ProductKind) => void
  onServiceDateChange: (value: string) => void
  onServicePeriodChange: (value: 'lunch' | 'dinner') => void
  onCutoffChange: (value: string) => void
  onWeeklyDayChange: (value: number) => void
  onWeeklyCutoffChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}

function ProductEditPanel({ categories, name, price, categoryId, imageUrl, available, kind, serviceDate, servicePeriod, cutoffMalaysiaTime, weeklyDay, weeklyCutoffTime, saving, imageLoading, onNameChange, onPriceChange, onCategoryChange, onImage, onImageRemove, onAvailableChange, onKindChange, onServiceDateChange, onServicePeriodChange, onCutoffChange, onWeeklyDayChange, onWeeklyCutoffChange, onSave, onCancel }: ProductEditPanelProps) {
  return <div className="space-y-3 bg-slate-50 px-4 py-4">
    <div className="grid gap-3 md:grid-cols-[1fr_140px_180px]">
      <input value={name} onChange={(event) => onNameChange(event.target.value)} aria-label="Product name" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
      <input value={price} onChange={(event) => onPriceChange(event.target.value)} aria-label="Price RM" type="number" min="0" step="0.01" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
      <select value={categoryId} onChange={(event) => onCategoryChange(event.target.value)} aria-label="Product category" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Uncategorized</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
    </div>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="text-sm font-medium">Product type<select value={kind} onChange={(event) => onKindChange(event.target.value as ProductKind)} className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5"><option value="add_on">Add-on</option><option value="scheduled_meal">One-time meal</option><option value="recurring_meal">Weekly meal</option></select></label>
      {kind === 'scheduled_meal' && <label className="text-sm font-medium">Service date<input value={serviceDate} onChange={(event) => onServiceDateChange(event.target.value)} type="date" className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5" /></label>}
      {kind === 'recurring_meal' && <label className="text-sm font-medium">Repeat every week<select value={weeklyDay} onChange={(event) => onWeeklyDayChange(Number(event.target.value))} className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5"><option value={1}>Monday</option><option value={2}>Tuesday</option><option value={3}>Wednesday</option><option value={4}>Thursday</option><option value={5}>Friday</option></select></label>}
      {kind !== 'add_on' && <label className="text-sm font-medium">Meal period<select value={servicePeriod} onChange={(event) => onServicePeriodChange(event.target.value as 'lunch' | 'dinner')} className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5"><option value="lunch">Lunch</option><option value="dinner">Dinner</option></select></label>}
      {kind === 'scheduled_meal' && <label className="text-sm font-medium">Cutoff, Malaysia time<input value={cutoffMalaysiaTime} onChange={(event) => onCutoffChange(event.target.value)} type="time" className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5" /></label>}
      {kind === 'recurring_meal' && <label className="text-sm font-medium">Order cutoff, Malaysia time<input value={weeklyCutoffTime} onChange={(event) => onWeeklyCutoffChange(event.target.value)} type="time" className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5" /></label>}
    </div>
    <div className="flex flex-wrap items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"><input type="file" accept="image/*" onChange={onImage} className="sr-only" />{imageLoading ? 'Image is being optimized...' : imageUrl ? 'Change image' : 'Upload image'}</label>{imageUrl && <><img src={imageUrl} alt="Product image" className="h-12 w-12 rounded-lg object-cover" /><button type="button" onClick={onImageRemove} className="text-xs font-medium text-red-600">Remove image</button></>}<label className="inline-flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={available} onChange={(event) => onAvailableChange(event.target.checked)} />Available</label></div>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={saving || imageLoading} onClick={onSave} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Save changes</button><button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Cancel</button></div>
    <p className="text-xs text-slate-500">Editing {productKindLabel(kind)} settings.</p>
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
  const [accounts, setAccounts] = useState<{ id: string; username: string; configured: boolean }[]>([])
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
      <div><label htmlFor="telegram-account" className="mb-1.5 block text-sm font-medium">{t('Dashboard account')}</label><select id="telegram-account" value={accountUserId} onChange={(event) => setAccountUserId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5">{accounts.map((account) => <option key={account.id} value={account.id}>{account.username}</option>)}</select></div>
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
  const [username, setUsername] = useState('')
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
      await createDashboardUser({ username: username.trim(), password, role })
      setUsername('')
      setPassword('')
      setRole('staff')
      await onCreated()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'username_taken') setError(t('This username is already in use.'))
      else if (err instanceof ApiError && err.code === 'invalid_input') setError(t('Enter a valid username, password, and role.'))
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
        <label className="block text-sm font-medium">{t('Username')}<input required autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}" value={username} onChange={(event) => setUsername(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /><span className="mt-1 block text-xs font-normal text-slate-400">{t('Use 3–32 letters, numbers, underscores, or hyphens; it must start with a letter or number.')}</span></label>
        <label className="block text-sm font-medium">{t('Password')}<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /><span className="mt-1 block text-xs font-normal text-slate-400">{t('At least 8 characters.')}</span></label>
        <label className="block text-sm font-medium">{t('Account role')}<select value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"><option value="admin">{t('Admin')}</option><option value="staff">{t('Staff')}</option><option value="viewer">{t('Viewer')}</option></select></label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={saving || !username.trim() || password.length < 8} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? t('Creating...') : t('Add account')}</button>
      </form>
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4"><h3 className="font-semibold">{t('Organization accounts')}</h3></div>
      <div className="divide-y divide-slate-100">{users.map((user) => editingId === user.id ? <div key={user.id} className="space-y-3 bg-slate-50 px-4 py-3"><p className="break-all text-sm font-medium">{user.username}</p><div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"><select disabled={user.role === 'owner'} value={editingRole} onChange={(event) => setEditingRole(event.target.value as typeof editingRole)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"><option value="admin">{t('Admin')}</option><option value="staff">{t('Staff')}</option><option value="viewer">{t('Viewer')}</option></select><input type="password" value={editingPassword} onChange={(event) => setEditingPassword(event.target.value)} minLength={8} placeholder={t('Password (leave blank to keep current)')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /><button type="button" disabled={saving || (editingPassword.length > 0 && editingPassword.length < 8)} onClick={() => void saveUser(user)} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{t('Save changes')}</button><button type="button" disabled={saving} onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">{t('Cancel')}</button></div></div> : <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{user.tenantName ?? user.username}</p><p className="break-all text-xs text-slate-500">{user.username}</p>{user.isCurrentUser && <span className="ml-2 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">{t('Your account')}</span>}</div><div className="flex items-center gap-2"><span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{t(user.role === 'owner' ? 'Store owner' : user.role[0].toUpperCase() + user.role.slice(1))}</span>{!user.isCurrentUser && <button type="button" onClick={() => startEditing(user)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">{t('Edit')}</button>}</div></div>)}</div>
    </section>
  </div>
}
