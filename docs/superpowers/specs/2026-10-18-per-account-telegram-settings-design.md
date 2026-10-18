# Per-Account Telegram Settings Design

**Status:** Approved in chat; awaiting document review before implementation planning.

## Problem

Telegram credentials are currently stored as one encrypted platform-wide setting. Every store's scheduled and manual order-list notifications use that same bot token and recipient chat ID. The platform administrator needs to select a login account and maintain an independent Telegram configuration for it.

## Goals

- Give each dashboard login account an independent Telegram bot token and recipient chat ID.
- Let the platform administrator select an account, view whether it is configured, update it without revealing the saved token, and send a test message to that account's recipient.
- Use the account's Telegram configuration for notifications from all stores belonging to that account.
- Never fall back to another account's credentials or the former global Telegram configuration.
- Show an actionable `Telegram not configured` error for notification jobs belonging to an unconfigured account.
- Encrypt credentials at rest using the existing `TELEGRAM_SETTINGS_ENCRYPTION_KEY`.

## Non-goals

- Letting store owners or non-platform administrators manage Telegram configuration.
- Supporting multiple bots or recipients for one login account.
- Changing order batching, PDF contents, Malaysia-time scheduling, or retry policy except to expose the unconfigured-account error.
- Automatically copying the current global bot configuration to any account.

## Account and Store Ownership

A login account is represented by a non-platform `users.id`. One account may own multiple stores, each represented by a tenant. Notification jobs remain tenant-scoped, while Telegram configuration is account-scoped.

Introduce an explicit nullable `tenants.account_user_id` reference to `users.id` so each store can resolve its owning login account without inferring ownership from a request's active tenant or ambiguous membership roles. Account-tenant creation sets this to the created user ID; store creation sets it to the authenticated owner. A migration backfills it for existing tenants where ownership is deterministically known. Tenants whose owning account cannot be established remain unassigned and do not send through any other account's bot.

Add an `account_telegram_settings` table keyed by `account_user_id`, with one encrypted serialized credential value and an updated timestamp. The API decrypts only server-side. Neither read nor write responses contain the bot token; reads return only configured state and recipient chat ID.

## Dashboard Experience and API

The platform-admin Telegram settings panel adds an account selector listing each non-platform login account once by its unique email. Selecting an account loads only that account's configured state and chat ID. The token field is always blank; blank means keep the existing token when updating a configured account. The page retains the test-message action, which sends through the selected account's configuration.

Add platform-admin-only API operations to list selectable accounts, read a selected account's safe Telegram settings, save settings for a selected account, and test that account's settings. Account IDs are validated against non-platform users. The encryption key remains global and required for account settings; it is not the Telegram bot credential.

## Notification Routing and Missing Configuration

Before sending a tenant's order-list PDF, notification delivery loads `tenants.account_user_id`, then resolves that account's encrypted Telegram settings. A missing account association or missing Telegram configuration raises a non-sendable `telegram_not_configured` condition. No Telegram request is made in that case.

For missing configuration, pending notification jobs remain available for a later send after the platform administrator configures the account. Their `error_category` is set to `telegram_not_configured`, which is returned by the existing order notification API and rendered as a clear localized status in the dashboard. The normal successful send clears the error category. This does not introduce a new retry policy.

Manual send and test-message endpoints report the same actionable error without leaking credentials. Scheduled processing logs other delivery failures as today and records the unconfigured condition against the affected tenant's pending jobs.

## Migration and Legacy Configuration

The migration adds the account association and account-settings table, backfills tenant ownership only when known, and deletes only the `system_settings` row whose key is `telegram`. It does not remove unrelated system settings. Application code stops reading `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as fallback credentials, so legacy Worker secrets cannot cause cross-account delivery. The global encryption secret `TELEGRAM_SETTINGS_ENCRYPTION_KEY` remains in use.

No old Telegram configuration is copied. Every account begins unconfigured until the platform administrator selects it and saves its own credentials. Existing orders stay in their current tenants; no historical notification is redirected or automatically replayed by the migration.

## Security and Failure Handling

- All account-list and credential-management endpoints require platform-admin authorization.
- Account IDs are treated as selectors, never as authorization credentials.
- Encrypt bot token and chat ID before D1 persistence; never return or log either secret.
- Never use the global legacy bot as a fallback.
- Resolve the notification account from the persisted tenant association, never from client-supplied data.
- Unassigned or unconfigured tenants do not send; their pending jobs show `telegram_not_configured` until configuration is added and delivery succeeds.

## Verification

- API tests: platform-admin access, non-admin denial, account list uniqueness, account-scoped reads/writes, token redaction, test-message routing, and independent encrypted settings for two accounts.
- Notification tests: two accounts with separate bots/chats, multiple tenants attached to one account, no cross-account leakage, no legacy-env fallback, unassigned tenant handling, and clear missing-configuration job status.
- Dashboard tests/build: selector changes load the selected account, save/test target only that account, and English/Chinese labels render correctly.
- Run the complete API test suite and dashboard/API builds.
- Apply and test the migration against a local D1 database; verify that only the legacy Telegram row is deleted and tenant-to-account associations are backfilled as specified.

## Rollout

Deploy the code and D1 migration, then configure each login account's Telegram credentials from the platform-admin dashboard. The existing encryption key must remain unchanged. Until an account is configured, its notifications remain pending and visibly marked as not configured; no global bot is used.
