import { Outlet, useParams } from 'react-router-dom'
import { CartProvider } from '../cart/CartContext'
import { getPublicStorePath } from '../lib/storePath'

/** Scopes the cart to the tenant and location so identical location slugs never mix carts. */
export default function StoreLayout() {
  const { slug, regionSlug, locationSlug } = useParams<{ slug: string; regionSlug?: string; locationSlug?: string }>()
  const storeKey = getPublicStorePath(slug, regionSlug, locationSlug) || 'default'

  return (
    <CartProvider key={storeKey} slug={storeKey}>
      <Outlet />
    </CartProvider>
  )
}
