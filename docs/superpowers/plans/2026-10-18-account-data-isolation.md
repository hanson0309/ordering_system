# Account Data Isolation Implementation Plan

> **For agentic workers:** Use the inline execution workflow with review checkpoints. Complete tasks in order; keep each tenant-scoping regression test in place.

**Goal:** Give each ordinary dashboard account an isolated tenant while allowing the platform administrator to inspect and manage every tenant.

**Architecture:** Continue using `tenant_id` as the only business-data boundary. Provision one private tenant per ordinary user, let platform-admin-only account APIs enumerate and select tenants, and derive an authorized tenant context on the server before existing tenant-scoped dashboard handlers run. Keep all legacy business records in their existing tenants; remove ordinary users' legacy memberships and give them clean tenants.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Cloudflare D1, React, Vitest, npm workspaces/build scripts.

**Spec:** `docs/account-data-isolation-design.md`

## Global Constraints

- Ordinary users can only access their own account's tenant.
- Cross-tenant selection and account administration require the explicit platform-admin flag.
- Existing legacy business records are not copied or deleted.
- Tenant IDs and ownership must be resolved and authorized server-side.
- Global Telegram settings remain platform-wide.
- Do not deploy or apply production migrations as part of implementation.
- Do not commit or push; the user requested no AI traces on GitHub.
- Preserve all pre-existing Telegram worktree changes and unrelated untracked files.

---

### Task 1: Add regression tests for per-account provisioning and admin tenant access

**Files:**
- Modify: `apps/api/tests/isolation/auth-and-tenant.test.ts`
- Modify: `apps/api/tests/helpers.ts`
- Test: `apps/api/tests/isolation/auth-and-tenant.test.ts`

**Interfaces:**
- Use existing `createTenant`, `createUser`, `addMembership`, `loginAndGetCookie`, `switchOrganization`, and `SELF.fetch` helpers.
- Add an explicit `createPlatformAdmin` helper only if tests currently lack a concise way to grant the platform flag.

- [ ] **Step 1: Write failing HTTP tests**
  - Test that two ordinary users provisioned by the account-management endpoint each receive a different tenant.
  - Test that the primary administrator's `/api/me/organizations` response lists all active tenants while an ordinary user's response lists only their own.
  - Test that a platform admin can switch to a tenant without an ordinary membership, while a normal user cannot.
  - Test that a normal user cannot read another tenant's `/api/dashboard/summary` after guessing its ID.
- [ ] **Step 2: Run only the isolation tests**

  Run: `npm --workspace apps/api test -- tests/isolation/auth-and-tenant.test.ts`

  Expected: New cases fail because user provisioning attaches users to the current tenant and organization switching requires membership.
- [ ] **Step 3: Keep this task test-only**
  - Do not weaken existing membership-denial assertions or bypass `requireTenant` in tests.
- [ ] **Step 4: Re-run the isolation tests after Tasks 2–4**

  Run: `npm --workspace apps/api test -- tests/isolation/auth-and-tenant.test.ts`

  Expected: All new and existing isolation tests pass.

### Task 2: Create an idempotent migration for existing accounts

**Files:**
- Create: `apps/api/src/db/migrations/0010_isolate_dashboard_accounts.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`
- Test: `apps/api/tests/isolation/account-migration.test.ts` (create if migration tests are not currently grouped elsewhere)

**Interfaces:**
- Use `users`, `tenants`, `memberships`, and `sessions` schemas from `apps/api/src/db/schema.ts` as the source of truth.
- Preserve the primary ID `user_hansonng00` and its tenant membership. Do not hard-code any current non-primary user IDs.

- [ ] **Step 1: Write a migration fixture test**
  - Seed a primary account and two ordinary users in a shared tenant, with distinct roles and existing sessions.
  - Apply the migration and assert that the primary membership remains unchanged; each ordinary user has exactly one distinct new tenant/membership; legacy records stay in their original tenant; and old session tenant context is moved to the user's new tenant or the session is revoked.
  - Apply the migration a second time and assert that no duplicate tenants or memberships are produced.
- [ ] **Step 2: Run the migration test to verify it fails**

  Run: `npm --workspace apps/api test -- tests/isolation/account-migration.test.ts`

  Expected: FAIL because migration `0010` does not exist.
- [ ] **Step 3: Implement deterministic, repeatable SQL**
  - Create each ordinary user's tenant using a stable ID derived from that user's existing ID, with a unique safe slug derived from the same ID.
  - Insert the private membership using the user's current role in the legacy account where available; use the least-privileged current role if multiple memberships must be reconciled.
  - Remove ordinary users' memberships to shared legacy tenants after their private memberships exist.
  - Keep all legacy tenant and business rows intact, including branches, catalog, customers, orders, settings, and object keys.
  - Move or revoke sessions so no existing ordinary session remains authorized for a shared tenant.
  - Add the migration entry after `0009` in the Drizzle journal using the repository's existing format.
- [ ] **Step 4: Run the migration test and isolation tests**

  Run: `npm --workspace apps/api test -- tests/isolation/account-migration.test.ts tests/isolation/auth-and-tenant.test.ts`

  Expected: Both suites pass, including idempotence and legacy-data-retention assertions.

### Task 3: Authorize platform-admin tenant context and account APIs

**Files:**
- Modify: `apps/api/src/auth/middleware.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/routes/memberships.ts`
- Modify: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/src/types.ts` only if a separate tenant-context marker is needed
- Test: `apps/api/tests/isolation/auth-and-tenant.test.ts`
- Test: `apps/api/tests/dashboard.test.ts`

**Interfaces:**
- Preserve `AuthContext.isPlatformAdmin` as the only cross-tenant grant.
- Keep existing handlers consuming `TenantContext.tenantId` and `TenantContext.role`; establish those values only after checking the session and user privilege.
- `/api/me/organizations` remains the UI's organization list; for platform admins it returns all active tenants, while regular users still receive only membership-backed tenants.
- `POST /api/auth/switch-organization` accepts `{ tenantId: string }` for both users and platform admins, with membership validation for users and platform-admin validation plus active-tenant validation for admins.

- [ ] **Step 1: Add failing endpoint tests**
  - Confirm an ordinary account cannot switch to a non-member tenant or list tenants it does not belong to.
  - Confirm a non-admin cannot call cross-account user-list, create, update, or switch APIs by adding IDs in the body/query.
  - Confirm a platform admin can select an active tenant and all existing dashboard reads remain filtered to that selected tenant.
  - Confirm an inactive tenant cannot be selected even by a platform admin.
- [ ] **Step 2: Run the focused suites and verify the new cases fail**

  Run: `npm --workspace apps/api test -- tests/isolation/auth-and-tenant.test.ts tests/dashboard.test.ts`

  Expected: Admin selection/listing fails; tests must continue proving ordinary users are denied.
- [ ] **Step 3: Implement explicit platform-admin resolution**
  - Change organization listing to enumerate active tenant metadata only for the platform admin; never expose user/password/session data in that response.
  - Change organization switch to verify the platform-admin flag and target tenant status before creating the new session. Keep ordinary membership validation unchanged.
  - Update tenant middleware to load the selected active tenant for a platform admin and assign the existing tenant-scoped role context without creating a fake membership. Reject absent, suspended, or unknown target tenants.
  - Add platform-admin-only account-list, account-create, and account-update handlers. List ordinary users with their dedicated tenant metadata; create a user, tenant, membership, and initial settings together; update a target account's membership role/password only after verifying it is an ordinary account. Never allow this API to grant `is_platform_admin`.
  - Preserve password hashing and session revocation on password changes.
  - Keep all existing record handlers using their current `tenant_id` predicates; do not add a cross-tenant query mode.
- [ ] **Step 4: Run focused API suites**

  Run: `npm --workspace apps/api test -- tests/isolation/auth-and-tenant.test.ts tests/dashboard.test.ts`

  Expected: Admin cross-tenant operations work only for the platform admin; all ordinary account isolation tests pass.

### Task 4: Add admin account selector and context labeling

**Files:**
- Modify: `apps/dashboard/src/lib/api.ts`
- Modify: `apps/dashboard/src/lib/i18n.tsx`
- Modify: `apps/dashboard/src/pages/DashboardPage.tsx`
- Modify: `apps/dashboard/src/pages/DashboardLoginPage.tsx` only if the zero-membership login state needs adjustment
- Test: `apps/dashboard` existing component or browser tests, if present; otherwise validate through production build and browser smoke test

**Interfaces:**
- Extend the organization/account response type with only safe display fields: `tenantId`, `slug`, `name`, and optional role/account label.
- Add client methods for the platform-admin account list/create/update routes and reuse `switchOrganization(tenantId)` for selecting an authorized tenant.
- Keep account-specific UI hidden unless `isPlatformAdmin` is true.

- [ ] **Step 1: Add UI/API test coverage for account switching**
  - Verify that an administrator sees all account spaces and the active one is indicated.
  - Verify that an ordinary user sees only their own account and no platform account-management controls.
  - Verify changing the active account reloads dashboard data instead of showing stale data from the previously selected tenant.
- [ ] **Step 2: Run the focused dashboard tests to verify expected failures**

  Run: `npm --workspace apps/dashboard test -- --run` (if the dashboard workspace has a test script; otherwise record that no dashboard test script exists and use the browser smoke check in Step 4).
- [ ] **Step 3: Implement account management UI**
  - Show a clearly labeled account selector only for the platform admin; switching calls the server endpoint and reloads all tenant-dependent dashboard resources.
  - Add an unmistakable active-account banner/label so the administrator can tell whose data is currently displayed.
  - Add an admin-only account list/create/edit panel; new-account copy states its data starts empty. Preserve existing editable role and password behavior for ordinary accounts.
  - Add English and Chinese translations for all new text; do not change the default language behavior.
  - Keep the normal account's existing tenant switcher limited to memberships it is authorized to access.
- [ ] **Step 4: Build and smoke-test dashboard behavior**

  Run: `npm run build:pages`

  Expected: Production dashboard build succeeds. In a local test session, switching between two seeded accounts changes tenant-specific dashboard results and the active-account label.

### Task 5: Verify all tenant-owned surfaces and release readiness

**Files:**
- Modify tests only where uncovered tenant-owned surfaces reveal a regression, including `apps/api/tests/isolation/auth-and-tenant.test.ts`, `apps/api/tests/order-creation.test.ts`, and `apps/api/tests/dashboard.test.ts`.
- Review: `apps/api/src/routes/dashboard.ts`, `apps/api/src/routes/public.ts`, `apps/api/src/services/orders.ts`, `apps/api/src/services/notifications.ts`, and R2 object-key construction in dashboard handlers.
- Modify: `docs/runbook.md` only if it needs a clear local migration/recovery note.

**Interfaces:**
- All dashboard data operations continue to use server-resolved `TenantContext.tenantId`.
- Public order creation and store lookup continue to use the public tenant resolved from the store slug.

- [ ] **Step 1: Add/complete HTTP isolation cases for sensitive resources**
  - Cross-account order, receipt, PDF, payment-QR, and product-image IDs return the existing not-found/forbidden response without returning bytes or metadata.
  - Analytics totals and order-list jobs for one account contain no records from another account.
  - Public store slug A never returns tenant B's catalog, settings, QR, customers, or order data.
- [ ] **Step 2: Run the full API suite**

  Run: `npm --workspace apps/api test`

  Expected: All API tests pass, including account migration, authorization, account administration, notifications, and public ordering.
- [ ] **Step 3: Run both production builds and whitespace checks**

  Run: `npm run build:api; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run build:pages; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git diff --check`

  Expected: API and dashboard builds succeed; `git diff --check` reports no whitespace errors.
- [ ] **Step 4: Review pending changes and stop before production actions**
  - Confirm Telegram changes remain intact and no unrelated `docs/superpowers/` files were modified.
  - Do not commit, push, set Cloudflare secrets, apply remote D1 migrations, or deploy. Report the test/build results and request explicit deployment approval separately.

## Plan Self-Review

- Spec coverage: tenant model, primary-admin cross-tenant access, ordinary-user denial, migration behavior, global settings boundary, object storage, analytics/background jobs, tests, and deployment exclusion are covered by Tasks 1–5.
- Placeholder scan: no TBD/TODO implementation steps; dashboard test availability is explicitly conditional on the repository's scripts.
- Type consistency: all authenticated tenant handlers continue to receive `TenantContext`; platform-admin privilege remains in `AuthContext`; account APIs are gated by the platform-admin flag.
- Data migration safety: old rows remain in place; account membership/session remapping is tested for repeatability before any production migration.
