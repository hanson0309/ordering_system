# Payment QR and Receipt Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add branch payment QR management, public QR display, customer receipt upload, and dashboard receipt viewing/download without Telegram receipt notifications.

**Architecture:** Store branch QR and order receipt objects in the existing Cloudflare R2 bucket and keep only scoped object keys and metadata in D1. Public routes expose QR images through a tenant/branch-checked stream endpoint; dashboard routes expose authenticated receipt streams. The storefront confirmation page owns the post-order upload interaction.

**Tech Stack:** Cloudflare Workers, Hono, D1/Drizzle, R2, React, TypeScript, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-10-17-payment-qr-receipt-design.md`

## Global Constraints

- Use the existing Cloudflare Worker, D1, and R2 bindings; do not add a server or payment gateway.
- Keep Telegram notification behavior unchanged and never enqueue a second Telegram notification for receipt uploads.
- Scope every dashboard query and public order mutation to the resolved tenant and branch.
- Limit QR and receipt uploads to 5 MB and validate MIME types before writing to R2.
- Use `apply_patch` for source edits and run tests/builds before completion.

---

### Task 1: Add schema and migrations

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/migrations/0005_payment_qr_receipt.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`
- Test: `apps/api/tests/payment-receipts.test.ts`

- [ ] **Step 1: Write failing schema/API tests** asserting a branch QR key and order receipt metadata can be persisted and returned.
- [ ] **Step 2: Run the focused tests and confirm they fail because the columns/routes are missing.**
- [ ] **Step 3: Add nullable branch QR and order receipt columns plus the migration.
- [ ] **Step 4: Run the focused tests and confirm the schema portion passes.**

### Task 2: Implement QR upload, fallback, and public streaming

**Files:**
- Modify: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/src/routes/public.ts`
- Modify: `apps/api/src/auth/middleware.ts` only if branch context needs additional data
- Test: `apps/api/tests/payment-receipts.test.ts`

- [ ] **Step 1: Add failing tests for admin QR upload, delete, branch-specific selection, default fallback, and public 404 when no QR exists.**
- [ ] **Step 2: Run the tests and verify the expected route failures.**
- [ ] **Step 3: Implement multipart validation, R2 writes/deletes, scoped queries, and public image streaming.**
- [ ] **Step 4: Run the focused tests and verify all QR cases pass.**

### Task 3: Implement receipt upload and authenticated download

**Files:**
- Modify: `apps/api/src/routes/public.ts`
- Modify: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/src/services/orders.ts` if a receipt-specific helper is needed
- Test: `apps/api/tests/payment-receipts.test.ts`

- [ ] **Step 1: Add failing tests for image/PDF receipt upload, 5 MB rejection, invalid MIME rejection, branch scoping, metadata persistence, and dashboard download.**
- [ ] **Step 2: Run the tests and verify they fail before implementation.**
- [ ] **Step 3: Implement receipt object-key generation, replacement cleanup, metadata update, and authenticated streaming.**
- [ ] **Step 4: Run the focused tests and verify all receipt cases pass without creating a notification job.**

### Task 4: Wire dashboard API and location UI

**Files:**
- Modify: `apps/dashboard/src/lib/api.ts`
- Modify: `apps/dashboard/src/pages/DashboardPage.tsx`
- Modify: `apps/dashboard/src/lib/i18n.tsx`

- [ ] **Step 1: Add dashboard API helpers and failing type/build checks for QR upload/delete and receipt links.**
- [ ] **Step 2: Implement QR upload/delete controls in each location row, including default/fallback copy.**
- [ ] **Step 3: Add a receipt column/link to the order table with a clear unavailable state.**
- [ ] **Step 4: Add Chinese and English translations and run the dashboard typecheck/build.**

### Task 5: Wire storefront confirmation upload

**Files:**
- Modify: `apps/store/src/lib/api.ts`
- Modify: `apps/store/src/pages/OrderConfirmationPage.tsx`
- Modify: `apps/store/src/lib/i18n.tsx`
- Modify: `apps/store/src/App.tsx` only if routing needs adjustment

- [ ] **Step 1: Add failing type/UI checks for QR display, file selection, upload progress, success, and retry error states.**
- [ ] **Step 2: Implement QR display from the public store response and receipt upload form on the confirmation page.**
- [ ] **Step 3: Keep the order confirmation usable when no QR is configured and prevent files over 5 MB or unsupported types.**
- [ ] **Step 4: Run store build and the full API test suite.**

### Task 6: Apply migrations and final verification

**Files:**
- Modify: none

- [ ] **Step 1: Apply `npm run db:migrate:local`.**
- [ ] **Step 2: Run `npm test`, `npm run build:api`, `npm run build:dashboard`, and `npm run build:store`.**
- [ ] **Step 3: Run `git diff --check` and inspect the final changed-file list against the spec.**
