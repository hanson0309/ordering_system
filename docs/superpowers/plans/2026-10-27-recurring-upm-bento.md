# Recurring UPM Bento Implementation Plan

> **For agentic workers:** Use inline execution checkpoints; execute each task in order with TDD and preserve unrelated workspace changes.

**Goal:** Add weekly recurring meal templates and populate the confirmed menu and locations for tenant `aa1234`.

**Architecture:** A product can be a dated meal or a recurring weekday meal. Public reads expand recurring meals into dated offers for the next 14 Malaysia-local days, and order writes validate and snapshot the selected date and branch rule. Branches carry an optional service period so morning and afternoon delivery points see the matching recurring offers.

**Tech Stack:** Cloudflare D1, Drizzle, Hono, React, TypeScript, Vitest, Wrangler.

**Spec:** `docs/superpowers/specs/2026-10-27-recurring-upm-bento-design.md`

## Constraints

- Never overwrite or delete the existing `aa` location or product/order history.
- Keep add-ons ordinary products; only scheduled meals have cutoffs.
- Price values are stored in integer sen; rule prices are additive adjustments to the product base price.
- Recurrence uses Malaysia local dates, Monday-Friday, and shows a 14-day rolling window.
- Do not claim to calculate free delivery from quantity or distance.

---

### Task 1: Recurrence Rules And Date Expansion

**Files:** `apps/api/src/services/scheduled-meals.ts`, `apps/api/tests/weekly-bento-menu.test.ts`.

- [ ] Add failing tests for weekday/date expansion in `Asia/Kuala_Lumpur`, excluding weekends and dates whose 09:00/13:00 cutoff has passed.
- [ ] Run the focused test and confirm it fails because recurring weekday expansion is absent.
- [ ] Implement a pure helper that takes weekday, period, cutoff, `now`, and horizon, returning matching dated occurrences with cutoff timestamps.
- [ ] Run focused scheduled-meal tests and confirm they pass, including DST-independent `+08:00` parsing.

### Task 2: Persist Recurrence And Branch Delivery Period

**Files:** `apps/api/src/db/migrations/0015_recurring_meals.sql`, migration journal, `apps/api/src/db/schema.ts`, `apps/api/tests/weekly-bento-menu.test.ts`.

- [ ] Add failing migration/schema tests for `products.weekly_day`, `products.weekly_cutoff_time`, and nullable `branches.delivery_period`.
- [ ] Run the migration test and confirm expected columns are absent.
- [ ] Add an additive migration and matching Drizzle fields; preserve all existing product and branch rows.
- [ ] Run focused migration tests and inspect local migration status.

### Task 3: Dashboard Recurring Meal CRUD

**Files:** `apps/api/src/routes/dashboard.ts`, API tests, `apps/dashboard/src/lib/api.ts`, `apps/dashboard/src/pages/DashboardPage.tsx`, dashboard localization.

- [ ] Add failing endpoint tests for recurring meal create/update, including required weekday, period, cutoff, and every active rule price.
- [ ] Run tests and confirm recurring input is currently rejected.
- [ ] Implement `kind: 'recurring_meal'` while retaining one-off scheduled meals and ordinary add-ons unchanged.
- [ ] Add dashboard controls for weekly repeat day, lunch/dinner, cutoff, and rule-specific prices; list weekday templates clearly.
- [ ] Run focused API/dashboard tests and both TypeScript builds.

### Task 4: Expand Public Offers And Validate Dated Orders

**Files:** `apps/api/src/routes/public.ts`, `apps/api/src/services/orders.ts`, order tests, `apps/store/src/lib/api.ts`, cart state/components, storefront tests.

- [ ] Add failing public API tests for the next 14 days, correct branch period, selected location price, and non-recurring add-ons.
- [ ] Add failing order tests for valid occurrence orders, duplicate product on separate dates, incorrect weekday, wrong branch period, and passed cutoff.
- [ ] Implement response expansion and server validation; save actual service date/period/pricing snapshots to order items.
- [ ] Update cart identity to `(productId, serviceDate)` and include service date when submitting a recurring offer.
- [ ] Run API and storefront test suites/builds; verify existing one-off scheduled orders remain compatible.

### Task 5: Location Period Management And Tenant Population

**Files:** branch dashboard API/forms and tests; then production configuration through authenticated dashboard API.

- [ ] Add failing tests for creating AM/PM branches with delivery periods under the existing UPM region and assigning pricing rules.
- [ ] Add branch period selection to dashboard management and run its tests/build.
- [ ] Create `UPM学生`, `校外`, and `雪隆配送` rules for `aa1234`; assign the UPM rule only to newly created UPM locations.
- [ ] Create separate AM/PM branches from the source list; leave existing `aa` unchanged.
- [ ] Create the 10 recurring meal templates with base price and rule adjustments from the spec. Preserve and reconcile existing 100plus records after checking references; add Coca-Cola at RM3 if absent.

### Task 6: Verify, Migrate, Deploy, And Confirm Production

**Files:** production migration and deployed Worker/Pages; no unrelated workspace edits.

- [ ] Run full API tests, all builds, and `git diff --check`.
- [ ] Apply only migration `0015_recurring_meals.sql` after checking production migration status.
- [ ] Deploy API Worker, rebuild/deploy Pages, then verify HTTP availability.
- [ ] Verify the UPM region, all intended AM/PM locations, rules, and 10 recurring templates with aggregate/read-only queries or public API requests; do not emit account secrets or other tenants' data.
