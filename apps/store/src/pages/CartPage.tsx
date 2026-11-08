import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useCart } from '../cart/CartContext'
import { cartLineKey } from '../cart/CartContext'
import { ApiError, formatSen, submitOrder } from '../lib/api'
import { LanguageToggle, useLanguage } from '../lib/i18n'
import { getPublicStorePath, getStoreUrlBase } from '../lib/storePath'

function newIdempotencyKey(): string { return crypto.randomUUID() }

export default function CartPage() {
  const { slug, regionSlug, locationSlug } = useParams<{ slug: string; regionSlug?: string; locationSlug?: string }>()
  const storePath = getPublicStorePath(slug, regionSlug, locationSlug)
  const storeUrlBase = getStoreUrlBase(slug, regionSlug, locationSlug)
  const navigate = useNavigate()
  const { lines, setQuantity, removeItem, totalSen, clear } = useCart()
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey] = useState(newIdempotencyKey)
  const storeSlug = storePath

  async function handleCheckout() {
    if (lines.length === 0 || !name.trim() || !phone.trim()) return
    setSubmitting(true); setError(null)
    try {
      const order = await submitOrder(storeSlug, { idempotencyKey, customer: { name: name.trim(), phone: phone.trim() }, remark: remark.trim() || undefined, items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, serviceDate: line.product.serviceDate ?? undefined })) })
      clear(); navigate(`${storeUrlBase}/order/${order.orderId}`, { state: order })
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_order' ? t('A meal in your cart has closed or is no longer available. Please return to the menu.') : err instanceof ApiError && err.code === 'invalid_input' ? t('Please check your name and phone number.') : t('Order submission failed. Please try again later.'))
    } finally { setSubmitting(false) }
  }

  return <div className="min-h-screen bg-[#f6f7f4] text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6"><div className="flex items-center gap-4"><Link to={storeUrlBase} className="text-sm font-medium text-slate-500 hover:text-slate-950">← {t('Back to menu')}</Link><h1 className="text-xl font-semibold">{t('Confirm order')}</h1></div><LanguageToggle /></div></header>
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-10">
      {lines.length === 0 ? <section className="rounded-2xl border border-slate-200 bg-white px-5 py-16 text-center"><p className="font-medium">{t('Your cart is empty')}</p><Link to={storeUrlBase} className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">{t('Choose products')}</Link></section> : <>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">{t('Order details')}</h2></div><div className="divide-y divide-slate-100">{lines.map((line) => <div key={cartLineKey(line.product)} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate font-medium">{line.product.name}</p>{line.product.serviceDate && line.product.servicePeriod && <p className="mt-1 text-xs text-amber-700">{line.product.serviceDate} · {t(line.product.servicePeriod === 'lunch' ? 'Lunch' : 'Dinner')}</p>}<p className="mt-1 text-sm text-slate-500">{formatSen(line.product.priceSen)} {t('per item')}</p></div><div className="flex shrink-0 items-center gap-2"><button type="button" aria-label={t('Decrease {name}', { name: line.product.name })} onClick={() => setQuantity(line.product, line.quantity - 1)} className="h-8 w-8 rounded-lg border border-slate-300 text-lg leading-none hover:bg-slate-50">−</button><span className="w-6 text-center text-sm font-semibold">{line.quantity}</span><button type="button" aria-label={t('Increase {name}', { name: line.product.name })} onClick={() => setQuantity(line.product, Math.min(100, line.quantity + 1))} className="h-8 w-8 rounded-lg border border-slate-300 text-lg leading-none hover:bg-slate-50">+</button><button type="button" onClick={() => removeItem(line.product)} className="ml-2 text-xs font-medium text-slate-400 hover:text-red-600">{t('Remove')}</button></div></div>)}</div><div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-lg font-semibold"><span>{t('Total')}</span><span>{formatSen(totalSen)}</span></div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{t('Contact details')}</h2><p className="mt-1 text-sm text-slate-500">{t('The store will contact you by phone to confirm your order.')}</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">{t('Name')}<input required value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" placeholder={t('What should we call you?')} /></label><label className="text-sm font-medium">{t('Phone number')}<input required value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={20} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" placeholder={t('e.g. 0123456789')} /></label></div><label className="mt-4 block text-sm font-medium">{t('Order remark')}<textarea value={remark} onChange={(event) => setRemark(event.target.value)} maxLength={500} rows={3} className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" placeholder={t('Remark placeholder')} /></label></section>
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button type="button" onClick={() => void handleCheckout()} disabled={submitting || !name.trim() || !phone.trim()} className="w-full rounded-xl bg-slate-950 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? t('Submitting...') : `${t('Submit order')} · ${formatSen(totalSen)}`}</button>
      </>}
    </main>
  </div>
}
