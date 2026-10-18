# Account Data Isolation Design

Date: 2026-10-18

## Goal

Give each ordinary dashboard account a separate business-data space while
preserving the primary account's ability to view and manage every account's
data. Ordinary accounts must not be able to access one another's data.

## Current behavior

Business records are already scoped by `tenant_id`. Authenticated dashboard
requests resolve a tenant from the server-side session and the user's
membership, and repository queries filter records by that tenant. However,
the dashboard's account-creation route currently adds every new user as a
membership in the active tenant. As a result, all users created there share
the same products, orders, customers, settings, branches, and analytics.

The primary user has a platform-administrator flag, but the regular
organization switch and dashboard flows currently rely on explicit tenant
memberships; there is not yet a complete cross-tenant account-management
experience.

## Recommended model

Continue using tenants as the data-isolation boundary. Give each ordinary
account its own tenant and membership, rather than introducing a second
account identifier on every business table or a separate database per user.

- The primary account remains a platform administrator and retains its
  existing tenant and records.
- Every ordinary account belongs to its own tenant. Its normal dashboard
  requests remain scoped to that tenant only.
- The platform administrator can list accounts/tenants and select one to
  inspect or manage. Tenant context must be authorized server-side; a client
  supplied tenant ID alone must never grant access.
- Platform-wide privileges are checked independently from tenant membership
  and never inferred from an ordinary tenant role.
- Existing tenant roles continue to control actions inside an ordinary
  account's own data space. The primary administrator can manage ordinary
  accounts' credentials and roles.
- Creating a new ordinary account provisions its own tenant, user, and
  membership as one logical operation. It must not attach the account to the
  primary account's tenant.

## Existing data and accounts

The user confirmed the currently shared data is not important and does not
need to be redistributed. Keep the existing records in their current tenant
for the primary account; do not copy them into each new account. Existing
ordinary accounts should receive separate empty tenants. Their memberships
in the legacy shared tenant should be removed so they cannot continue to see
the old shared dataset. Do not delete legacy records as part of this change.

Migration must be repeatable and preserve the primary account's access. It
must identify the primary account explicitly rather than relying on row
ordering or assuming every current non-primary account should be deleted.
For existing users, assign each non-primary user a dedicated tenant and
move their membership to it; preserve their current tenant role unless the
account administrator explicitly changes it. Existing sessions must be
updated to the new authorized tenant (or revoked so the user must log in
again), so they cannot remain attached to the legacy shared tenant.

## Authentication and authorization

- Ordinary users can log in and switch only to their single authorized
  tenant. Attempts to guess another tenant ID must fail on every route.
- Platform-admin tenant selection is allowed only after checking the current
  user's platform-admin flag and that the target tenant is active.
- When the administrator operates within a selected tenant, the backend
  establishes an explicit authorized tenant context before invoking existing
  tenant-scoped handlers. It must not silently widen ordinary tenant queries
  to all tenants.
- Account-list, account-create, account-update, and cross-tenant selection
  endpoints are platform-admin-only. Ordinary tenant owners must not be able
  to create users attached to another account or change platform privileges.
- Password changes should revoke the target account's existing sessions, as
  the current account-management flow does.
- Storefront/public routes continue resolving data by store slug and remain
  isolated by tenant.

## User experience

The primary administrator should have a clear account/tenant selector in the
dashboard and be able to return to the primary account. An account opened by
the administrator should be visibly identified to avoid confusing its data
with the primary account's data. Ordinary users should not see other accounts
in the selector. Account creation should communicate that each account gets
independent, initially empty data.

## Data coverage

Isolation covers all tenant-owned records and associated objects, including
branches, categories, products, images, customers, orders, order items,
notification jobs/attempts, audit logs, business settings, payment files,
and analytics. Any object storage key or generated document lookup must be
validated against the authorized tenant, not just an unguessable object ID.
Platform-level settings (such as a global Telegram integration) remain
platform-wide and are not copied to each tenant.

## Verification requirements

Automated HTTP-level tests should prove that:

1. Two ordinary users have different tenants and cannot read, mutate, or
   download each other's records/files by changing path, query, or body IDs.
2. Creating a new account provisions a fresh tenant and does not add it to
   the legacy shared tenant.
3. An ordinary user cannot enumerate or switch into another tenant.
4. The primary administrator can list accounts, switch into each tenant,
   read and manage its data, and return to the primary tenant.
5. Removing an ordinary user's legacy membership takes effect immediately,
   including for existing sessions.
6. Tenant-scoped analytics and background notification jobs do not combine
   data from separate accounts.
7. Public storefront requests continue to resolve only the requested active
   tenant.

Run the API test suite and both API and dashboard production builds. Review
database migration behavior on a copy of production-shaped data before any
production migration. This design document does not authorize deployment.

## Out of scope

- Deleting legacy records or changing how stores/branches are modeled.
- Giving ordinary accounts access to shared organization data.
- Changing global Telegram settings to per-account settings.
- Deploying or applying a production database migration.
