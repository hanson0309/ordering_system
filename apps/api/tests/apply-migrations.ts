import { applyD1Migrations, env } from 'cloudflare:test'
import type { D1Migration } from '@cloudflare/vitest-plugin'
import type { Env } from '../src/types'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}

await applyD1Migrations((env as unknown as Env).DB, (env as any).TEST_MIGRATIONS)
