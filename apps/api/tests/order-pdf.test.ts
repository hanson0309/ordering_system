import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { formatMalaysiaDateTime, formatOrderListAddOns, groupOrderListRows, orderRemarkSeparatorY, pdfText, renderOrderListPdf } from '../src/services/order-pdf'

describe('order PDF formatting', () => {
  it('keeps Chinese text instead of replacing it with question marks', () => {
    expect(pdfText('奶茶 x1, 辣椒酱')).toBe('奶茶 x1, 辣椒酱')
  })

  it('formats timestamps in Malaysia time', () => {
    expect(formatMalaysiaDateTime(new Date('2026-10-19T12:11:25.000Z'))).toBe('2026-10-19 20:11:25 MYT')
  })

  it('groups orders by region and store while retaining unassigned orders', () => {
    const groups = groupOrderListRows([
      { orderNumber: 'ORD-1', regionName: 'Central', branchName: 'K10', items: [], remark: null },
      { orderNumber: 'ORD-2', regionName: 'Central', branchName: 'K11', items: [], remark: null },
      { orderNumber: 'ORD-3', regionName: null, branchName: null, items: [], remark: null },
    ] as any)

    expect(groups).toEqual([
      expect.objectContaining({
        name: 'Central',
        stores: [
          expect.objectContaining({ name: 'K10', orders: [expect.objectContaining({ orderNumber: 'ORD-1' })] }),
          expect.objectContaining({ name: 'K11', orders: [expect.objectContaining({ orderNumber: 'ORD-2' })] }),
        ],
      }),
      expect.objectContaining({
        name: 'Unassigned region',
        stores: [expect.objectContaining({ name: 'General', orders: [expect.objectContaining({ orderNumber: 'ORD-3' })] })],
      }),
    ])
  })

  it('formats products and customer remarks for the Add-Ons cell', () => {
    expect(formatOrderListAddOns({
      items: [{ productNameSnapshot: 'Nasi Lemak', quantity: 2 }],
      remark: 'Less spicy',
    } as any)).toBe('Nasi Lemak x2; Remark: Less spicy')
  })

  it('places remark separators above the next heading with a clear gap', () => {
    expect(orderRemarkSeparatorY(300)).toBe(312)
  })

  it('creates an A4 landscape order-list page', async () => {
    const pdf = await renderOrderListPdf({ organizationName: 'Wonderful', businessDate: '2026-10-24', orders: [] })
    const document = await PDFDocument.load(pdf)
    const [page] = document.getPages()

    expect(page.getWidth()).toBeGreaterThan(page.getHeight())
  })

  it('adds a page when a region has more store cards than the grid holds', async () => {
    const orders = Array.from({ length: 13 }, (_, index) => ({
      orderNumber: `ORD-${index}`,
      createdAt: new Date(),
      customerName: 'Customer',
      customerPhone: '1',
      remark: null,
      totalSen: 100,
      regionName: 'Central',
      branchName: `K${index}`,
      items: [],
    }))
    const document = await PDFDocument.load(await renderOrderListPdf({ organizationName: 'Wonderful', businessDate: '2026-10-24', orders }))

    expect(document.getPageCount()).toBeGreaterThan(1)
  })

  it('adds a remark detail page when an order has a customer remark', async () => {
    const remark = 'Please deliver to the library entrance and call me when you arrive. '.repeat(5)
    const pdf = await renderOrderListPdf({
      organizationName: 'Wonderful',
      businessDate: '2026-11-09',
      orders: [{
        orderNumber: 'ORD-REMARK-1',
        createdAt: new Date(),
        customerName: 'Alya',
        customerPhone: '0123456789',
        remark,
        totalSen: 850,
        regionName: 'UPM',
        branchName: 'K10 Morning',
        items: [{ productNameSnapshot: 'Chicken rice', quantity: 1 }],
      }],
    })
    const document = await PDFDocument.load(pdf)

    expect(document.getPageCount()).toBe(2)
  })

  it('paginates remark details when they exceed one page', async () => {
    const orders = Array.from({ length: 30 }, (_, index) => ({
      orderNumber: `ORD-REMARK-${index}`,
      createdAt: new Date(),
      customerName: `Customer ${index}`,
      customerPhone: '0123456789',
      remark: `Remark ${index}: please leave the meal at the front desk.`,
      totalSen: 850,
      regionName: 'UPM',
      branchName: 'K10 Morning',
      items: [{ productNameSnapshot: 'Chicken rice', quantity: 1 }],
    }))
    const document = await PDFDocument.load(await renderOrderListPdf({
      organizationName: 'Wonderful',
      businessDate: '2026-11-09',
      orders,
    }))

    expect(document.getPageCount()).toBeGreaterThan(2)
  })
})
