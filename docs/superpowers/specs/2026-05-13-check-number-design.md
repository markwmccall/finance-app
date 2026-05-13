# Phase 1d — Check Number Support

## Overview

Add `check_number` to the transactions table, capture it from Plaid during sync, accept it in the manual entry form, and display it in the Register alongside the payee.

This phase is a prerequisite for Phase 1f (transaction matching), where `check_number` will be the primary match key for deduplicating manual entries against Plaid-synced transactions.

**Out of scope:** Editing `check_number` (or any other field) after a transaction is saved. That belongs in the transaction editing phase.

---

## Schema Migration

`server/src/schema.ts` requires two changes:

1. Add `check_number TEXT` to the `CREATE TABLE IF NOT EXISTS transactions` definition so fresh installs include it.
2. After the init block, add a startup migration: read `PRAGMA table_info(transactions)`, check whether the `check_number` column exists, and if not run:
   ```sql
   ALTER TABLE transactions ADD COLUMN check_number TEXT
   ```

SQLite allows adding a nullable column with no default without rebuilding the table. No data loss, no downtime.

---

## Plaid Sync

`server/src/routes/plaid.ts`:

- Add `check_number?: string | null` to the local `PlaidTx` type (currently defined inline on line 140).
- Pass `check_number: tx.check_number ?? null` into the `INSERT INTO transactions` VALUES clause.
- Include `check_number = excluded.check_number` in the `ON CONFLICT DO UPDATE` clause so re-syncing a transaction updates its check number if Plaid later provides one.

Plaid defines `transaction.check_number` as `string | null`. No parsing or validation is applied — the value is stored as-is.

---

## API

### GET /api/transactions

- Add `check_number` to the SELECT columns.
- Add `check_number: string | null` to the server-side row type used in the query result.

### POST /api/transactions (manual entry)

- Accept optional `check_number` in the request body (string or null).
- Pass it through to the INSERT. If the client omits the field or sends an empty string, store `null`.

---

## Client

### Transaction interface (`Register.tsx`)

Add `check_number: string | null` to the `Transaction` interface.

### ManualEntryForm

- Add `checkNumber` state: `useState<string>('')`.
- Add an optional **Check #** text input directly below the Payee field. Label: `Check #`. Placeholder: `Optional`.
- On submit, include `check_number: checkNumber.trim() || null` in the POST body.
- No validation — check numbers are free-form text (some banks use alphanumeric values).

### Register display

In both the desktop table and mobile card views, the payee cell gains a dimmed secondary label when `tx.check_number` is non-null:

```
Electric Company · Check #1247
```

Implementation: after the payee text, render a `<span>` styled `text-gray-400 text-xs ml-1` containing `· Check #${tx.check_number}`. No new columns, no layout changes.

---

## Tests

- Update existing transaction test fixtures to include `check_number: null` (or a value where appropriate) so existing tests continue to pass without type errors.
- Add tests in `transactions.test.ts`:
  - `POST /api/transactions` with `check_number` stores and returns it.
  - `POST /api/transactions` without `check_number` stores `null`.
  - `GET /api/transactions` returns `check_number` on each transaction row.
- Add a test in `plaid.test.ts` verifying that Plaid sync captures `check_number` from the incoming transaction object and stores it on the transaction row.
- Schema migration test: verify that `check_number` column is present after `initSchema()` runs (covers both fresh install and migration path).
