import { Link, useLocation, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { deletePaymentReceipt, formatSen, getStore, uploadPaymentReceipt, type CreateOrderResponse } from '../lib/api'
import { LanguageToggle, useLanguage } from '../lib/i18n'
import { getPublicStorePath, getStoreUrlBase } from '../lib/storePath'

export default function OrderConfirmationPage() {
  const { slug, regionSlug, locationSlug } = useParams<{ slug: string; regionSlug?: string; locationSlug?: string }>()
  const storePath = getPublicStorePath(slug, regionSlug, locationSlug)
  const storeUrlBase = getStoreUrlBase(slug, regionSlug, locationSlug)
  const location = useLocation()
  const order = location.state as CreateOrderResponse | null
  const { t } = useLanguage()
  const currentStorePath = storePath
  const [paymentQrUrl, setPaymentQrUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'uploaded' | 'cancelling' | 'error'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  useEffect(() => { if (currentStorePath) void getStore(currentStorePath).then((store) => setPaymentQrUrl(store.paymentQrUrl)).catch(() => setPaymentQrUrl(null)) }, [currentStorePath])
  const safeStorePath = currentStorePath
  async function uploadReceipt(file: File) {
    if (!order) return
    setUploadState('uploading'); setUploadError(null)
    try { await uploadPaymentReceipt(safeStorePath, order.orderId, file); setUploadState('uploaded') } catch (err) { setUploadState('error'); setUploadError(err instanceof Error && err.message === 'file_too_large' ? t('Payment receipt is too large.') : t('Payment receipt upload failed.')) }
  }
  async function cancelReceipt() {
    if (!order) return
    setUploadState('cancelling'); setUploadError(null)
    try { await deletePaymentReceipt(safeStorePath, order.orderId); setSelectedFile(null); setUploadState('idle') } catch { setUploadState('uploaded'); setUploadError(t('Payment receipt cancellation failed.')) }
  }
  function chooseFile(file: File | undefined) {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) { setUploadError(t('Choose an image or PDF receipt.')); setSelectedFile(null); return }
    if (file.size > 5 * 1024 * 1024) { setUploadError(t('Payment receipt is too large.')); setSelectedFile(null); return }
    setUploadError(null); setSelectedFile(file); void uploadReceipt(file)
  }
  return <div className="flex min-h-screen items-center justify-center bg-[#f6f7f4] px-4 py-8 text-slate-950"><section className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm"><div className="absolute right-4 top-4"><LanguageToggle /></div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div><h1 className="mt-5 text-2xl font-semibold">{t('Order submitted')}</h1>{order ? <><p className="mt-3 text-slate-600">{t('Order number')} <span className="font-mono font-semibold text-slate-950">{order.orderNumber}</span></p><div className="mt-3 space-y-1 text-sm"><p>{t('Items subtotal')}: {formatSen(order.totalSen - order.deliveryFeeSen)}</p>{order.deliveryFeeSen > 0 && <p>{t('Delivery fee')} · {order.pricingRuleName}: {formatSen(order.deliveryFeeSen)}</p>}<p className="pt-1 text-lg font-semibold">{t('Total')}: {formatSen(order.totalSen)}</p></div><p className="mt-4 text-sm leading-6 text-slate-500">{t('The store received your order and will contact you by phone to confirm.')}</p>{paymentQrUrl && <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"><h2 className="font-semibold">{t('Pay using this QR code')}</h2><img src={paymentQrUrl} alt={t('Seller payment QR code')} className="mx-auto mt-3 max-h-56 w-auto rounded-lg bg-white object-contain p-2" /><p className="mt-2 text-xs text-slate-500">{t('After payment, choose your receipt and it will upload automatically.')}</p><label className="mt-4 block cursor-pointer rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-600"><span>{selectedFile?.name ?? t('Choose payment receipt')}</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; chooseFile(file) }} /></label>{uploadState === 'uploading' && <p className="mt-3 text-sm font-medium text-slate-600">{t('Uploading...')}</p>}{uploadState === 'uploaded' && <div className="mt-3 space-y-3"><p className="text-sm font-medium text-emerald-700">{t('Payment receipt uploaded')}</p><button type="button" onClick={() => void cancelReceipt()} className="w-full rounded-lg border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">{t('Cancel payment receipt')}</button></div>}{uploadState === 'cancelling' && <p className="mt-3 text-sm font-medium text-slate-600">{t('Cancelling...')}</p>}{uploadError && <p className="mt-3 text-sm text-red-700">{uploadError}</p>}</div>}</> : <p className="mt-4 text-sm text-slate-500">{t('The order has been submitted. Keep the store contact details for confirmation.')}</p>}<Link to={storeUrlBase} className="mt-7 inline-flex rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">{t('Continue ordering')}</Link></section></div>
}
