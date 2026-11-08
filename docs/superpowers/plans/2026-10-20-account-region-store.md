# Account–Region–Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-owned regions containing stores, and serve each store at `/{accountSlug}/menu/{regionSlug}/{storeSlug}`.

**Architecture:** Keep `tenants` as accounts, add tenant-scoped `regions`, and make each existing `branches` row belong to one region. Resolve storefront requests using tenant, region, and branch slugs; keep order/catalog/payment data scoped to the branch. The dashboard header becomes an account → region → store cascade, with region management in the Stores tab.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Cloudflare D1/Pages Functions, React, React Router, Vitest, Wrangler.

**Spec:** `docs/superpowers/specs/2026-10-20-account-region-store-design.md`

## Global Constraints

- Every region and store lookup/mutation is scoped to the authenticated tenant.
- A region slug is unique within its account; a store slug is unique within its region.
- The canonical storefront URL is `/{accountSlug}/menu/{regionSlug}/{storeSlug}`.
- Cart and order URLs remain children of the canonical storefront URL.
- Existing public root and obsolete menu URL formats remain unavailable.
- Existing store data is assigned to a generated default region during migration.
- Orders, catalog records, receipt files, and payment QR files remain store-scoped.

---

## File Map

- `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0012_regions.sql`: region table, store foreign key, scoped uniqueness, deterministic backfill.
- `apps/api/src/routes/dashboard.ts`, `apps/api/src/routes/public.ts`, `apps/api/src/index.ts`, `apps/api/src/auth/middleware.ts`: authorized region management, store-region validation, tuple lookup, canonical public API routes.
- `apps/api/tests/dashboard.test.ts`, `apps/api/tests/isolation/public-storefront.test.ts`, `apps/api/tests/helpers.ts`: region CRUD, hierarchy isolation, canonical tuple requests, duplicate slugs.
- `apps/dashboard/src/lib/api.ts`, `apps/dashboard/src/pages/DashboardPage.tsx`: region API types/helpers, cascading selectors, region CRUD, store creation within selected region.
- `apps/dashboard/src/lib/locationLink.ts`, `apps/dashboard/src/lib/locationLink.test.ts`: canonical dashboard link generation.
- `apps/store/src/App.tsx`, `apps/store/src/lib/storePath.ts`, `apps/store/src/lib/storePath.test.ts`, `apps/store/src/pages/StoreLayout.tsx`, `StorePage.tsx`, `CartPage.tsx`, `OrderConfirmationPage.tsx`, `apps/store/src/cart/CartContext.tsx`: four-part route, tuple API identity, navigation and cart scoping.
- `functions/_middleware.ts`, `functions/_middleware.test.ts`, `apps/store/public/_redirects`: allow only canonical menu and checkout routes while preserving dashboard/API/static access.

## Task 1: Add regions and backfill existing stores

**Files:** Modify `apps/api/src/db/schema.ts`; create `apps/api/src/db/migrations/0012_regions.sql`; test via the API's D1 migration/test setup.

**Interfaces:** Add `regions` with `{ id, tenantId, name, slug, isDefault, createdAt }`. Add non-null `branches.regionId` referencing regions. Enforce unique `(tenantId, regionSlug)` and `(regionId, storeSlug)`.

- [ ] **Step 1: Write migration/schema tests for region backfill.** Assert that migration creates one default region per tenant with branches, assigns every prior branch to its tenant's default region, retains branch IDs and associated order/catalog references, and creates the new uniqueness constraints.
- [ ] **Step 2: Run the migration test and confirm failure.** Run `npm test --workspace apps/api -- --run tests/isolation/regions-migration.test.ts`; expected: migration/schema assertions fail because `regions` and `branches.region_id` do not exist.
- [ ] **Step 3: Add the Drizzle region model and migration.** Create deterministic IDs/slugs per tenant for default regions, then backfill matching branches. Rebuild `branches` if required by SQLite to make `region_id` non-null and change the unique index from `(tenant_id, slug)` to `(region_id, slug)`.
- [ ] **Step 4: Run migration-specific tests.** Expected: all existing branches are assigned exactly once; duplicate store slugs in different regions are accepted; duplicate store slugs within one region and duplicate region slugs per tenant are rejected.
- [ ] **Step 5: Run API typecheck and existing API tests.** Run `npm run build:api` and the migration test; expected: pass.

## Task 2: Add tenant-scoped region management API

**Files:** Modify `apps/api/src/routes/dashboard.ts`, `apps/dashboard/src/lib/api.ts`; add API tests in `apps/api/tests/dashboard.test.ts`.

**Interfaces:** `GET /api/dashboard/regions` returns `{ regions: Region[] }`; `POST /api/dashboard/regions` accepts `{ name, slug }` and returns `{ region }` with 201. `GET /api/dashboard/branches?regionId=...` filters stores by a tenant-owned region. `POST /api/dashboard/branches` requires `regionId`, validates ownership, and checks store slug uniqueness in that region.

- [ ] **Step 1: Add failing endpoint tests.** Cover create/list, invalid and duplicate region slugs, viewer/staff authorization, cross-tenant region IDs, missing region IDs on store creation, and equal store slugs in separate regions.
- [ ] **Step 2: Run focused tests and confirm expected failures.** Run `npm test --workspace apps/api -- --run tests/dashboard.test.ts`; expected: new region routes are missing and existing branch schema rejects region-based requests.
- [ ] **Step 3: Implement region routes and scoped validation.** Use `requireRole('admin')` for create and existing dashboard tenant context for listing. All region existence checks include `tenantId`.
- [ ] **Step 4: Update branch list/create contracts.** Include `regionId` in returned branches, filter by optional regionId, require regionId for new branches, and perform duplicate lookup by `(regionId, slug)`.
- [ ] **Step 5: Run the focused API tests.** Expected: all new hierarchy, validation, and permission cases pass.

## Task 3: Resolve public data and payment endpoints by account/region/store

**Files:** Modify `apps/api/src/index.ts`, `apps/api/src/auth/middleware.ts`, `apps/api/src/routes/public.ts`, `apps/api/tests/isolation/public-storefront.test.ts`, and `apps/api/tests/helpers.ts`.

**Interfaces:** Canonical API paths use `/api/public/:tenantSlug/:regionSlug/:storeSlug` with suffixes `/categories`, `/products`, `/orders`, and `/payment-qr`. Public context resolves tenant and region slugs and selects a branch matching both region ID and store slug.

- [ ] **Step 1: Add failing storefront isolation tests.** Test successful lookup for `(tenant, region, store)`, same store slug in two regions returning distinct branch data/QR URLs, unknown or mismatched region/store returning 404, and old public aliases not resolving.
- [ ] **Step 2: Run the focused isolation test and confirm failure.** Run `npm test --workspace apps/api -- --run tests/isolation/public-storefront.test.ts`; expected: canonical three-slug route does not yet exist.
- [ ] **Step 3: Update public tenant middleware context.** Resolve tenant by `tenantSlug`, region by `(tenantId, regionSlug)`, then branch by `(regionId, storeSlug)`; set tenant and branch contexts only after all three match.
- [ ] **Step 4: Register canonical public API routes and remove ambiguous aliases.** Preserve generic API not-found behavior; do not leave a two-segment or default-store alias capable of returning a storefront.
- [ ] **Step 5: Keep branch-specific QR URL canonical.** Emit `/api/public/{tenant}/{region}/{store}/payment-qr` and verify receipt upload/order operations still use the resolved branch context.
- [ ] **Step 6: Run focused public and receipt tests.** Run `npm test --workspace apps/api -- --run tests/isolation/public-storefront.test.ts tests/payment-receipts.test.ts`; expected: pass.

## Task 4: Add account → region → store dashboard workflow

**Files:** Modify `apps/dashboard/src/lib/api.ts`, `apps/dashboard/src/pages/DashboardPage.tsx`, `apps/dashboard/src/lib/locationLink.ts`, and `apps/dashboard/src/lib/locationLink.test.ts`.

**Interfaces:** Add `DashboardRegion`, `getDashboardRegions()`, and `createDashboardRegion({ name, slug })`; update branch functions with `regionId`; update `buildLocationLink(tenantSlug, regionSlug, storeSlug, origin?)`.

- [ ] **Step 1: Add failing link tests.** Assert `/upmstore/menu/pj/kk` for a store and allow the same store slug in another region to produce `/upmstore/menu/kk/kk`.
- [ ] **Step 2: Run dashboard helper tests and confirm failure.** Run `npx vitest run apps/dashboard/src/lib/locationLink.test.ts`; expected: current two-slug helper produces the old route.
- [ ] **Step 3: Add dashboard region API helpers and links.** Include types and request payloads matching Task 2 and canonical path construction.
- [ ] **Step 4: Implement selector cascade.** On account change reload regions and branches. On region change filter stores and choose that region's default store (or first store). On store change load branch-specific overview/orders/catalog.
- [ ] **Step 5: Add region creation and scope store creation.** In Stores tab provide region name/slug inputs and create action for admins. Require a selected region before store creation; list generated canonical links for stores in that region. Show API errors next to the relevant form.
- [ ] **Step 6: Run dashboard tests/build.** Run `npx vitest run apps/dashboard/src/lib/locationLink.test.ts` and `npm run build --workspace apps/dashboard`; expected: pass.

## Task 5: Update storefront URL, API requests, and cart isolation

**Files:** Modify `apps/store/src/App.tsx`, `apps/store/src/lib/storePath.ts`, `apps/store/src/lib/storePath.test.ts`, `apps/store/src/pages/StoreLayout.tsx`, `StorePage.tsx`, `CartPage.tsx`, `OrderConfirmationPage.tsx`, `apps/store/src/cart/CartContext.tsx`, and `apps/store/src/lib/api.ts` only if a typed helper is needed.

**Interfaces:** Route params are `{ slug: tenantSlug, regionSlug, locationSlug: storeSlug }`. `getPublicStorePath(tenantSlug, regionSlug, storeSlug)` returns `tenantSlug/regionSlug/storeSlug`; `getStoreUrlBase(...)` returns `/{tenantSlug}/menu/{regionSlug}/{storeSlug}`. Cart storage key includes all three slugs.

- [ ] **Step 1: Add failing path and cart identity tests.** Assert canonical menu/cart/order paths, canonical API identity, no path when any segment is absent, and distinct cart keys for identical store slugs in different regions.
- [ ] **Step 2: Run focused tests and confirm failure.** Run `npx vitest run apps/store/src/lib/storePath.test.ts`; expected: path helper lacks region support.
- [ ] **Step 3: Update React Router and path helpers.** Use `/:slug/menu/:regionSlug/:locationSlug` and derive URL/API values from the same tuple.
- [ ] **Step 4: Update all storefront actions.** Store fetch, categories/products, submit order, QR display, receipt upload, cart links, continue-ordering link, and cart storage must use the tuple.
- [ ] **Step 5: Run storefront tests and build.** Run `npx vitest run apps/store/src/lib/storePath.test.ts` and `npm run build --workspace apps/store`; expected: pass.

## Task 6: Enforce canonical Pages routing and deploy

**Files:** Modify `functions/_middleware.ts`, `functions/_middleware.test.ts`, and `apps/store/public/_redirects`.

- [ ] **Step 1: Add failing middleware cases.** Allow `/{tenant}/menu/{region}/{store}`, its `/cart` and `/order/{id}` routes; reject `/`, `/menu/{store}`, `/{tenant}/menu/{store}`, and `/{tenant}/{store}`. Keep dashboard, API, assets, and static files reachable.
- [ ] **Step 2: Run middleware tests and confirm failure.** Run `npx vitest run functions/_middleware.test.ts`; expected: current regex only allows the previous two-slug route.
- [ ] **Step 3: Update route matcher and redirects.** Match the three-slug menu path and checkout children, remove obsolete menu SPA rewrites, and retain dashboard rewrites.
- [ ] **Step 4: Run full verification.** Run `npm test`, `npm run build:pages`, focused store/dashboard/middleware Vitest files, and `git diff --check`; expected: all pass.
- [ ] **Step 5: Deploy the Pages project.** Run `npx wrangler pages deploy dist --project-name ordering-system` only after the preceding checks pass.
- [ ] **Step 6: Verify production.** Confirm one canonical menu and cart URL return 200, same-slug stores in two regions resolve independently through API, obsolete/root formats return 404, `/dashboard` remains 200, and API health/public routes behave as expected.

## Self-review

- Spec data model, role authorization, tenant isolation, canonical URL, same-slug behavior, cascaded dashboard selectors, migration, old-path rejection, and verification are each covered by Tasks 1–6.
- There are no placeholder steps; each task identifies contracts and runnable commands.
- API and frontend contracts consistently use account slug + region slug + store slug.
- No new account-creation UI is included; the agreed scope adds regions under existing accounts.
