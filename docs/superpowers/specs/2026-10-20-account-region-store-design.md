# Account–Region–Store hierarchy

## Status

Proposed design for user review. The public menu URL format and hierarchy have been confirmed in chat; implementation has not started.

## Goal

Allow each account to manage multiple regions, with multiple stores in each region. Region/store names may repeat in different regions without making menu links ambiguous.

## Data model

Use the existing tenant as the account. Add a `regions` entity owned by a tenant, with a display name and URL-safe slug. Add a required region reference to each existing branch (the current store/location entity). A region has many stores; each store belongs to one region. Store slugs must be unique within a region, so two regions under one account may each have a store with the same slug.

Owners/admins may create and manage regions and stores, following the current catalog/location management permission pattern. All reads and writes remain tenant-scoped; a region ID or store ID from another tenant must not grant access.

## Public URL and API

The canonical menu URL is `/{accountSlug}/menu/{regionSlug}/{storeSlug}`. For example, identical `kk` stores in two regions can be addressed as `/upmstore/menu/pj/kk` and `/upmstore/menu/kk/kk`. Cart and order confirmation URLs remain children of that path.

The public API resolves the tuple `(accountSlug, regionSlug, storeSlug)` and verifies the store belongs to the resolved region and tenant. Dashboard-generated links, cart scoping, receipt/payment-QR requests, and public menu data requests must use this same tuple. Old public formats are not re-enabled.

## Dashboard workflow

The header selectors become a cascade: account → region → store. Changing account reloads its regions and stores; changing region filters the store selector; changing store loads that store's dashboard data. Provide a region-management interface to add/rename regions and create stores in the selected region. If no region exists, prompt an authorized user to create one before adding a store.

## Migration and failure behavior

Create one default region per existing account and assign its existing stores to it. The user has stated current data is test data and need not be preserved, but this migration keeps the deployment deterministic and avoids orphaned stores. New menu links are generated from the new tuple; old links may return 404 rather than silently resolving to the wrong store. Duplicate region slugs within an account and duplicate store slugs within a region are rejected with a clear conflict response.

## Verification

- API tests for region CRUD, membership/role authorization, tenant isolation, store-to-region validation, and same store slug in different regions.
- Storefront tests proving tuple-based lookup and distinct paths for duplicate store slugs across regions; verify old/root paths remain unavailable.
- Dashboard tests for cascading selectors and generated public links.
- Run all API tests, dashboard/store builds, migration checks, and `git diff --check`; after deployment verify canonical URLs, old URL rejection, dashboard access, and public API responses.

## Out of scope

Cross-account region sharing, region-level orders/products/catalogs independent of stores, region-specific public landing pages, and public region discovery pages.
