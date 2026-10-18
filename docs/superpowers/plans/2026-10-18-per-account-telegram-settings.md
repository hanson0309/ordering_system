# Per-Account Telegram Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the platform administrator to configure a separate Telegram bot and recipient for each dashboard login account and route all of that account's store notifications through those credentials.

**Architecture:** Add explicit `tenants.account_user_id` ownership and an encrypted `account_telegram_settings` row per non-platform user. Platform-admin APIs and the dashboard selector manage a selected account's configuration. Manual and scheduled notifications resolve the tenant's persisted account ID and never fall back to another account or legacy global Telegram credentials.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Cloudflare D1/Workers, React, Vitest, Wrangler.

**Spec:** `docs/superpowers/specs/2026-10-18-per-account-telegram-settings-design.md`

## Global Constraints

- Give each dashboard login account an independent Telegram bot token and recipient chat ID.
- Let the platform administrator select an account, view whether it is configured, update it without revealing the saved token, and send a test message to that account's recipient.
- Use the account's Telegram configuration for notifications from all stores belonging to that account.
- Never fall back to another account's credentials or the former global Telegram configuration.
- Show an actionable `Telegram not configured` error for notification jobs belonging to an unconfigured account.
- Encrypt credentials at rest using the existing `TELEGRAM_SETTINGS_ENCRYPTION_KEY`.
- All account-list and credential-management endpoints require platform-admin authorization.
- Account IDs are treated as selectors, never as authorization credentials.
- Encrypt bot token and chat ID before D1 persistence; never return or log either secret.
- Resolve the notification account from the persisted tenant association, never from client-supplied data.
- No old Telegram configuration is copied; only the `system_settings` row keyed `telegram` is deleted.

---

### Task 1: Persist account ownership and per-account credentials

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`
- Create: `apps/api/src/db/migrations/0011_account_telegram_settings.sql`
- Test: `apps/api/tests/isolation/account-migration.test.ts`
- Test: `apps/api/tests/helpers.ts`

**Interfaces:**
- Produces: nullable `tenants.accountUserId: string | null`, and `accountTelegramSettings` with `accountUserId`, encrypted `value`, and `updatedAt`.
- Migration behavior: map `tenant_account_<userId>` tenants to that user; map other tenants only where exactly one `owner` membership identifies a non-platform user; leave ambiguous legacy tenants unassigned; delete only `system_settings.key = 'telegram'`.

- [ ] **Step 1: Add failing migration tests.** In `account-migration.test.ts`, seed two ordinary users with their `tenant_account_<id>` tenant rows and memberships, a store with exactly one non-platform owner, an ambiguous tenant with two owner memberships, and a legacy `system_settings` row keyed `telegram` plus an unrelated key. Apply migration `0011` and assert account IDs are set for the first three deterministic tenants, the ambiguous tenant remains `NULL`, the Telegram row is deleted, and the unrelated setting remains. Add a second test that inserts a credential row for each user and proves the primary key prevents duplicate rows for the same account while allowing a different account.
- [ ] **Step 2: Run the migration tests and confirm they fail for the missing migration/schema.** Run: `npm --workspace apps/api test -- tests/isolation/account-migration.test.ts`. Expected: failures identify missing `account_user_id`, account-settings table, and migration journal entry.
- [ ] **Step 3: Add the Drizzle schema and SQL migration.** Add nullable `accountUserId` referencing `users.id` on `tenants`; define the account settings table with a user-ID primary key and encrypted JSON text value. In SQL, add the nullable tenant column, backfill account tenants by the stable `tenant_account_<id>` convention, backfill only tenants with exactly one `owner` membership whose user is not a platform admin, create the account settings table, and delete only the legacy Telegram key.
- [ ] **Step 4: Register migration `0011` in the journal and rerun migration tests.** Run: `npm --workspace apps/api test -- tests/isolation/account-migration.test.ts`. Expected: all migration and per-account uniqueness tests pass.
- [ ] **Step 5: Check generated migration metadata.** Run: `npm --workspace apps/api run build`. Expected: TypeScript accepts the schema and migration changes.

### Task 2: Assign new tenants to their login account

**Files:**
- Modify: `apps/api/src/routes/dashboard.ts`
- Test: `apps/api/tests/user-management.test.ts`
- Test: `apps/api/tests/isolation/auth-and-tenant.test.ts`

**Interfaces:**
- Consumes: `tenants.accountUserId` from Task 1.
- Produces: account tenant creation sets `accountUserId` to the new user ID; owner-created store creation sets it to the authenticated user ID.

- [ ] **Step 1: Add failing assertions to account and store creation tests.** After creating a dashboard account or an owner-created store, query the tenant and assert `accountUserId` equals the login user ID that owns it.
- [ ] **Step 2: Run the focused tests and confirm the assertions fail.** Run: `npm --workspace apps/api test -- tests/user-management.test.ts tests/isolation/auth-and-tenant.test.ts`. Expected: only new ownership assertions fail.
- [ ] **Step 3: Set ownership in both insert paths.** In `POST /users`, set the new account tenant's `accountUserId` to `userId`. In `POST /stores`, set the new tenant's `accountUserId` to `auth.userId`. Keep membership authorization and transaction batching unchanged.
- [ ] **Step 4: Rerun focused tests.** Run: `npm --workspace apps/api test -- tests/user-management.test.ts tests/isolation/auth-and-tenant.test.ts`. Expected: account isolation, authorization, and ownership assertions pass.

### Task 3: Add account-scoped Telegram APIs and credential resolution

**Files:**
- Modify: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/src/services/notifications.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/tests/dashboard.test.ts`
- Modify: `apps/api/tests/helpers.ts`

**Interfaces:**
- Produces: `GET /dashboard/telegram-accounts` returns distinct non-platform `{ id, email, configured }` rows.
- Produces: `GET /dashboard/telegram-settings?accountUserId=<id>` returns only `{ configured, chatId }`.
- Produces: `PUT /dashboard/telegram-settings` accepts `{ accountUserId, botToken?, chatId }` and returns only `{ configured, chatId }`.
- Produces: `POST /dashboard/telegram-settings/test` accepts `{ accountUserId }` and sends a test via that account's credentials.
- Produces: `getTelegramCredentials(env, db, accountUserId)` returns the selected account's decrypted `{ botToken, chatId }` or throws `TelegramError('telegram_not_configured')`.

- [ ] **Step 1: Add failing API tests.** Cover account-list uniqueness and platform-admin-only access; safe GET response without a bot token; save and update behavior where an omitted token preserves the selected account's token; rejection of unknown and platform-admin account IDs; independent encrypted settings for two users; account-targeted test-message requests; and non-platform-admin denial for every endpoint.
- [ ] **Step 2: Run the focused dashboard test file and confirm the new assertions fail.** Run: `npm --workspace apps/api test -- tests/dashboard.test.ts`. Expected: the new account-scoped routes/contracts are absent.
- [ ] **Step 3: Implement account-scoped API operations.** List users where `isPlatformAdmin = false` with a left join to `accountTelegramSettings`, returning one row per user. Validate every selected ID exists and is not a platform admin. Reuse `encryptSecret`/`decryptSecret`; never return the token. Preserve an existing bot token only when updating the same account and the submitted token is blank. Update the test endpoint to accept an account ID and use only that record.
- [ ] **Step 4: Update notification credential resolution and environment types.** Require `accountUserId` in `getTelegramCredentials`; read only `accountTelegramSettings`; remove `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from `Env` and do not use global fallbacks. Keep `TELEGRAM_SETTINGS_ENCRYPTION_KEY` required for decryption.
- [ ] **Step 5: Rerun focused API tests.** Run: `npm --workspace apps/api test -- tests/dashboard.test.ts`. Expected: all account selection, authorization, token-preservation, no-leak, and account-isolation tests pass.

### Task 4: Route tenant notifications and expose missing-account status

**Files:**
- Modify: `apps/api/src/services/notifications.ts`
- Modify: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/tests/dashboard.test.ts`
- Modify: `apps/api/tests/helpers.ts`

**Interfaces:**
- Consumes: `tenants.accountUserId` and `getTelegramCredentials(env, db, accountUserId)` from Tasks 1–3.
- Produces: manual and scheduled sends use only the tenant's assigned account; missing or null ownership is non-sendable and records `notificationJobs.errorCategory = 'telegram_not_configured'` without marking the job sent.

- [ ] **Step 1: Add failing notification tests.** Create two users with separate bots and two tenants owned by A plus one tenant owned by B. Mock Telegram fetch and assert each PDF goes only to the mapped bot/chat, both A tenants share A's credentials, and changing A's credentials leaves B unchanged. Add tests that a missing config and a null account owner make no Telegram request, leave jobs pending, and record `telegram_not_configured`; a later successful send clears that category. Verify the legacy environment variables cannot cause a send.
- [ ] **Step 2: Run the focused tests and confirm the routing/status assertions fail.** Run: `npm --workspace apps/api test -- tests/dashboard.test.ts`. Expected: current global resolver misroutes or lacks per-account behavior.
- [ ] **Step 3: Resolve account from the persisted tenant.** Before sending, load `accountUserId` from the tenant record; do not accept it from notification input or request JSON. Pass it to `getTelegramCredentials`. For an unconfigured/unassigned account, update pending jobs for that tenant with the `telegram_not_configured` error category and rethrow the typed error for manual sends.
- [ ] **Step 4: Record scheduled missing-configuration status.** In `processDueNotifications`, when the caught error is `TelegramError('telegram_not_configured')`, update only pending/retry-scheduled jobs belonging to that tenant with `errorCategory = 'telegram_not_configured'`; keep existing logging behavior for unrelated delivery errors. Successful delivery already clears `errorCategory` and must continue to do so.
- [ ] **Step 5: Verify focused tests.** Run: `npm --workspace apps/api test -- tests/dashboard.test.ts`. Expected: no cross-account Telegram call, stable pending job status with visible error category, and successful recovery after account configuration.

### Task 5: Build the platform-admin account selector UI

**Files:**
- Modify: `apps/dashboard/src/lib/api.ts`
- Modify: `apps/dashboard/src/pages/DashboardPage.tsx`
- Modify: `apps/dashboard/src/lib/i18n.tsx`

**Interfaces:**
- Consumes: the account-list and account-scoped settings/test APIs from Task 3.
- Produces: platform-admin Telegram panel with selected account state, blank token field, safe save/test actions, and account-specific status copy.

- [ ] **Step 1: Add account-scoped frontend API wrappers.** Define typed wrappers for account list, settings read/save, and test send, passing `accountUserId` as query or JSON according to the API contract.
- [ ] **Step 2: Add selector and selection state.** Load the account list when the panel opens, select the first account only when none is selected, reload safe settings when selection changes, and clear transient success/error messages on account switch. Display the account email next to the selector.
- [ ] **Step 3: Make save and test target the selected account.** Keep the bot-token input blank after loading, preserve it server-side when blank, disable actions when there is no selected account, and ensure the test action submits the selected account ID.
- [ ] **Step 4: Add English and Chinese strings.** Add translations for account selection, account-specific configured/unconfigured state, account loading/no accounts, and Telegram-not-configured notification status. Do not localize or display secret values.
- [ ] **Step 5: Build the dashboard.** Run: `npm run build:dashboard`. Expected: TypeScript and Vite production build succeed.

### Task 6: Verify notification status UI, migrations, and full suite

**Files:**
- Modify: `apps/dashboard/src/pages/DashboardPage.tsx`
- Modify: `apps/dashboard/src/lib/i18n.tsx`
- Modify: `docs/runbook.md`
- Test: `apps/api/tests/dashboard.test.ts`
- Test: `apps/api/tests/isolation/account-migration.test.ts`

**Interfaces:**
- Consumes: `notification.errorCategory` returned by the existing order detail API.
- Produces: clear localized `Telegram not configured` status; runbook documents per-account setup and states that no legacy global bot is used.

- [ ] **Step 1: Add a UI/API assertion for `telegram_not_configured`.** Verify the notification error category is exposed by the order API and translated to a human-readable dashboard message in English and Chinese.
- [ ] **Step 2: Run the focused API suite.** Run: `npm --workspace apps/api test -- tests/dashboard.test.ts tests/isolation/account-migration.test.ts`. Expected: migration, account separation, and notification status tests pass.
- [ ] **Step 3: Update the runbook.** Replace global Telegram setup instructions with: set one stable encryption key; open platform-admin Telegram settings; select each login acc and save its bot/chat credentials; send a test; unconfigured accounts do not use another account's bot; the legacy global bot secrets are ignored.
- [ ] **Step 4: Run the complete test/build verification.** Run `npm test`, `npm run build:api`, and `npm run build:dashboard`. Expected: all API tests pass and both production builds succeed.
- [ ] **Step 5: Check patch hygiene.** Run `git diff --check` and verify the migration deletes only the `telegram` key, no secrets were added to tracked files, and `git status --short` contains only intended feature changes plus the already committed spec/plan history.

---

## Plan Self-Review

- Spec coverage: account ownership/schema (Task 1), new tenant assignment (Task 2), admin account APIs and encryption (Task 3), manual/scheduled routing and missing-config status (Task 4), selector and translations (Task 5), runbook and full verification (Task 6).
- Placeholder scan: every test command, target files, expected results, and implementation boundaries are stated; no `TODO`, `TBD`, or generic "write tests" steps remain.
- Type consistency: account scope consistently uses `accountUserId`; API returns safe settings only; notifications resolve that ID from persisted tenant ownership and pass it to the account credential resolver.
