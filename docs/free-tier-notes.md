# Free-Tier Operating Notes

This project is designed for a small workload of roughly 2-5 orders and PDF notifications per day. RM0/month is a target, not a guarantee: provider terms, regional availability, account verification, and accidental quota increases remain outside the application.

## Cloudflare

- Pages is suitable for the static Vite build. Confirm the current build and file limits in the Pages limits documentation before creating production projects.
- Workers Free currently advertises 100,000 requests/day. The free CPU budget is tight, so this app avoids headless-browser work in Workers and keeps queries indexed and tenant-scoped.
- D1 has a free storage/read/write allowance, but daily limits are enforced. A runaway query can make later requests fail until the quota resets. Keep pagination, indexes, and query counts under review.
- R2 is used for private PDFs and future product images. Object keys are not treated as authorization; every download checks the active tenant first.
- Cloudflare Queues is not required for the current volume. The D1-backed notification job table keeps the dependency count and operating cost lower.

Check current limits immediately before production deployment:

- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/changelog/2026-02-04-queues-free-plan

## Telegram notifications

Telegram delivery uses the Bot API directly from the Cloudflare Worker. There is no Oracle VM, WhatsApp session, QR pairing flow, or separate notification server. The application stores orders before creating notification jobs, so a Telegram outage does not lose orders.

## Usage controls

- The API stores money as integer sen and uses server-side prices.
- Dashboard order lists are paginated and every query is tenant-scoped.
- Notification retries stop after five attempts with exponential backoff.
- PDFs are cached privately in R2 and are not exposed through public URLs.
- Review D1, R2, and Workers usage monthly before enabling new features.
