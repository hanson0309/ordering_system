# Username Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Email with Username throughout dashboard authentication and user management without invalidating existing accounts.

**Architecture:** Add a unique `users.username` identity column and backfill existing users from their email local parts. Keep the existing email column as an internal compatibility value, while API contracts and dashboard views exclusively use normalized usernames.

**Tech Stack:** Cloudflare D1, Drizzle ORM, Hono, Zod, React, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-username-auth-design.md`

## Global Constraints

- Username format is `^[a-z0-9][a-z0-9_-]{2,31}$` after lowercase normalization.
- Existing passwords, sessions, memberships, and organization associations remain valid.
- New accounts store `<username>@internal.invalid` only as a non-displayed compatibility value.
- Run the production D1 migration before the API deployment.

---

### Task 1: Persist And Validate Usernames

**Files:**
- Create: `apps/api/src/db/migrations/0014_usernames.sql`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/tests/helpers.ts`
- Test: `apps/api/tests/auth.test.ts`

**Interfaces:**
- Produces `users.username: string | null` in Drizzle selections.
- Produces `normalizeUsername(value: string): string | null` for API validators.

- [ ] **Step 1: Write failing migration and validation tests**

```ts
expect(normalizeUsername(' Store_Admin ')).toBe('store_admin')
expect(normalizeUsername('ab')).toBeNull()
expect(normalizeUsername('bad@email')).toBeNull()
```

- [ ] **Step 2: Run the auth test file and verify the username assertions fail**

Run: `npm run test --workspace apps/api -- --run tests/auth.test.ts`
Expected: FAIL because `normalizeUsername` does not exist.

- [ ] **Step 3: Add the additive D1 migration and schema field**

```sql
ALTER TABLE users ADD COLUMN username text;
UPDATE users
SET username = lower(substr(email, 1, instr(email, '@') - 1))
WHERE username IS NULL;
CREATE UNIQUE INDEX users_username_unique ON users(username);
```

```ts
username: text('username'),
```

- [ ] **Step 4: Update test-user creation to persist a matching username**

```ts
const username = email.slice(0, email.indexOf('@')).toLowerCase()
await db().insert(users).values({ id, email, username, passwordHash })
```

- [ ] **Step 5: Run the auth tests and verify they pass**

Run: `npm run test --workspace apps/api -- --run tests/auth.test.ts`
Expected: PASS.

### Task 2: Change Authentication And User Management Contracts

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/routes/dashboard.ts`
- Modify: `apps/api/tests/auth.test.ts`
- Modify: `apps/api/tests/dashboard.test.ts`

**Interfaces:**
- Consumes `normalizeUsername(value)` from Task 1.
- `POST /auth/login` consumes `{ username: string, password: string }`.
- `POST /dashboard/users` consumes `{ username: string, password: string, role }`.
- User responses expose `{ id, username, role }` without email.

- [ ] **Step 1: Write failing route tests for username login and creation**

```ts
const login = await SELF.fetch('https://test.local/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'dashboard_admin', password: 'password123' }),
})
expect(login.status).toBe(200)

expect(createdUser).toMatchObject({ username: 'new_store', role: 'staff' })
expect(createdUser).not.toHaveProperty('email')
```

- [ ] **Step 2: Run the focused tests and verify they fail against email-based input**

Run: `npm run test --workspace apps/api -- --run tests/auth.test.ts tests/dashboard.test.ts`
Expected: FAIL because `username` is not accepted or returned.

- [ ] **Step 3: Implement username normalization and use it in both routes**

```ts
const username = normalizeUsername(parsed.data.username)
if (!username) return c.json({ error: 'invalid_input' }, 400)

const internalEmail = `${username}@internal.invalid`
await db.insert(users).values({ id: userId, username, email: internalEmail, passwordHash })
```

- [ ] **Step 4: Replace all dashboard user and Telegram account email selections with username selections**

```ts
.select({ id: users.id, username: users.username, role: memberships.role })
.orderBy(asc(users.username))
```

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `npm run test --workspace apps/api -- --run tests/auth.test.ts tests/dashboard.test.ts`
Expected: PASS.

### Task 3: Update Dashboard Login And User Management Views

**Files:**
- Modify: `apps/dashboard/src/lib/api.ts`
- Modify: `apps/dashboard/src/pages/DashboardLoginPage.tsx`
- Modify: `apps/dashboard/src/pages/DashboardPage.tsx`
- Modify: `apps/dashboard/src/lib/i18n.tsx`
- Test: `apps/dashboard/src/lib/api.test.ts`

**Interfaces:**
- `login(username: string, password: string)` sends `{ username, password }`.
- `DashboardUser` contains `username`, not `email`.

- [ ] **Step 1: Write a failing client test for the username login body**

```ts
expect(buildLoginBody('store_admin', 'password123')).toEqual({
  username: 'store_admin',
  password: 'password123',
})
```

- [ ] **Step 2: Run the dashboard client test and verify it fails**

Run: `npx vitest run apps/dashboard/src/lib/api.test.ts`
Expected: FAIL because the client still uses `email`.

- [ ] **Step 3: Change form state, labels, validation, and list rendering to Username**

```tsx
<input id="dashboard-username" autoComplete="username" value={username} />
<label>Username</label>
```

- [ ] **Step 4: Run the dashboard test and build**

Run: `npx vitest run apps/dashboard/src/lib/api.test.ts && npm run build:dashboard`
Expected: PASS.

### Task 4: Release And Verify The Migration

**Files:**
- Modify: `apps/api/src/db/migrations/meta/_journal.json`

**Interfaces:**
- Production D1 applies migration `0014_usernames.sql` before the API worker is deployed.

- [ ] **Step 1: Generate or update migration metadata for `0014_usernames.sql`**

```bash
npm run db:generate --workspace apps/api
```

- [ ] **Step 2: Run the entire verification suite**

Run: `npm test && npm run build:api && npm run build:pages && git diff --check`
Expected: all tests and builds pass with no whitespace errors.

- [ ] **Step 3: Apply production migration and deploy**

```bash
npm run db:migrate:remote --workspace apps/api
npm run deploy --workspace apps/api -- --env production
npx wrangler pages deploy dist --project-name ordering-system
```

- [ ] **Step 4: Verify the release**

```bash
npx wrangler d1 execute ordering_system_db_prod --remote --env production --command "SELECT username FROM users ORDER BY username;"
curl.exe -sS -o NUL -w "%{http_code}" https://ordering-system-ars.pages.dev/dashboard
```

Expected: each user has a username and the dashboard route redirects unauthenticated visitors to login.
