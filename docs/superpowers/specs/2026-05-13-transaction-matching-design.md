# Phase 1g — Transaction Matching (Manual → Plaid Deduplication)

## Overview

When a manually-entered transaction and the same real-world transaction arrive via Plaid sync, two records exist. This phase detects potential duplicates at sync time, parks them in a persistent review queue, and provides a UI for Laurie to merge, accept, or discard each one.

**Primary user:** Laurie (non-technical). The UI must be clear and self-explanatory.

**Out of scope:** Retroactive matching of already-synced transactions; bulk merge across accounts in one action; editing transaction fields during review (use existing TransactionEditor for that after accepting).

---

## Matching Logic

Runs on the server during sync, before any transaction is inserted.

### Primary key: `check_number` (exact match)
- If the incoming Plaid transaction has a `check_number` and an existing manual transaction on the same account has the same `check_number` → **auto-matched** (high confidence, no user review required).
- Payee similarity is not required for check_number matches.

### Fallback key: amount + date + payee similarity
- Exact amount match (within 0.001) AND date within ±1 calendar day AND payee similarity ≥ 0.5 → **needs review** (user decides).
- Only considers manual transactions (`is_manual = 1`) that do not already have a `plaid_transaction_id`.
- If multiple candidates pass the threshold, pick the one with the highest similarity score.
- `match_confidence` (0–1) is stored on the queue row and shown in the UI as a hint.

### Payee normalization
Both payee strings are normalized before comparison:
1. Lowercase
2. Strip trailing merchant codes: `#0412`, `* `, `*`, ` - `, check numbers (`check #1042`, `chk 1042`)
3. Strip common noise suffixes: card-present markers, store numbers (any sequence of digits ≥ 3 at the end)
4. Collapse multiple spaces; trim

Examples: `"KROGER #0412"` → `"kroger"`, `"AT&T *DIRECT"` → `"at&t"`, `"Target Run"` → `"target run"`.

### Payee similarity algorithm
Uses **Jaro-Winkler** on the normalized strings (via the `jaro-winkler` npm package on the server — pure JS, no native dependencies). Jaro-Winkler is well-suited for short strings and gives bonus weight to matching prefixes, which handles common patterns like `"at&t"` vs `"at&t bill pay"`.

Threshold summary:
| Score | Meaning | Outcome |
|---|---|---|
| ≥ 0.92 | Very likely same payee | `needs_review`, shown as "strong match" |
| 0.70 – 0.91 | Probably same payee | `needs_review`, shown as "likely match" |
| 0.50 – 0.69 | Possible same payee | `needs_review`, shown as "possible match" |
| < 0.50 | Unlikely same payee | Not matched; treated as `new` |

The `MATCH_CONFIDENCE_THRESHOLD` constant (default `0.50`) is defined in the matching module so it can be tuned without touching logic.

### No match
- No candidate passes amount + date + payee threshold → **new** (will be added to register on acceptance).

---

## Database

### New table: `sync_review_queue`

```sql
CREATE TABLE IF NOT EXISTS sync_review_queue (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id           INTEGER NOT NULL REFERENCES accounts(id),
  plaid_transaction_id TEXT    NOT NULL UNIQUE,
  plaid_date           TEXT    NOT NULL,
  plaid_payee          TEXT    NOT NULL,
  plaid_amount         REAL    NOT NULL,
  plaid_check_number   TEXT,
  match_transaction_id INTEGER REFERENCES transactions(id),
  match_reason         TEXT,
  match_confidence     REAL,
  status               TEXT    NOT NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

- `status`: `'auto_matched'` | `'needs_review'` | `'new'`
- `match_reason`: `'check_number'` | `'amount_date_payee'` | NULL (for `'new'` rows)
- `match_confidence`: Jaro-Winkler score (0–1) for `'amount_date_payee'` matches; NULL for `'check_number'` and `'new'` rows
- `plaid_transaction_id` is UNIQUE — re-syncing the same Plaid transaction is a no-op (the existing queue row is left untouched).

### Modified sync behavior

Currently `POST /api/plaid/sync` iterates institutions sequentially with `for...of` and upserts Plaid transactions directly into `transactions`. After this change:

**Parallelism:** The loop is replaced with `Promise.allSettled()` — all institutions start syncing simultaneously. Each institution (Plaid Item) is independent: separate `access_token`, separate `cursor`, separate accounts. One failing institution does not abort the others. `Promise.allSettled()` (not `Promise.all()`) preserves this per-item error isolation. Cursor pagination within each item remains sequential, since each page depends on the previous cursor.

**Queue instead of direct insert:** For each incoming Plaid transaction:

1. Run matching logic against `transactions` (manual only, `is_manual = 1`, no `plaid_transaction_id`, not `is_removed`) for the same account.
2. Insert a row into `sync_review_queue` with the appropriate `status`. Use `INSERT OR IGNORE` — re-syncing the same `plaid_transaction_id` is a no-op; the existing queue row is preserved.
3. Do **not** insert into `transactions` at this point. The transaction lands in the register only when the user accepts it.

Matching queries filter by `account_id`, so parallel item processing carries no race risk.

Transactions already in `transactions` with a matching `plaid_transaction_id` (from before this phase shipped) are left alone and not re-queued.

---

## API

### `GET /api/sync/queue`
Returns all rows grouped by account. Used by the dashboard widget and the review banner.

**Response:**
```json
{
  "accounts": [
    {
      "account_id": 1,
      "account_name": "Truist Checking",
      "auto_matched": [ { "id": 1, "plaid_payee": "AT&T", "plaid_date": "2026-05-11", "plaid_amount": -125.00, "match_transaction_id": 42, "match_payee": "AT&T Bill Pay", "match_date": "2026-05-10", "match_reason": "check_number" } ],
      "needs_review": [ { "id": 2, "plaid_payee": "Target", "plaid_date": "2026-05-08", "plaid_amount": -43.22, "match_transaction_id": 37, "match_payee": "Target Run", "match_date": "2026-05-07", "match_reason": "amount_date_payee", "match_confidence": 0.91 } ],
      "new": [ { "id": 3, "plaid_payee": "Whole Foods", "plaid_date": "2026-05-11", "plaid_amount": -84.12 } ]
    }
  ],
  "total_pending": 3
}
```

Only accounts with at least one queue row are included.

### Atomicity
Every endpoint that touches more than one table wraps its work in a `better-sqlite3` synchronous transaction (`db.transaction(...)()`). This covers `accept` (both merge and insert-new paths), `merge-with`, and `accept-all`. `reject` and `undo-match` are single-statement and inherently atomic.

If a transaction fails, the database rolls back completely — no partial state where a queue row is gone but the transaction was not updated, or vice versa.

### `POST /api/sync/queue/:id/accept`
Accepts a queue item. Optional body: `{ force_new: true }`.

- **auto_matched / needs_review** (without `force_new`): Copies `plaid_transaction_id` and `plaid_check_number` onto the `match_transaction_id` transaction; sets `is_cleared = 1` on that transaction. Removes queue row.
- **new**, or any status with `force_new: true` ("Add as new" action): Inserts a new row into `transactions` with `account_id`, `plaid_transaction_id`, `date = plaid_date`, `payee = plaid_payee`, `amount = plaid_amount`, `check_number = plaid_check_number`, `is_cleared = 1`, `is_manual = 0`, `is_removed = 0`. Removes queue row.
- Returns `{ ok: true }`.

### `POST /api/sync/queue/:id/reject`
Discards the Plaid transaction without adding it to the register. Removes queue row. Returns `{ ok: true }`.

### `POST /api/sync/queue/:id/undo-match`
Moves an `auto_matched` item back to `needs_review` so the user can review it manually. Sets `status = 'needs_review'` on the queue row. Returns `{ ok: true }`.

### `POST /api/sync/queue/:id/merge-with`
User-selected merge target. Body: `{ transaction_id: number }`.

- Same outcome as `accept` for a matched item, but uses the user-supplied `transaction_id` instead of `match_transaction_id`.
- Returns 400 if `transaction_id` is not found, is `is_removed`, or already has a `plaid_transaction_id`.
- Returns `{ ok: true }`.

### `POST /api/sync/queue/accept-all`
Accepts all `auto_matched` and `new` items for all accounts (or a single account if `{ account_id }` is supplied in the body). Does **not** touch `needs_review` items. Returns `{ accepted: N }`.

---

## UI — Sync Trigger & Progress

### Dashboard widget
A "Bank Sync" widget on the Dashboard shows:
- Last synced timestamp (from `MAX(last_synced_at)` across `plaid_items`)
- Pending review count badge (from `GET /api/sync/queue` total_pending)
- "Sync now" button

Clicking "Sync now" navigates to the Accounts page and starts a sync.

### Accounts page
A "Sync all accounts" button at the top of the Accounts page triggers sync. Because institutions sync in parallel, all rows start animating simultaneously.

**Progress display per institution (not per account):** Plaid's API is one request-set per institution (Item), not per account. Truist Checking and Truist Savings are both under the Truist Item — they finish at the same time. Progress rows are grouped by institution, with their accounts listed underneath.

**No percentage bar** — Plaid does not report total pages in advance, so a 0–100% bar would be fabricated. Instead each institution row shows an **indeterminate animated bar** (CSS animation, no percentage) with a status label that updates through real state transitions:

| State | Bar | Label |
|---|---|---|
| Not started | none | `waiting…` |
| Fetching balances | scrolling | `Fetching balances…` |
| Fetching transactions, page 1 | scrolling | `Fetching transactions…` |
| Fetching transactions, page N>1 | scrolling | `Fetching transactions (page N)…` |
| Writing to queue | scrolling | `Processing…` |
| Done | solid/filled | `Done — 9 new · 1 review needed` |
| Error | red | `Error — RATE_LIMIT_EXCEEDED ▸ details` |
| Needs re-auth | yellow | `Re-auth required` |

Clicking "▸ details" on an error row expands an inline detail panel showing:
- **Error code:** `RATE_LIMIT_EXCEEDED`
- **Message:** `Too many requests in a short period.`
- **Plaid request ID:** `abc123xyz` *(for Plaid support)*

The request ID is displayed in a monospace copyable field so Mark can provide it to Plaid support if needed. A "Retry" button re-triggers sync for that institution only.

Accounts that finish early show a "Review →" button immediately — Laurie doesn't need to wait for all institutions.

If no accounts are connected, the button is disabled.

---

## UI — Review Banner

### When it appears
On the Register page: if `GET /api/sync/queue` returns rows for the currently-selected account, a review banner renders above the transaction list. The banner persists across page reloads until the queue for that account is empty.

### Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ [amber header] Truist Checking — 1 needs review · 9 new  [Accept all & close]
├─── ✓ 2 auto-matched ──────────────────────────────── ▸ show ───┤  (collapsed, green)
├─── ⚡ 1 needs review ──────────────────────────────────────────┤  (expanded, amber)
│    [match card with Merge / Add as new / Merge with… / Delete]  │
├─── 9 new transactions — will be added ────────────── ▸ show ───┤  (collapsed, gray)
└─────────────────────────────────────────────────────────────────┘
```

**Auto-matched section** (green, collapsed by default):
- Expand to see each pair (manual row ↔ Plaid row, match reason shown).
- Each pair has an "undo" link that calls `undo-match`, moving it to `needs_review`.
- "Accept all" button accepts the whole section.

**Needs review section** (amber, expanded by default):
- Each item shows a side-by-side card: Plaid transaction on left, manual candidate on right, match reason as a label (e.g., "same amount, ±1 day").
- Actions: **✓ Merge** (calls `accept`), **Add as new** (calls `accept` with `force_new: true`), **Merge with…** (see below), **Delete** (calls `reject`).

**New transactions section** (gray, collapsed by default):
- Expand to see the list. Each row has a "✕ remove" to reject that one transaction.
- "Accept all & close" button in the banner header calls `accept-all` for the account, then closes the banner.

### "Merge with…" interaction
When the user clicks "Merge with…" on a needs-review item:
1. The banner stays fully open but the match card enters an **awaiting** state (shows "Scroll down and tap the transaction to merge with").
2. Every register row below the banner gains a visible **"↑ merge"** button.
3. Tapping a register row calls `POST /api/sync/queue/:id/merge-with` with that row's `transaction_id`.
4. A "Cancel" link in the awaiting card exits pick mode without any action.

Only one item can be in "awaiting" state at a time.

### Closing the banner
- Clicking ✕ collapses the banner — the queue is unchanged. The banner reopens next visit.
- "Accept all & close" processes all `auto_matched` and `new` items, then closes.
- When the queue for the account reaches zero items, the banner auto-dismisses.

---

## Component Architecture

### New files
- `client/src/SyncBanner.tsx` — review banner component. Receives queue data for one account as props; emits `onQueueEmpty` callback when all items are processed.
- `client/src/SyncWidget.tsx` — dashboard sync widget. Fetches queue summary; shows last-synced time, pending badge, and "Sync now" button.

### Sync progress streaming

The current `POST /api/plaid/sync` returns a single response after all institutions complete. To drive the live status labels on the Accounts page, the endpoint is changed to use **Server-Sent Events (SSE)**:

- Client opens `POST /api/plaid/sync` with `Accept: text/event-stream`
- Server emits one `data:` event per institution state change as it occurs:
  ```
  data: {"item_id": 1, "state": "fetching_balances"}
  data: {"item_id": 1, "state": "fetching_transactions", "page": 1}
  data: {"item_id": 1, "state": "fetching_transactions", "page": 2}
  data: {"item_id": 1, "state": "processing"}
  data: {"item_id": 1, "state": "done", "added": 9, "needs_review": 1, "auto_matched": 2}
  data: {"item_id": 2, "state": "done", "added": 3, "needs_review": 0, "auto_matched": 0}
  data: {"item_id": 3, "state": "error", "error_code": "RATE_LIMIT_EXCEEDED", "error_message": "Too many requests in a short period.", "request_id": "abc123xyz"}
  data: {"item_id": 4, "state": "needs_reauth"}
  data: {"type": "complete"}
  ```
- `error_code`, `error_message`, and `request_id` are already captured in the existing sync error handler — they are currently logged to the console only. This spec threads them through to the client.
- `request_id` is a Plaid-generated identifier; Plaid support can look it up on their end to diagnose the exact failed API call.
- Client maps `item_id` to institution name and updates the row label in real time
- On `{"type": "complete"}`, the client fetches `GET /api/sync/queue` to load the review banner data

SSE is the right fit here: the server needs to push multiple events over time, the client is read-only during sync, and SSE is simpler than WebSockets for a one-way stream.

### New server dependency
`jaro-winkler` npm package (pure JS, no native deps — safe for Pi Zero 2 W).

### Modified files
- `server/src/schema.ts` — add `sync_review_queue` table definition; add `migrateSchema` entry for it.
- `server/src/routes/sync.ts` — modify sync handler to use queue logic; add new queue endpoints.
- `server/src/matching.ts` — new module: payee normalization, Jaro-Winkler scoring, match logic (extracted for testability).
- `client/src/Register.tsx` — fetch queue for current account on load; render `<SyncBanner>` above the transaction list when queue rows exist.
- `client/src/Dashboard.tsx` — render `<SyncWidget>`.
- `client/src/Accounts.tsx` — add "Sync all" button; show per-account sync progress.

---

## Error States

- Sync fails mid-run (network error, Plaid error): already-completed accounts remain in the queue; in-progress account shows an error state on the Accounts page. Retry is safe — `INSERT OR IGNORE` means no duplicates.
- `merge-with` target already has a `plaid_transaction_id`: return 400; banner shows inline error on the match card.
- Queue row disappears between render and action (e.g., accepted on another device/tab): return 404; banner refetches and updates.

---

## Testing

- Unit tests for payee normalization (strips merchant codes, digits, noise).
- Unit tests for matching logic: check_number exact; amount+date+payee above/below threshold; multiple candidates (picks highest confidence); no match.
- API tests: sync parks in queue; accept merges correctly; accept with `force_new` inserts new transaction; merge-with validates target; accept-all skips needs_review; reject removes row; undo-match demotes auto_matched to needs_review; re-sync of same plaid_transaction_id is idempotent.
- Queue endpoint returns correct grouping and counts.
