import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRoutes } from './routes/auth'
import { membershipRoutes } from './routes/memberships'
import { publicRoutes } from './routes/public'
import { dashboardRoutes } from './routes/dashboard'
import { processDueNotifications } from './services/notifications'
import type { Env, AppVariables } from './types'

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>()

// CORS is intentionally narrow: only the storefront/dashboard origin may
// call this API with credentials. Production traffic is also proxied through
// Pages on this same origin via a Service Binding; do not widen to "*".
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed =
        c.env.ENVIRONMENT === 'production'
          ? ['https://ordering-system-ars.pages.dev']
          : ['http://localhost:5173']
      return origin && allowed.includes(origin) ? origin : null
    },
    credentials: true,
  }),
)

app.get('/api/health', (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }))

app.route('/api/auth', authRoutes)
app.route('/api', membershipRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/public/:tenantSlug/:regionSlug/:storeSlug', publicRoutes)

// Generic error handler: never leak stack traces, query details, or
// another tenant's data in error responses.
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal_error' }, 500)
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(processDueNotifications(env))
  },
}
