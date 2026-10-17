import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCategories, getProducts, getStore, formatSen } from '../lib/api'
import type { Category, Product, StoreInfo } from '../lib/api'
import { useCart } from '../cart/CartContext'
import { LanguageToggle, useLanguage } from '../lib/i18n'

export default function StorePage() {
  const { slug, locationSlug } = useParams<{ slug: string; locationSlug?: string }>()
  const storePath = slug && locationSlug ? `${slug}/${locationSlug}` : slug
  const [store, setStore] = useState<StoreInfo | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading')
  const [addedProduct, setAddedProduct] = useState<string | null>(null)
  const { addItem, totalItems, totalSen, lines } = useCart()
  const { t } = useLanguage()

  useEffect(() => {
    if (!storePath) return
    setStatus('loading')
    Promise.all([getStore(storePath), getCategories(storePath), getProducts(storePath)])
      .then(([storeRes, categoriesRes, productsRes]) => {
        setStore(storeRes)
        setCategories(categoriesRes.categories)
        setProducts(productsRes.products)
        setStatus('ready')
      })
      .catch((err) => setStatus(err?.status === 404 ? 'not-found' : 'error'))
  }, [storePath])

  const visibleProducts = useMemo(
    () => activeCategory === 'all' ? products : products.filter((product) => product.categoryId === activeCategory),
    [activeCategory, products],
  )

  function handleAdd(product: Product) {
    addItem(product)
    setAddedProduct(product.id)
    window.setTimeout(() => setAddedProduct((current) => current === product.id ? null : current), 1400)
  }

  if (status === 'loading') return <StoreLoading />
  if (status === 'not-found') return <StoreMessage title={t('Store not found')} detail={t('Please check that the store link is correct.')} />
  if (status === 'error' || !store) return <StoreMessage title={t('Menu unavailable')} detail={t('Please try again later.')} error />
  if (!storePath) return null
  const savedDesign = store.businessInfo?.design
  const design = savedDesign === 'midnight' || savedDesign === 'warm' ? savedDesign : 'clean'
  const theme = {
    clean: { page: 'bg-[#f6f7f4]', hero: 'bg-slate-950', accent: 'text-amber-300', button: 'bg-slate-950 hover:bg-slate-800', muted: 'text-slate-300' },
    midnight: { page: 'bg-slate-900', hero: 'bg-indigo-950', accent: 'text-cyan-300', button: 'bg-indigo-700 hover:bg-indigo-600', muted: 'text-indigo-100/70' },
    warm: { page: 'bg-orange-50', hero: 'bg-orange-950', accent: 'text-orange-200', button: 'bg-orange-800 hover:bg-orange-700', muted: 'text-orange-100/75' },
  }[design]
  const tagline = store.businessInfo?.tagline || t('Pick your favorites and order directly.')

  return (
    <div className={`min-h-screen ${theme.page} text-slate-950`}>
      <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">{t('Online ordering')}</p><h1 className="truncate text-xl font-semibold sm:text-2xl">{store.name}</h1></div>
          <div className="flex shrink-0 items-center gap-2"><LanguageToggle /><Link to={`/${storePath}/cart`} className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition ${theme.button}`}>{t('Shopping cart')}<span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-slate-950">{totalItems}</span></Link></div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-6 sm:py-10 lg:pb-12">
        <section className={`mb-8 rounded-2xl px-5 py-7 text-white sm:px-8 sm:py-9 ${theme.hero}`}><p className={`text-sm font-medium ${theme.accent}`}>{t('Welcome')}</p><h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{tagline}</h2><p className={`mt-3 max-w-xl text-sm leading-6 ${theme.muted}`}>{t('Order online, leave your contact details, and submit. The store will contact you to confirm.')}</p></section>
        {categories.length > 0 && <nav aria-label={t('Product category')} className="mb-6 flex gap-2 overflow-x-auto pb-1"><CategoryButton active={activeCategory === 'all'} onClick={() => setActiveCategory('all')} theme={theme}>{t('All')}</CategoryButton>{categories.map((category) => <CategoryButton key={category.id} active={activeCategory === category.id} onClick={() => setActiveCategory(category.id)} theme={theme}>{category.name}</CategoryButton>)}</nav>}
        {visibleProducts.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center"><p className="font-medium text-slate-900">{t('Menu is being prepared')}</p><p className="mt-2 text-sm text-slate-500">{t('No products are currently available for purchase.')}</p></section> : <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleProducts.map((product) => { const quantity = lines.find((line) => line.product.id === product.id)?.quantity ?? 0; return <ProductCard key={product.id} product={product} quantity={quantity} added={addedProduct === product.id} onAdd={() => handleAdd(product)} theme={theme} /> })}</section>}
      </main>
      {totalItems > 0 && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden"><Link to={`/${storePath}/cart`} className={`mx-auto flex max-w-md items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold text-white ${theme.button}`}><span>{t('{count} items', { count: totalItems })}</span><span>{formatSen(totalSen)} · {t('View cart')}</span></Link></div>}
    </div>
  )
}

type StoreTheme = { page: string; hero: string; accent: string; button: string; muted: string }
function CategoryButton({ active, onClick, children, theme }: { active: boolean; onClick: () => void; children: string; theme: StoreTheme }) { return <button type="button" onClick={onClick} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${active ? `${theme.button} text-white` : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}>{children}</button> }

function ProductCard({ product, quantity, added, onAdd, theme }: { product: Product; quantity: number; added: boolean; onAdd: () => void; theme: StoreTheme }) { const { t } = useLanguage(); return <article className="flex min-h-36 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40">{product.imageUrl && <img src={product.imageUrl} alt="" loading="lazy" className="h-44 w-full object-cover" />}<div className="p-5"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-slate-950">{product.name}</h3>{quantity > 0 && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">{t('Selected {count}', { count: quantity })}</span>}</div><p className="mt-3 text-lg font-semibold text-slate-950">{formatSen(product.priceSen)}</p><button type="button" onClick={onAdd} className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 ${theme.button}`}>{added ? t('Added to cart') : t('Add to cart')}<span aria-hidden="true" className="text-lg leading-none">+</span></button></div></article> }

function StoreLoading() { return <div className="min-h-screen bg-[#f6f7f4] px-4 py-8"><div className="mx-auto max-w-6xl animate-pulse space-y-6"><div className="h-10 w-48 rounded bg-slate-200" /><div className="h-44 rounded-2xl bg-slate-200" /><div className="grid gap-4 sm:grid-cols-3"><div className="h-36 rounded-2xl bg-slate-200" /><div className="h-36 rounded-2xl bg-slate-200" /><div className="h-36 rounded-2xl bg-slate-200" /></div></div></div> }
function StoreMessage({ title, detail, error = false }: { title: string; detail: string; error?: boolean }) { return <div className="flex min-h-screen items-center justify-center bg-[#f6f7f4] px-4 text-center"><div><h1 className={`text-xl font-semibold ${error ? 'text-red-700' : 'text-slate-950'}`}>{title}</h1><p className="mt-2 text-sm text-slate-500">{detail}</p></div></div> }
