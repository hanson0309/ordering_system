export type MenuProduct = {
  id: string
  name: string
  serviceDate: string | null
  servicePeriod: 'lunch' | 'dinner' | null
}

export type ProductMenuGroup<T extends MenuProduct> = {
  key: string
  label: string
  products: T[]
}

const periodOrder = { lunch: 0, dinner: 1 } as const

function formatDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]
  return `${weekday}, ${day} ${monthName}`
}

export function groupProductsForMenu<T extends MenuProduct>(products: T[]): ProductMenuGroup<T>[] {
  const scheduled = products
    .filter((product) => product.serviceDate !== null && product.servicePeriod !== null)
    .sort((left, right) => left.serviceDate!.localeCompare(right.serviceDate!) || periodOrder[left.servicePeriod!] - periodOrder[right.servicePeriod!])
  const addOns = products.filter((product) => product.serviceDate === null && product.servicePeriod === null)
  const groups = new Map<string, ProductMenuGroup<T>>()

  for (const product of scheduled) {
    const key = `${product.serviceDate}:${product.servicePeriod}`
    const group = groups.get(key) ?? {
      key,
      label: `${formatDate(product.serviceDate!)} · ${product.servicePeriod === 'lunch' ? 'Lunch' : 'Dinner'}`,
      products: [],
    }
    group.products.push(product)
    groups.set(key, group)
  }

  return [...groups.values(), ...(addOns.length ? [{ key: 'add-ons', label: 'Add-ons', products: addOns }] : [])]
}
