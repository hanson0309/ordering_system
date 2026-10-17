import { Outlet, useParams } from 'react-router-dom'
import { CartProvider } from '../cart/CartContext'

/** Scopes the cart to the current store slug so switching stores never mixes carts. */
export default function StoreLayout() {
  const { slug, locationSlug } = useParams<{ slug: string; locationSlug?: string }>()
  if (!slug) return null
  const storeKey = locationSlug ? `${slug}/${locationSlug}` : slug

  return (
    <CartProvider key={storeKey} slug={storeKey}>
      <Outlet />
    </CartProvider>
  )
}
