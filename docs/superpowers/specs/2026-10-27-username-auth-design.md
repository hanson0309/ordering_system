# Username Authentication Design

## Goal

Replace email-based dashboard account identity with a unique username, while preserving current accounts and passwords.

## Account Rules

- A username is 3 to 32 characters: lowercase letters, digits, underscores, and hyphens.
- Usernames are globally unique and used for dashboard login.
- User management creates, lists, and edits accounts by username. Email is not displayed or entered anywhere in the dashboard.
- The existing `users.email` column remains internal compatibility data. New accounts store a generated internal value of `<username>@internal.invalid`.

## Migration

1. Add nullable `users.username`.
2. Backfill every existing username from the lowercase portion before `@` in `users.email`.
3. Create a unique index for non-null usernames.
4. Production data has three distinct backfill values: `hansonng00`, `hansonng19`, and `hansonng4`.

The migration is additive: passwords, memberships, organizations, sessions, and old email data are unchanged.

## API And UI

- `POST /api/auth/login` accepts `{ username, password }` and resolves a user by username.
- Platform user management creates accounts with `{ username, password, role }` and returns username data.
- Dashboard login labels and browser autofill metadata use Username.
- The user-management list and edit dialog show usernames only.

## Validation And Verification

- Tests cover existing username login, rejection of unknown usernames, case-normalized username creation, duplicate rejection, and username-only dashboard presentation.
- Apply the migration to production before deploying the API and Pages assets.
- Run the API suite, API build, Pages build, and a post-deploy authenticated login check.
