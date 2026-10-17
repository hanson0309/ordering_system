import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { branches, orders } from '../src/db/schema'
import { db, createProduct, createTenant, createUser, addMembership, loginAndGetCookie, postPublicOrder, SELF } from './helpers'

describe('payment QR and receipt uploads', () => {
  it('stores a branch QR code and serves it through the matching public location', async () => {
    const tenant = await createTenant('QR Store', 'payment-qr-store')
    const [branch] = await db().insert(branches).values({ id: 'branch-payment-qr', tenantId: tenant, name: 'Main', slug: 'main', isDefault: true }).returning()
    const user = await createUser('payment-qr-admin@example.com')
    await addMembership(user, tenant, 'admin')
    const cookie = await loginAndGetCookie('payment-qr-admin@example.com')
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'qr.png')

    const upload = await SELF.fetch(`https://test.local/api/dashboard/branches/${branch.id}/payment-qr`, { method: 'POST', headers: { cookie }, body: form })
    expect(upload.status).toBe(200)
    const [saved] = await db().select().from(branches).where(eq(branches.id, branch.id)).limit(1)
    expect(saved.paymentQrKey).toContain(`branches/${branch.id}/payment-qr`)

    const publicInfo = await SELF.fetch('https://test.local/api/public/payment-qr-store/main')
    expect(publicInfo.status).toBe(200)
    const body = await publicInfo.json<{ paymentQrUrl: string | null }>()
    expect(body.paymentQrUrl).toBe('/api/public/payment-qr-store/main/payment-qr')
    const image = await SELF.fetch(`https://test.local${body.paymentQrUrl}`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
  })

  it('accepts a receipt upload, stores metadata, and allows dashboard download without a new notification job', async () => {
    const tenant = await createTenant('Receipt Store', 'receipt-store')
    const product = await createProduct(tenant, { priceSen: 1200 })
    const orderResponse = await postPublicOrder('receipt-store', {
      idempotencyKey: 'receipt-order-1',
      customer: { name: 'Receipt Customer', phone: '0188888888' },
      items: [{ productId: product, quantity: 1 }],
    })
    const { orderId } = await orderResponse.json<{ orderId: string }>()
    const form = new FormData()
    form.append('file', new Blob(['%PDF-1.4 receipt'], { type: 'application/pdf' }), 'receipt.pdf')

    const upload = await SELF.fetch(`https://test.local/api/public/receipt-store/orders/${orderId}/payment-receipt`, { method: 'POST', body: form })
    expect(upload.status).toBe(200)
    const [saved] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1)
    expect(saved.paymentReceiptKey).toContain(`orders/${orderId}/payment-receipt`)
    expect(saved.paymentReceiptContentType).toBe('application/pdf')
    expect(saved.paymentReceiptUploadedAt).toBeInstanceOf(Date)

    const user = await createUser('receipt-dashboard@example.com')
    await addMembership(user, tenant, 'staff')
    const cookie = await loginAndGetCookie('receipt-dashboard@example.com')
    const preview = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}/payment-receipt`, { headers: { cookie } })
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toBe('application/pdf')
    expect(preview.headers.get('content-disposition')).toBe('inline')
    expect(new TextDecoder().decode(await preview.arrayBuffer())).toBe('%PDF-1.4 receipt')

    const download = await SELF.fetch(`https://test.local/api/dashboard/orders/${orderId}/payment-receipt?download=1`, { headers: { cookie } })
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toMatch(/^attachment; filename="payment-receipt-.+\.pdf"$/)
  })

  it('rejects unsupported receipt files and files larger than 5 MB', async () => {
    const tenant = await createTenant('Receipt Validation', 'receipt-validation')
    const product = await createProduct(tenant)
    const orderResponse = await postPublicOrder('receipt-validation', {
      idempotencyKey: 'receipt-validation-order',
      customer: { name: 'Validation Customer', phone: '0189999999' },
      items: [{ productId: product, quantity: 1 }],
    })
    const { orderId } = await orderResponse.json<{ orderId: string }>()
    const invalid = new FormData()
    invalid.append('file', new Blob(['not allowed'], { type: 'text/plain' }), 'receipt.txt')
    expect((await SELF.fetch(`https://test.local/api/public/receipt-validation/orders/${orderId}/payment-receipt`, { method: 'POST', body: invalid })).status).toBe(400)
    const oversized = new FormData()
    oversized.append('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png')
    expect((await SELF.fetch(`https://test.local/api/public/receipt-validation/orders/${orderId}/payment-receipt`, { method: 'POST', body: oversized })).status).toBe(413)
  })
})
