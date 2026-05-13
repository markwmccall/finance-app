# Phase 1e — Pagination Removal

## Overview

Replace the current page-based navigation in the Register with a continuous list. Load the 500 most recent transactions on first render. If older transactions exist, a button at the bottom appends them without scrolling the user away from their position.

This is a prerequisite for Phase 1f (transaction editing): without pagination, a date edit that re-sorts a transaction requires no "find the new page" logic — the transaction is simply in its correct position in the list.

---

## Behavior

### Initial load

Fetch the 500 most recent transactions (`limit=500, offset=0`). Display them as a continuous scrollable list. Remove all page navigation controls (prev/next buttons, page counter) from the UI.

### "Load older transactions" button

If `total > 500` (i.e., more transactions exist beyond the first 500), render a button at the bottom of the list:

> **Load [N] older transactions**

where N = `total - transactions.length`.

Clicking it fetches **only the remaining transactions** (`offset=transactions.length, limit=total-transactions.length`) and **appends** them to the existing list. The DOM above the button is unchanged, so the browser's scroll position is naturally preserved — the user stays exactly where they were as new items appear below.

### Filter changes

When the account or category filter changes, perform a fresh load (`offset=0, limit=500`) and **replace** (not append) the transaction list. This resets the "Load older" state as well.

### Running balance correctness

The server already computes running balances across the full dataset before slicing for pagination. The appended older transactions will have correct running balances because they are computed server-side from the complete transaction history. No client-side balance recalculation is needed.

---

## Server

No changes required. The existing `GET /api/transactions` endpoint already supports `limit` and `offset` query parameters. The only change is the client's default `limit` (50 → 500) and the introduction of the append fetch.

---

## Client Changes (`Register.tsx`)

### State changes

- **Remove:** `offset: number` state
- **Remove:** page navigation UI (prev/next buttons, page indicator)
- **Keep:** `total: number` state (used to determine whether the "Load older" button appears)
- **Keep:** `transactions` state (now appended to, not replaced, for the "Load older" action)

### `loadTransactions` changes

The function gains an optional `append` boolean parameter (default `false`):

- `append = false` (default): fetch `offset=0, limit=500`, replace `transactions` state. Used for initial load and filter changes.
- `append = true`: fetch `offset=transactions.length, limit=total-transactions.length`, concatenate results onto existing `transactions` state. Used only for the "Load older" button.

The AbortController pattern stays the same. `append=true` fetches do not reset `loading` state to avoid a flash — instead use a separate `loadingMore: boolean` state to show a spinner on the button.

### "Load older" button

Rendered below the last transaction row (desktop) and below the last mobile card. Only visible when `transactions.length < total`. Shows a spinner while `loadingMore` is true. Disabled while loading.

---

## Tests

No new server tests are needed — the API is unchanged. Existing 92 tests continue to pass.

### Testing the "Load older" button

The seed data inserts 10 transactions for the checking account. To test the append flow without needing 500 real transactions, extract the threshold as a named constant:

```typescript
const INITIAL_TX_LIMIT = 500
```

Set it to `5` during development. The Register will load the 5 most recent transactions and show "Load 5 older transactions." Verify the button appears, appends the remaining 5, and scroll position is preserved. **Restore to `500` before opening the PR.**

### Manual test checklist
- [ ] Register loads without page controls
- [ ] All transactions visible in a single scrollable list (for accounts with ≤ 500 transactions)
- [ ] Changing account or category filter resets the list correctly
- [ ] "Load older" button appears when `INITIAL_TX_LIMIT = 5` and seed data is present
- [ ] Clicking "Load older" appends remaining transactions without scrolling to top
- [ ] `INITIAL_TX_LIMIT` restored to `500` before PR
