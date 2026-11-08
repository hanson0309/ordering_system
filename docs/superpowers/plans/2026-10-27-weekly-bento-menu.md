# Weekly Bento Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add location-priced, cutoff-enforced weekly bento meals while retaining existing add-ons, location links, checkout, payment QR, and receipt upload/cancellation.

**Architecture:** A scheduled meal remains a product, with a service date, meal period, and UTC cutoff. Each location selects one tenant-scoped pricing rule; scheduled meals have a price for each rule. Public endpoints resolve that location's price and order creation snapshots the date, period, rule name, and price.

**Tech Stack:** Cloudflare Workers/D1, Drizzle, Hono, Zod, TypeScript, React, Vite, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-weekly-bento-menu-design.md`

## Global Constraints

- The location URL tuple `/api/public/:tenantSlug/:regionSlug/:storeSlug` remains the only location source; checkout never asks for a location.
- Store money in integer sen; server code never accepts customer-supplied price, rule, date, or meal period.
- Convert Malaysia `Asia/Kuala_Lumpur` cutoffs to UTC before storage; the API makes the final cutoff decision.
- Ordinary products, legacy orders, receipt auto-upload, and receipt cancellation continue unchanged.
- Scope every query by tenant and branch. Cross-tenant/branch IDs get generic invalid/not-found responses.
- A pricing rule cannot be deleted while any branch or active scheduled price still references it.

---

## File Structure

- `apps/api/src/db/schema.ts`: pricing-rule tables, schedule data, and immutable order snapshots.
- `apps/api/src/db/migrations/0013_weekly_bento_menu.sql`, `meta/_journal.json`: additive D1 migration.
- `apps/api/src/services/scheduled-meals.ts`: Malaysia time, scheduled-item eligibility, effective price resolution.
- `apps/api/src/services/orders.ts`, `routes/public.ts`: server-side price/cutoff enforcement and snapshots.
- `apps/api/src/routes/dashboard.ts`: price-rule, branch assignment, and scheduled-meal CRUD.
- `apps/api/tests/weekly-bento-menu.test.ts`: migration, isolation, pricing, cutoff, and snapshot coverage.
- `apps/dashboard/src/lib/api.ts`, `pages/DashboardPage.tsx`, `lib/i18n.tsx`: rule controls and scheduled-meal editor.
- `apps/store/src/lib/api.ts`, `pages/StorePage.tsx`, `pages/CartPage.tsx`, `lib/i18n.tsx`: grouped menu, cutoff copy, cart metadata.

### Task 1: Persist Price Rules And Scheduled Fields

**Files:**
- Modify: `apps/api/src/db/schema.ts:74-270`
- Create: `apps/api/src/db/migrations/0013_weekly_bento_menu.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`
- Create: `apps/api/tests/weekly-bento-menu.test.ts`

**Interfaces:**
- Produces `pricingRules`, `scheduledMealPrices`, `branches.pricingRuleId`, `products.serviceDate/servicePeriod/orderCutoffAt`, and nullable `orderItems` schedule/rule snapshots.
- Consumed by Tasks 2-5.

- [ ] **Step 1: Write the failing migration tests**

```ts
expect(await db().select().from(pricingRules).where(eq(pricingRules.tenantId, tenant))).toHaveLength(2)
expect(await db().select().from(orderItems).where(eq(orderItems.id, legacyItem))).toMatchObject([
  { serviceDateSnapshot: null, servicePeriodSnapshot: null, pricingRuleNameSnapshot: null },
])
```

Insert two rules, one branch assignment, and one scheduled price. Assert duplicate `(product_id, pricing_rule_id)` is rejected. Insert a legacy add-on/order item and assert every new field is null.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run apps/api/tests/weekly-bento-menu.test.ts`

Expected: FAIL because the schema exports and tables do not exist.

- [ ] **Step 3: Write minimal schema and migration**

```ts
// branches
pricingRuleId: text('pricing_rule_id').references(() => pricingRules.id)
// products
serviceDate: text('service_date'),
servicePeriod: text('service_period', { enum: ['lunch', 'dinner'] }),
orderCutoffAt: integer('order_cutoff_at', { mode: 'timestamp' })
// order_items
serviceDateSnapshot: text('service_date_snapshot'),
servicePeriodSnapshot: text('service_period_snapshot', { enum: ['lunch', 'dinner'] }),
pricingRuleNameSnapshot: text('pricing_rule_name_snapshot')
```

Create `pricing_rules(id, tenant_id, name, is_active, sort_order, created_at, updated_at)` with tenant/name uniqueness and tenant/sort indexes. Create `scheduled_meal_prices(id, tenant_id, product_id, pricing_rule_id, price_sen)` with a unique product/rule pair. Make the migration additive; do not backfill or mutate current products/orders; append journal entry `0013_weekly_bento_menu`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --run apps/api/tests/weekly-bento-menu.test.ts apps/api/tests/isolation/regions-migration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations/0013_weekly_bento_menu.sql apps/api/src/db/migrations/meta/_journal.json apps/api/tests/weekly-bento-menu.test.ts
git commit -m "feat: add weekly bento pricing schema"
```

### Task 2: Resolve Schedule Eligibility And Location Prices

**Files:**
- Create: `apps/api/src/services/scheduled-meals.ts`
- Modify: `apps/api/tests/weekly-bento-menu.test.ts`

**Interfaces:**
- Produces `type ServicePeriod = 'lunch' | 'dinner'`.
- Produces `parseMalaysiaCutoff(serviceDate: string, cutoff: string): Date`, `isScheduledMealOpen(product, now): boolean`, and `resolveEffectiveProductPrice(db, tenantId, branchId, productIds, now)`.
- Consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the failing service tests**

```ts
expect(parseMalaysiaCutoff('2026-10-29', '09:00').toISOString()).toBe('2026-10-29T01:00:00.000Z')
expect(isScheduledMealOpen(meal, new Date('2026-10-29T01:00:00.000Z'))).toBe(false)
expect(upmMeal.effectivePriceSen).toBe(850)
expect(deliveryMeal.effectivePriceSen).toBe(1500)
```

Use fixed times. Assert that no-rule and partial-schedule products are ineligible, while a Coke add-on has no schedule restriction.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run apps/api/tests/weekly-bento-menu.test.ts`

Expected: FAIL because `scheduled-meals.ts` does not exist.

- [ ] **Step 3: Implement deterministic helpers**

```ts
export function parseMalaysiaCutoff(serviceDate: string, cutoff: string) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(serviceDate) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(cutoff)) {
    throw new Error('invalid_malaysia_cutoff')
  }
  return new Date(serviceDate + 'T' + cutoff + ':00+08:00')
}
```

Ordinary means all three schedule fields are null. Scheduled means all fields are present, public, available, before cutoff, branch rule active, and has matching price. Resolve prices only through the selected branch's active rule.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run apps/api/tests/weekly-bento-menu.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/scheduled-meals.ts apps/api/tests/weekly-bento-menu.test.ts
git commit -m "feat: resolve scheduled meal prices by location"
```

### Task 3: Enforce Scheduled Meals In Public API And Orders

**Files:**
- Modify: `apps/api/src/routes/public.ts:66-136`
- Modify: `apps/api/src/services/orders.ts:1-160`
- Modify: `apps/api/src/routes/dashboard.ts:402-615`
- Modify: `apps/api/src/services/order-pdf.ts`
- Modify: `apps/api/tests/weekly-bento-menu.test.ts`
- Modify: `apps/api/tests/isolation/public-storefront.test.ts`

**Interfaces:**
- Public `GET /products` returns ordinary price or effective scheduled `priceSen` plus `serviceDate`, `servicePeriod`, and `orderCutoffAt`.
- `createOrder(db, tenantId, input, branchId, now?)` validates current eligibility, totals effective prices, and saves snapshots.
- Dashboard detail/list/PDF item projections include nullable schedule snapshots.

- [ ] **Step 1: Write failing route and snapshot tests**

```ts
expect(listed.products).toContainEqual(expect.objectContaining({ id: lunchId, priceSen: 850, servicePeriod: 'lunch' }))
expect(delivery.products.find((p) => p.id === lunchId)?.priceSen).toBe(1500)
expect(afterCutoff.products.map((p) => p.name)).toEqual(['Coke'])
expect((await postPublicOrder(...)).status).toBe(400)
```

Create a pre-cutoff order and assert `serviceDateSnapshot: '2026-10-29'`, `servicePeriodSnapshot: 'lunch'`, and `pricingRuleNameSnapshot: 'UPM Student'`. Change product/rule rows then assert order detail and PDF still show snapshots.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --run apps/api/tests/weekly-bento-menu.test.ts apps/api/tests/isolation/public-storefront.test.ts`

Expected: FAIL because public products use `products.priceSen` and orders do not snapshot schedule data.

- [ ] **Step 3: Implement public resolution and immutable orders**

Public menu combines ordinary branch products with eligible scheduled products from Task 2. Keep `priceSen` as the public field name. In order creation, re-resolve every requested ID server-side and reject no matching rule/price, partial schedules, closed meals, unavailable products, and cross-branch products with `OrderValidationError`.

```ts
unitPriceSenSnapshot: effectivePriceSen,
serviceDateSnapshot: scheduled ? product.serviceDate : null,
servicePeriodSnapshot: scheduled ? product.servicePeriod : null,
pricingRuleNameSnapshot: scheduled ? effective.pricingRuleName : null,
```

Keep response `400 { error: 'invalid_order' }`. Do not touch receipt upload/cancel routes. Project snapshots into dashboard list/detail and PDF data.

- [ ] **Step 4: Run regression tests**

Run: `npm test -- --run apps/api/tests/weekly-bento-menu.test.ts apps/api/tests/isolation/public-storefront.test.ts apps/api/tests/payment-receipts.test.ts apps/api/tests/order-pdf.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/public.ts apps/api/src/services/orders.ts apps/api/src/routes/dashboard.ts apps/api/src/services/order-pdf.ts apps/api/tests/weekly-bento-menu.test.ts apps/api/tests/isolation/public-storefront.test.ts
git commit -m "feat: enforce scheduled bento ordering"
```

### Task 4: Add Dashboard Price-Rule And Scheduled-Meal APIs

**Files:**
- Modify: `apps/api/src/routes/dashboard.ts:184-848`
- Modify: `apps/api/tests/weekly-bento-menu.test.ts`

**Interfaces:**
- `GET/POST /api/dashboard/pricing-rules`, `PATCH/DELETE /api/dashboard/pricing-rules/:id`.
- `PATCH /api/dashboard/branches/:branchId/pricing-rule` accepts `{ pricingRuleId: string | null }`.
- Product create/patch accepts `kind: 'add_on' | 'scheduled_meal'`, schedule values, `cutoffMalaysiaTime`, and `rulePrices: Array<{ pricingRuleId; priceSen }>`.

- [ ] **Step 1: Write failing API tests**

Owner creates UPM/external/delivery rules; staff gets `403`; another tenant gets no data. Assign UPM to a branch, assert delete returns `409 { error: 'pricing_rule_in_use' }`. Assert scheduled meal creation rejects missing date/period/cutoff or missing active branch-rule price.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --run apps/api/tests/weekly-bento-menu.test.ts`

Expected: FAIL because the routes and strict input do not exist.

- [ ] **Step 3: Implement tenant-scoped dashboard mutations**

Validate names to 80 characters, rule prices as non-negative integer sen, and period exactly lunch/dinner. Convert cutoff with Task 2. `add_on` clears all schedule fields and writes only `products.priceSen`; `scheduled_meal` needs every field and a price for every active rule assigned to a selling branch. Rule delete first checks branch assignment and active scheduled prices.

When the existing branch-copy flow copies products, also copy schedule fields and matching tenant-owned scheduled price rows. Never copy another tenant's rule ID.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --run apps/api/tests/weekly-bento-menu.test.ts apps/api/tests/dashboard.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/dashboard.ts apps/api/tests/weekly-bento-menu.test.ts
git commit -m "feat: manage bento price rules in dashboard"
```

### Task 5: Build Dashboard And Storefront Views

**Files:**
- Modify: `apps/dashboard/src/lib/api.ts`
- Modify: `apps/dashboard/src/pages/DashboardPage.tsx`
- Modify: `apps/dashboard/src/lib/i18n.tsx`
- Create: `apps/dashboard/src/lib/pricingRules.test.ts`
- Modify: `apps/store/src/lib/api.ts`
- Modify: `apps/store/src/pages/StorePage.tsx`
- Modify: `apps/store/src/pages/CartPage.tsx`
- Modify: `apps/store/src/lib/i18n.tsx`
- Create: `apps/store/src/lib/menuGrouping.test.ts`

**Interfaces:**
- Dashboard `PricingRule`: `{ id; name; isActive; sortOrder; branchCount }`.
- Storefront `Product` gains nullable `serviceDate`, `servicePeriod`, `orderCutoffAt`.
- `validateScheduledMealDraft(draft, activeRules): string | null` and `groupProductsForMenu(products)` are UI-independent helpers.

- [ ] **Step 1: Write failing helper tests**

```ts
expect(validateScheduledMealDraft({ kind: 'scheduled_meal', serviceDate: '', servicePeriod: 'lunch', cutoffMalaysiaTime: '09:00', rulePrices: [] }, activeRules))
  .toBe('Choose a service date.')
expect(groupProductsForMenu(products).map((group) => group.label)).toEqual([
  'Wed, 29 Oct · Lunch', 'Wed, 29 Oct · Dinner', 'Thu, 30 Oct · Lunch', 'Add-ons',
])
```

Test exact rule IDs/integer sen, including price `0`, and ordinary add-ons last.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run lint --workspace apps/dashboard && npm run lint --workspace apps/store`

Expected: FAIL because helper/type additions do not exist.

- [ ] **Step 3: Implement the dashboard experience**

Extend initial dashboard data loading with pricing rules. Add a Price rules section under Stores: create/rename/activate/reorder/disable rules and choose the selected location's rule. Extend catalog with an Add-on/Scheduled-meal segmented control; scheduled mode includes date, lunch/dinner, default cutoff (09:00 lunch, 13:00 dinner), description, and a price row per active rule. Show a historical schedule label on dashboard orders only when snapshots are non-null.

- [ ] **Step 4: Implement the customer experience**

Group scheduled cards by date then lunch/dinner and ordinary add-ons after them. Scheduled cards show location-specific price and Malaysia cutoff; closed cards are never rendered because the API excludes them. Cart lines show `date · meal period`. For `invalid_order`, explain that the meal closed or became unavailable and direct the customer to return to the menu. Do not modify `OrderConfirmationPage.tsx`, automatic receipt upload, or receipt cancellation.

- [ ] **Step 5: Run UI verification**

Run: `npm run build:dashboard && npm run build:store`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src apps/store/src
git commit -m "feat: manage and display weekly bento meals"
```

### Task 6: Verify Migration And Release Readiness

**Files:**
- Modify only files above when a named verification finds a concrete fault.

**Interfaces:**
- Verifies all spec behavior including legacy order visibility and receipt auto-upload/cancel regressions.

- [ ] **Step 1: Apply migration to clean local D1**

Run: `npm run db:migrate:local`

Expected: `0013_weekly_bento_menu.sql` applies successfully.

- [ ] **Step 2: Run full API suite**

Run: `npm test`

Expected: PASS, including receipt, dashboard, isolation, PDF, and migration tests.

- [ ] **Step 3: Build deployment artifacts**

Run: `npm run build:api && npm run build:pages`

Expected: PASS.

- [ ] **Step 4: Check final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; preserve unrelated pre-existing changes.

- [ ] **Step 5: Commit only verified feature files**

```bash
git add apps/api apps/dashboard apps/store docs/superpowers
git commit -m "feat: add location-priced weekly bento menu"
```

## Self-Review

**Spec coverage:** Task 1 stores rules/schedules/snapshots. Task 2 defines Malaysia-time eligibility and location pricing. Task 3 enforces it publicly and preserves historical order/PDF data. Task 4 gives tenant-safe backend controls. Task 5 delivers the customer and dashboard screens. Task 6 verifies migration, full behavior, builds, and receipts.

**Placeholder scan:** The plan contains no TBD/TODO entries, generic test instructions, or undefined helper names.

**Type consistency:** `serviceDate`, `servicePeriod`, `orderCutoffAt`, `pricingRuleId`, `rulePrices`, and each order-item snapshot keep the same names across schema, API, dashboard, storefront, and tests.
