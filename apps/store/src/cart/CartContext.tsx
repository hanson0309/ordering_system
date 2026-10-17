import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Product } from '../lib/api'

export interface CartLine {
  product: Product
  quantity: number
}

interface CartState {
  lines: CartLine[]
  addItem: (product: Product, quantity?: number) => void
  removeItem: (productId: string) => void
  setQuantity: (productId: string, quantity: number) => void
  clear: () => void
  totalSen: number
  totalItems: number
}

const CartContext = createContext<CartState | null>(null)

function storageKey(slug: string) {
  return `cart:${slug}`
}

export function CartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey(slug))
      return raw ? (JSON.parse(raw) as CartLine[]) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(storageKey(slug), JSON.stringify(lines))
  }, [slug, lines])

  const value = useMemo<CartState>(() => {
    const addItem = (product: Product, quantity = 1) => {
      setLines((prev) => {
        const existing = prev.find((l) => l.product.id === product.id)
        if (existing) {
          return prev.map((l) =>
            l.product.id === product.id ? { ...l, quantity: l.quantity + quantity } : l,
          )
        }
        return [...prev, { product, quantity }]
      })
    }
    const removeItem = (productId: string) => {
      setLines((prev) => prev.filter((l) => l.product.id !== productId))
    }
    const setQuantity = (productId: string, quantity: number) => {
      setLines((prev) =>
        quantity <= 0
          ? prev.filter((l) => l.product.id !== productId)
          : prev.map((l) => (l.product.id === productId ? { ...l, quantity } : l)),
      )
    }
    const clear = () => setLines([])

    const totalSen = lines.reduce((sum, l) => sum + l.product.priceSen * l.quantity, 0)
    const totalItems = lines.reduce((sum, l) => sum + l.quantity, 0)

    return { lines, addItem, removeItem, setQuantity, clear, totalSen, totalItems }
  }, [lines])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartState {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}
