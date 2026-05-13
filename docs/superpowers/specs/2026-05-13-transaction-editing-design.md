# Phase 1e — Full Transaction Editing

## Overview

Allow editing `date`, `payee`, `amount`, and `check_number` on any transaction (synced or manual) after it has been saved. Editing is triggered by a pencil icon on each register row/card; the row transforms inline with editable fields. Splits editing remains separate via the existing expansion panel.

**Out of scope:** Editing `account_id` (moving a transaction between accounts), editing splits inline with core fields, bulk editing.

---

## API

### PATCH /api/transactions/:id

New endpoint. Accepts `{ date, payee, amount, check_number }`.

**Validation:**
- `date`, `payee`, and `amount` are required; return 400 if missing.
- The transaction must exist and not be soft-deleted; return 404 otherwise.
- The transaction's current splits must sum to `amount` within 0.001 tolerance. If not, return 400 with `{ error: 'Split amounts must sum to transaction amount' }`. This prevents saving an amount that leaves splits inconsistent.

**On success:**
- Updates the four fields on the transaction row.
- Returns `{ id }`.
- Does not recalculate running balance on the server — running balance is computed fresh on every GET.

**No restriction on `is_manual`:** Plaid-synced transactions are editable. The cursor-based sync means Plaid only re-sends a transaction if Plaid itself modifies it; the overwrite risk is low and acceptable for a household app.

---

## Client Architecture

### New file: `client/src/TransactionEditor.tsx`

`Register.tsx` is already ~665 lines. Following the pattern established by `CategoryPicker` and `CategoryPanel`, the editor is extracted as a separate component.

**Props:**
```typescript
interface TransactionEditorProps {
  tx: Transaction        // current transaction (for initial field values + split sum validation)
  onSaved: () => void    // called after successful PATCH; parent reloads transactions
  onCancel: () => void   // called on cancel; no API call
}
```

**Responsibilities:**
- Owns `date`, `payee`, `amount`, `checkNumber` state, initialized from `tx`
- Computes `splitSum` from `tx.splits` and compares to `parsedAmount`
- Shows `Remaining: +$X.XX` warning (same visual pattern as `ManualEntryForm`) if splits don't match
- Disables Save button when remainder ≠ 0
- Calls `PATCH /api/transactions/:id` on Save
- Shows inline error on failure, stays in edit mode

### Changes to `Register.tsx`

- Add `editingTxId: number | null` state (mirrors `expandedTxId`)
- Opening edit mode (`setEditingTxId(tx.id)`) clears `expandedTxId` if set, and vice versa — the two panels cannot both be open for the same transaction
- Add pencil icon (✎) to each desktop table row (visible on hover) and each mobile card (always visible)
- When `editingTxId === tx.id`, render `<TransactionEditor>` in the expansion row below the transaction row (same `<Fragment key={tx.id}>` mechanism as `SplitEditor`):
  - **Desktop:** a `<tr><td colSpan={7}>` expansion row containing the editor form
  - **Mobile:** renders `<TransactionEditor>` inside the card below the header area
- The desktop table header gains a 7th blank `<th>` for the pencil column; all `colSpan` references update from 6 to 7

---

## Interaction Flow

1. User clicks pencil icon → `setEditingTxId(tx.id)`, `setExpandedTxId(null)`
2. Row/card transforms: `TransactionEditor` renders with current field values
3. User edits fields; remainder warning appears if splits no longer sum to amount
4. **Save (enabled only when remainder = 0):** `PATCH /api/transactions/:id` → on success, `onSaved()` → `loadTransactions()` + `setEditingTxId(null)`
5. **Cancel:** `setEditingTxId(null)`, no API call, row snaps back to display mode
6. On API error: inline error message, stay in edit mode

---

## Tests

New tests in `server/src/__tests__/transactions.test.ts`:

- `PATCH /api/transactions/:id` updates date, payee, amount, and check_number
- Returns 400 when splits don't sum to the new amount
- Returns 404 for a non-existent or removed transaction
- Plaid-synced transactions (`is_manual = 0`) are editable

---

## Display Details

**Desktop pencil icon:** `✎` character in a small button, rendered in a 7th column to the right of the cleared toggle. The `<tr>` gets a `group` class; the button is `opacity-0 group-hover:opacity-100` so it only appears on hover. In edit mode the button is hidden (the editor row below takes over).

**Mobile pencil icon:** Always visible as a small button in the card header row alongside the amount and cleared toggle.

**Remainder warning:** `Remaining: +$X.XX` or `Remaining: -$X.XX` in amber/red text, same styling as `ManualEntryForm`. Appears below the amount input when `Math.abs(remainder) > 0.001`.
