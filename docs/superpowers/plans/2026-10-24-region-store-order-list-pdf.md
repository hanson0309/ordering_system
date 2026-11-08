# Region Store Order List PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a landscape PDF dispatch sheet that groups daily pending orders by region and store in the same multi-panel style as the supplied reference.

**Architecture:** Add pure grouping and display-text helpers in the PDF service, then make the renderer consume grouped cards on fixed landscape pages. Extend the notification query with branch and region metadata and pass it through the existing Telegram document flow.

**Tech Stack:** TypeScript, Cloudflare Workers/D1, Drizzle ORM, pdf-lib, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-region-store-order-list-pdf-design.md`

## Global Constraints

- Preserve the existing `Send now` endpoint, scheduled-send behaviour, Telegram file delivery, and notification-job state transitions.
- Render A4 landscape pages using `pdf-lib` and the existing optional Chinese-capable font.
- Use the existing `regions`, `branches`, `orders`, and `orderItems` records; no schema migration is required.
- Preserve every pending order, including orders without a store or region assignment.

---

### Task 1: Grouping and display helpers

**Files:**
- Modify: `apps/api/src/services/order-pdf.ts`
- Modify: `apps/api/tests/order-pdf.test.ts`

**Interfaces:**
- Consumes: `OrderListPdfRow` values with optional `regionName` and `branchName`.
- Produces: `groupOrderListRows(rows): RegionOrderListGroup[]` and `formatOrderListAddOns(order): string` for the renderer.

- [ ] **Step 1: Write the failing tests**

```ts
import { formatOrderListAddOns, groupOrderListRows } from '../src/services/order-pdf'

it('groups orders by region and store while retaining unassigned orders', () => {
  expect(groupOrderListRows([
    { orderNumber: 'ORD-1', regionName: 'Central', branchName: 'K10', items: [], remark: null },
    { orderNumber: 'ORD-2', regionName: 'Central', branchName: 'K11', items: [], remark: null },
    { orderNumber: 'ORD-3', regionName: null, branchName: null, items: [], remark: null },
  ] as any)).toEqual([
    expect.objectContaining({ name: 'Central', stores: [expect.objectContaining({ name: 'K10', orders: [expect.objectContaining({ orderNumber: 'ORD-1' })] }), expect.objectContaining({ name: 'K11' })] }),
    expect.objectContaining({ name: 'Unassigned region', stores: [expect.objectContaining({ name: 'General', orders: [expect.objectContaining({ orderNumber: 'ORD-3' })] })] }),
  ])
})

it('formats products and customer remarks for the Add-Ons cell', () => {
  expect(formatOrderListAddOns({ items: [{ productNameSnapshot: 'Nasi Lemak', quantity: 2 }], remark: 'Less spicy' } as any)).toBe('Nasi Lemak x2; Remark: Less spicy')
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm --workspace apps/api test -- order-pdf.test.ts`

Expected: FAIL because the two helper exports do not exist.

- [ ] **Step 3: Implement the minimal helpers**

```ts
export function groupOrderListRows(rows: OrderListPdfRow[]): RegionOrderListGroup[] {
  const regions = new Map<string, Map<string, OrderListPdfRow[]>>()
  for (const row of rows) {
    const regionName = row.regionName ?? 'Unassigned region'
    const storeName = row.branchName ?? 'General'
    const stores = regions.get(regionName) ?? new Map<string, OrderListPdfRow[]>()
    stores.set(storeName, [...(stores.get(storeName) ?? []), row])
    regions.set(regionName, stores)
  }
  return [...regions].map(([name, stores]) => ({ name, stores: [...stores].map(([storeName, orders]) => ({ name: storeName, orders })) }))
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm --workspace apps/api test -- order-pdf.test.ts`

Expected: PASS.

### Task 2: Landscape multi-card PDF renderer

**Files:**
- Modify: `apps/api/src/services/order-pdf.ts`
- Modify: `apps/api/tests/order-pdf.test.ts`

**Interfaces:**
- Consumes: `renderOrderListPdf({ organizationName, businessDate, orders }, { fontBytes? })` and `groupOrderListRows` from Task 1.
- Produces: PDF bytes with A4 landscape pages, region headers, and four-column store cards.

- [ ] **Step 1: Write the failing renderer tests**

```ts
import { PDFDocument } from 'pdf-lib'
import { renderOrderListPdf } from '../src/services/order-pdf'

it('creates an A4 landscape order-list page', async () => {
  const pdf = await renderOrderListPdf({ organizationName: 'Wonderful', businessDate: '2026-10-24', orders: [] })
  const document = await PDFDocument.load(pdf)
  const [page] = document.getPages()
  expect(page.getWidth()).toBeGreaterThan(page.getHeight())
})

it('adds a page when a region has more store cards than the grid holds', async () => {
  const orders = Array.from({ length: 13 }, (_, index) => ({ orderNumber: `ORD-${index}`, createdAt: new Date(), customerName: 'Customer', customerPhone: '1', remark: null, totalSen: 100, regionName: 'Central', branchName: `K${index}`, items: [] }))
  const document = await PDFDocument.load(await renderOrderListPdf({ organizationName: 'Wonderful', businessDate: '2026-10-24', orders }))
  expect(document.getPageCount()).toBeGreaterThan(1)
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm --workspace apps/api test -- order-pdf.test.ts`

Expected: FAIL because the renderer still creates portrait sequential-list pages.

- [ ] **Step 3: Implement the card renderer**

```ts
const page = document.addPage([842, 595])
// Place four equally sized cards per row; each card has a vertical store label,
// dark column headers, and fixed-height order rows. Continue a store in a fresh
// card when it exceeds the row limit and add landscape pages when cards overflow.
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm --workspace apps/api test -- order-pdf.test.ts`

Expected: PASS.

### Task 3: Supply region metadata to the dispatch renderer

**Files:**
- Modify: `apps/api/src/services/notifications.ts`
- Modify: `apps/api/tests/dashboard.test.ts`

**Interfaces:**
- Consumes: the existing pending-order selection in `sendTenantOrderList` and `regions` table.
- Produces: `OrderListPdfRow` values whose `regionName` comes from the branch's region.

- [ ] **Step 1: Write the failing integration assertion**

```ts
const sentFile = (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as FormData
expect(sentFile.get('document')).toBeInstanceOf(File)
expect((sentFile.get('document') as File).type).toBe('application/pdf')
```

The unit tests in Task 1 cover the exact `Central -> K10` group shape. This integration assertion verifies that the notification service still produces a PDF document after it begins supplying region metadata.

- [ ] **Step 2: Run the focused dashboard test to verify it fails**

Run: `npm --workspace apps/api test -- dashboard.test.ts`

Expected: FAIL at TypeScript compile time once the new renderer row type requires `regionName` but the pending-order selection has not supplied it.

- [ ] **Step 3: Extend the dispatch query and renderer input**

```ts
leftJoin(regions, and(eq(regions.id, branches.regionId), eq(regions.tenantId, setting.tenantId)))
// Include regions.name as regionName in the selected row before calling renderOrderListPdf.
```

- [ ] **Step 4: Run the focused dashboard test to verify it passes**

Run: `npm --workspace apps/api test -- dashboard.test.ts`

Expected: PASS and the captured Telegram document remains a PDF.

### Task 4: Verify the complete change

**Files:**
- Modify: none unless a test exposes a defect.

**Interfaces:**
- Consumes: completed API tests and generated renderer output.
- Produces: evidence that the new dispatch sheet is valid, grouped, and non-regressive.

- [ ] **Step 1: Run the complete API test suite**

Run: `npm --workspace apps/api test`

Expected: PASS with no test failures.

- [ ] **Step 2: Generate a representative PDF fixture and render it to PNG**

Run: use the existing renderer test data to save a local PDF, then run `pdftoppm -png` on it.

Expected: an A4 landscape image with non-overlapping headers, four store cards per row, readable text, and no clipped vertical labels.

- [ ] **Step 3: Inspect the PNG at full resolution**

Expected: every store card is inside the page boundary; headers, rows, page continuation, and region labels are legible.
