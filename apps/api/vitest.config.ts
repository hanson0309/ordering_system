import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'

const dirname = import.meta.dirname

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/apply-migrations.ts'],
  },
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(dirname, 'src/db/migrations')
      const migrations = await readD1Migrations(migrationsPath)

      return {
        wrangler: { configPath: path.join(dirname, 'wrangler.toml') },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }
    }),
  ],
})
