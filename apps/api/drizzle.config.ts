import { defineConfig } from 'drizzle-kit'

// `generate` (our normal workflow) only reads the schema and does not need
// live credentials. dbCredentials are only required for `push`/`studio`,
// which we don't use — migrations are applied via `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? '',
    token: process.env.CLOUDFLARE_D1_TOKEN ?? '',
  },
})
