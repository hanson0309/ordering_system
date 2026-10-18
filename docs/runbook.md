# Operations Runbook

## Local development

From the repository root:

```powershell
npm install
npm run build:api
npm run build:store
npm run build:dashboard
npm test
```

Run the API, customer store, and seller dashboard in separate terminals:

```powershell
npm run dev:api
npm run dev:store
npm run dev:dashboard
```

The local API uses Wrangler's D1 and R2 emulators. Both frontends proxy `/api` to `http://127.0.0.1:8787`.

To use the Telegram settings page locally, add `TELEGRAM_SETTINGS_ENCRYPTION_KEY` to `apps/api/.dev.vars` (this file is git-ignored). Use a random value of at least 32 bytes. The initial Telegram bot token and chat ID are then entered in Dashboard → Organization settings; they are encrypted before being saved in D1.

The customer ordering link is `http://127.0.0.1:5175/upm`.
The seller dashboard link is `http://127.0.0.1:5174/dashboard`.

Store owners can create additional stores from the Dashboard's `店铺管理` tab. Each store receives its own slug, public ordering link, product catalog, orders, and storefront design. A slug uses lowercase letters, numbers, and hyphens.

## Database

Apply local migrations with:

```powershell
npm run db:migrate:local
```

Apply production migrations only after verifying the target database ID and environment:

```powershell
npm --workspace apps/api run db:migrate:remote
```

Never use a client-supplied `tenant_id` for authorization. The active tenant comes from the server-side session and membership check.

## Secrets

Set production secrets with Wrangler. Never commit them, `.dev.vars`, Telegram bot tokens, or R2 credentials:

```powershell
$key = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$key | npx wrangler secret put TELEGRAM_SETTINGS_ENCRYPTION_KEY --env production
```

After setting this secret and applying database migrations, the platform administrator can enter the bot token and recipient chat ID in Dashboard → Organization settings. The bot token is encrypted with AES-GCM before it is stored in D1; the encryption key must remain stable or the saved token can no longer be decrypted. Existing `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` Worker secrets remain supported as a fallback when no dashboard configuration has been saved.

`TELEGRAM_BOT_TOKEN` is issued by BotFather. Start a chat with the bot to get a numeric user/chat ID. The Worker calls Telegram's HTTPS Bot API directly; no VM or private server is required.

## Notifications

Orders are written together with a `pending` notification job. A scheduled Worker checks due jobs every five minutes. The job loads the private PDF using its own `tenant_id` and sends it to the single configured Telegram chat.

Telegram failures are classified, recorded in `notification_attempts`, and retried up to five times. Staff can request a retry from the dashboard after a failed job. A sent job is not automatically sent again.

To trigger the scheduled handler locally:

```powershell
curl http://127.0.0.1:8787/cdn-cgi/local/scheduled
```

## Incident handling

1. If the storefront is down, check `/api/health` and the Wrangler deployment logs.
2. If orders work but notifications fail, inspect the dashboard notification status before touching orders.
3. Verify the Telegram bot token, chat ID, and that the recipient has started the bot.
4. Do not delete a pending or failed job to clear an incident; preserve the audit trail.
5. If Telegram returns a configuration or invalid-recipient error, correct the Worker secrets and retry only the intended jobs.
6. If a tenant isolation test fails, stop deployment and inspect the scoped query before changing frontend filters.

## Backups and recovery

- Export D1 according to the current Cloudflare-supported procedure before destructive migrations.
- R2 PDFs are private and can be regenerated from orders, but preserve the bucket during recovery when possible.
- Test restoration in a non-production environment before changing production bindings.
