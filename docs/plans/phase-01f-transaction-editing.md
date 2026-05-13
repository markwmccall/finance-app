# Phase 1f — Full Transaction Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow editing `date`, `payee`, `amount`, and `check_number` on any transaction via an inline pencil-icon editor that opens below the row.

**Architecture:** Three changes in sequence: (1) a new `PATCH /api/transactions/:id` server endpoint validates and persists field updates; (2) a new `TransactionEditor.tsx` React component owns the edit form, remainder warning, and PATCH call; (3) `Register.tsx` gains `editingTxId` state, pencil icons, and renders the editor in an expansion row below the target transaction.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Node 24, Express, better-sqlite3, Jest + supertest

---

## Branch

```bash
git checkout -b phase/01f-transaction-editing
```

---

## File Map

| File | Change |
|------|--------|
| `server/src/routes/transactions.ts` | Add `PATCH /:id` route |
| `server/src/__tests__/transactions.test.ts` | Add 6 tests for `PATCH /:id` |
| `client/src/TransactionEditor.tsx` | Create new component (inline edit form) |
| `client/src/Register.tsx` | Import TransactionEditor; add `editingTxId` state; add pencil icons; update table header (7th column); update `colSpan` 6 → 7; render editor in expansion rows |

---

## Task 1: PATCH /api/transactions/:id Server Endpoint

**Files:**
- Modify: `server/src/__tests__/transactions.test.ts`
- Modify: `server/src/routes/transactions.ts`

- [ ] **Step 1: Add `updateSplitAmount` helper to the test file**

In `server/src/__tests__/transactions.test.ts`, after the existing `getCategoryId` helper (around line 24), add:

```typescript
function updateSplitAmount(txId: number, newAmount: number) {
  getDb().prepare(
    'UPDATE transaction_splits SET amount = ? WHERE transaction_id = ?'
  ).run(newAmount, txId)
}
```

- [ ] **Step 2: Write the failing tests**

At the end of `server/src/__tests__/transactions.test.ts`, add:

```typescript
describe('PATCH /api/transactions/:id', () => {
  function getTx() {
    return getDb().prepare(
      'SELECT id, amount FROM transactions WHERE is_removed = 0 LIMIT 1'
    ).get() as { id: number; amount: number }
  }

  test('updates date, payee, amount, and check_number', async () => {
    const tx = getTx()
    const catId = getCategoryId('Groceries')
    addSplit(tx.id, catId, tx.amount)
    const newAmount = parseFloat((tx.amount - 10).toFixed(2))
    updateSplitAmount(tx.id, newAmount)

    const res = await request(app).patch(`/api/transactions/${tx.id}`).send({
      date: '2026-01-15',
      payee: 'Updated Payee',
      amount: newAmount,
      check_number: '9999',
    })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(tx.id)

    const updated = getDb().prepare(
      'SELECT date, payee, amount, check_number FROM transactions WHERE id = ?'
    ).get(tx.id) as { date: string; payee: string; amount: number; check_number: string | null }
    expect(updated.date).toBe('2026-01-15')
    expect(updated.payee).toBe('Updated Payee')
    expect(updated.amount).toBeCloseTo(newAmount, 2)
    expect(updated.check_number).toBe('9999')
  })

  test('returns 400 when splits do not sum to new amount', async () => {
    const tx = getTx()
    const catId = getCategoryId('Groceries')
    addSplit(tx.id, catId, tx.amount)

    const res = await request(app).patch(`/api/transactions/${tx.id}`).send({
      date: '2026-01-15',
      payee: 'Test',
      amount: tx.amount + 100,
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Split amounts must sum to transaction amount')
  })

  test('returns 404 for non-existent transaction', async () => {
    const res = await request(app).patch('/api/transactions/99999').send({
      date: '2026-01-15',
      payee: 'Ghost',
      amount: -50,
    })
    expect(res.status).toBe(404)
  })

  test('returns 404 for soft-deleted transaction', async () => {
    const tx = getTx()
    getDb().prepare('UPDATE transactions SET is_removed = 1 WHERE id = ?').run(tx.id)

    const res = await request(app).patch(`/api/transactions/${tx.id}`).send({
      date: '2026-01-15',
      payee: 'Test',
      amount: tx.amount,
    })
    expect(res.status).toBe(404)
  })

  test('Plaid-synced transactions (is_manual=0) are editable', async () => {
    const tx = getTx()
    const catId = getCategoryId('Groceries')
    addSplit(tx.id, catId, tx.amount)
    getDb().prepare('UPDATE transactions SET is_manual = 0 WHERE id = ?').run(tx.id)

    const res = await request(app).patch(`/api/transactions/${tx.id}`).send({
      date: '2026-01-15',
      payee: 'Plaid Payee Updated',
      amount: tx.amount,
    })
    expect(res.status).toBe(200)
  })

  test('returns 400 when required fields are missing', async () => {
    const tx = getTx()
    const res = await request(app).patch(`/api/transactions/${tx.id}`).send({
      payee: 'Missing date and amount',
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
cd /Users/markmccall/finance-app/server && npx jest --no-coverage --testPathPattern="transactions" 2>&1 | tail -20
```

Expected: 6 new tests fail with "Cannot PATCH" or 404 (route not yet registered).

- [ ] **Step 4: Implement the PATCH /:id route**

In `server/src/routes/transactions.ts`, add the following after the existing `PATCH /:id/cleared` route and before the `PUT /:id/splits` route:

```typescript
transactionsRouter.patch('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const id = Number(req.params.id)
    const { date, payee, amount, check_number } = req.body as {
      date?: string
      payee?: string
      amount?: number
      check_number?: string | null
    }

    if (!date || !payee || amount === undefined || amount === null) {
      res.status(400).json({ error: 'date, payee, and amount are required' })
      return
    }

    const tx = db.prepare(
      'SELECT id FROM transactions WHERE id = ? AND is_removed = 0'
    ).get(id) as { id: number } | undefined
    if (!tx) {
      res.status(404).json({ error: 'Transaction not found' })
      return
    }

    const splitRow = db.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM transaction_splits WHERE transaction_id = ?'
    ).get(id) as { total: number }
    if (Math.abs(splitRow.total - amount) > 0.001) {
      res.status(400).json({ error: 'Split amounts must sum to transaction amount' })
      return
    }

    db.prepare(
      'UPDATE transactions SET date = ?, payee = ?, amount = ?, check_number = ? WHERE id = ?'
    ).run(date, payee.trim(), amount, check_number?.trim() || null, id)

    res.json({ id })
  } catch (err) {
    console.error('PATCH /api/transactions/:id error:', err)
    res.status(500).json({ error: 'Failed to update transaction' })
  }
})
```

- [ ] **Step 5: Run the new tests to verify they pass**

```bash
cd /Users/markmccall/finance-app/server && npx jest --no-coverage --testPathPattern="transactions" 2>&1 | tail -20
```

Expected: All 6 new tests pass.

- [ ] **Step 6: Run the full test suite**

```bash
cd /Users/markmccall/finance-app/server && npx jest --no-coverage 2>&1 | tail -10
```

Expected: 98 passed (92 + 6 new).

- [ ] **Step 7: Commit**

```bash
git add server/src/__tests__/transactions.test.ts server/src/routes/transactions.ts
git commit -m "feat: add PATCH /api/transactions/:id endpoint for field editing"
```

---

## Task 2: TransactionEditor Component

**Files:**
- Create: `client/src/TransactionEditor.tsx`

- [ ] **Step 1: Create the file**

Create `client/src/TransactionEditor.tsx` with the following complete content:

```typescript
import { useState } from 'react'

interface Split {
  amount: number
}

interface TransactionForEditor {
  id: number
  date: string
  payee: string
  amount: number
  check_number: string | null
  splits: Split[]
}

interface TransactionEditorProps {
  tx: TransactionForEditor
  onSaved: () => void
  onCancel: () => void
}

export default function TransactionEditor({ tx, onSaved, onCancel }: TransactionEditorProps) {
  const [date, setDate] = useState(tx.date)
  const [payee, setPayee] = useState(tx.payee)
  const [amount, setAmount] = useState(tx.amount.toFixed(2))
  const [checkNumber, setCheckNumber] = useState(tx.check_number ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const parsedAmount = parseFloat(amount) || 0
  const splitSum = tx.splits.reduce((s, sp) => s + sp.amount, 0)
  const remainder = parseFloat((parsedAmount - splitSum).toFixed(2))

  async function save() {
    if (Math.abs(remainder) > 0.001) return
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`/api/transactions/${tx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          payee: payee.trim(),
          amount: parsedAmount,
          check_number: checkNumber.trim() || null,
        }),
      })
      if (!r.ok) {
        const body = await r.json()
        setError(body.error ?? 'Save failed')
      } else {
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 p-3 bg-gray-50 rounded border text-sm">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Payee</label>
          <input
            type="text"
            value={payee}
            onChange={e => setPayee(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Amount (– for expense)</label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Check #</label>
          <input
            type="text"
            value={checkNumber}
            onChange={e => setCheckNumber(e.target.value)}
            placeholder="Optional"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
      </div>
      {Math.abs(remainder) > 0.001 && (
        <div className={`text-xs font-mono mb-2 ${remainder < 0 ? 'text-red-500' : 'text-amber-600'}`}>
          Remaining: {remainder > 0 ? '+' : ''}{remainder.toFixed(2)} — update splits before changing amount
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-sm px-3 py-1 border rounded text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || Math.abs(remainder) > 0.001}
          className="text-sm px-3 py-1 bg-indigo-600 text-white rounded disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  )
}
```

Note: `TransactionForEditor.splits` requires only `{ amount: number }`. When Register.tsx passes the full `Transaction` object (whose `splits` field has more fields), TypeScript's structural typing accepts it — no type cast needed.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/markmccall/finance-app/client && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add client/src/TransactionEditor.tsx
git commit -m "feat: add TransactionEditor component for inline field editing"
```

---

## Task 3: Wire TransactionEditor into Register.tsx

**Files:**
- Modify: `client/src/Register.tsx`

- [ ] **Step 1: Add import**

At the top of `client/src/Register.tsx`, add the TransactionEditor import so the block reads:

```typescript
import { useEffect, useState, useCallback, Fragment } from 'react'
import CategoryPicker from './CategoryPicker'
import CategoryPanel from './CategoryPanel'
import TransactionEditor from './TransactionEditor'
```

- [ ] **Step 2: Add `editingTxId` state**

Inside the `Register` function body, after `const [expandedTxId, setExpandedTxId] = useState<number | null>(null)`, add:

```typescript
  const [editingTxId, setEditingTxId] = useState<number | null>(null)
```

- [ ] **Step 3: Update desktop table header — add 7th column**

Find and replace the `<thead>` row (6 `<th>` elements):

```tsx
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Payee</th>
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium text-right">Amount</th>
              <th className="py-2 pr-4 font-medium text-right">Balance</th>
              <th className="py-2 font-medium text-center">Cleared</th>
            </tr>
```

Replace with:

```tsx
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Payee</th>
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium text-right">Amount</th>
              <th className="py-2 pr-4 font-medium text-right">Balance</th>
              <th className="py-2 font-medium text-center">Cleared</th>
              <th className="py-2 w-8"></th>
            </tr>
```

- [ ] **Step 4: Update `colSpan={6}` → `colSpan={7}` in the desktop table**

There are exactly 3 occurrences of `colSpan={6}` in the desktop table section:
1. The loading row: `<tr><td colSpan={6} className="py-8 text-center text-gray-400 text-sm">Loading…</td></tr>`
2. The empty state row: `<tr><td colSpan={6} className="py-8 text-center text-gray-400 text-sm">No transactions match these filters.</td></tr>`
3. The SplitEditor expansion row: `<td colSpan={6} className="px-4 pb-3">`

Change all three to `colSpan={7}`.

- [ ] **Step 5: Add `group` class and pencil button to the desktop transaction row**

Find the desktop transaction `<tr>`:

```tsx
                <tr className="border-b hover:bg-gray-50">
```

Replace with:

```tsx
                <tr className="border-b hover:bg-gray-50 group">
```

Then find the Cleared `<td>` (the last `<td>` in the transaction row, containing the cleared toggle button):

```tsx
                  <td className="py-2 text-center">
                    <button
                      onClick={() => toggleCleared(tx)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto ${tx.is_cleared ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}
                      title={tx.is_cleared ? 'Mark uncleared' : 'Mark cleared'}
                    >
                      {tx.is_cleared ? '✓' : ''}
                    </button>
                  </td>
```

Replace with (the cleared td unchanged, new pencil td added immediately after):

```tsx
                  <td className="py-2 text-center">
                    <button
                      onClick={() => toggleCleared(tx)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto ${tx.is_cleared ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}
                      title={tx.is_cleared ? 'Mark uncleared' : 'Mark cleared'}
                    >
                      {tx.is_cleared ? '✓' : ''}
                    </button>
                  </td>
                  <td className="py-2 text-center">
                    {editingTxId !== tx.id && (
                      <button
                        onClick={() => { setEditingTxId(tx.id); setExpandedTxId(null) }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 text-sm px-1"
                        title="Edit transaction"
                      >
                        ✎
                      </button>
                    )}
                  </td>
```

- [ ] **Step 6: Update the category cell click to clear `editingTxId`**

Find the desktop category `<td>`:

```tsx
                  <td
                    className="py-2 pr-4 text-gray-600 cursor-pointer hover:text-indigo-600"
                    onClick={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
                  >
```

Replace with:

```tsx
                  <td
                    className="py-2 pr-4 text-gray-600 cursor-pointer hover:text-indigo-600"
                    onClick={() => { setExpandedTxId(prev => prev === tx.id ? null : tx.id); setEditingTxId(null) }}
                  >
```

- [ ] **Step 7: Add TransactionEditor expansion row for desktop**

After the existing SplitEditor expansion row (inside `<Fragment key={tx.id}>`), add the editor expansion row:

```tsx
                {editingTxId === tx.id && (
                  <tr>
                    <td colSpan={7} className="px-4 pb-3">
                      <TransactionEditor
                        tx={tx}
                        onSaved={() => { loadTransactions(); setEditingTxId(null) }}
                        onCancel={() => setEditingTxId(null)}
                      />
                    </td>
                  </tr>
                )}
```

The Fragment for each transaction should end up with this structure:

```tsx
              <Fragment key={tx.id}>
                <tr className="border-b hover:bg-gray-50 group">
                  {/* ... all 7 tds ... */}
                </tr>
                {expandedTxId === tx.id && (
                  <tr>
                    <td colSpan={7} className="px-4 pb-3">
                      <SplitEditor ... />
                    </td>
                  </tr>
                )}
                {editingTxId === tx.id && (
                  <tr>
                    <td colSpan={7} className="px-4 pb-3">
                      <TransactionEditor ... />
                    </td>
                  </tr>
                )}
              </Fragment>
```

- [ ] **Step 8: Add pencil button to mobile card header**

Find the mobile card's amount+cleared column (the `<div className="flex flex-col items-end gap-2">`). The cleared button is the last item inside it. After the cleared `<button>`, add the pencil button:

```tsx
              <div className="flex flex-col items-end gap-2">
                <span className={`font-mono text-sm ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmtAmount(tx.amount)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); toggleCleared(tx) }}
                  className={`w-6 h-6 rounded border-2 flex items-center justify-center ${tx.is_cleared ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}
                >
                  {tx.is_cleared ? '✓' : ''}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setEditingTxId(prev => prev === tx.id ? null : tx.id); setExpandedTxId(null) }}
                  className="text-gray-400 hover:text-indigo-600 text-sm px-1"
                  title="Edit transaction"
                >
                  ✎
                </button>
              </div>
```

- [ ] **Step 9: Update mobile card click to clear `editingTxId`**

Find the mobile card's main clickable div:

```tsx
            <div
              className="p-3 flex items-start gap-3 cursor-pointer"
              onClick={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
            >
```

Replace with:

```tsx
            <div
              className="p-3 flex items-start gap-3 cursor-pointer"
              onClick={() => { setExpandedTxId(prev => prev === tx.id ? null : tx.id); setEditingTxId(null) }}
            >
```

- [ ] **Step 10: Add TransactionEditor expansion section to mobile card**

After the existing SplitEditor expansion section (inside `<div key={tx.id} className="bg-white rounded border">`), add:

```tsx
            {editingTxId === tx.id && (
              <div className="px-3 pb-3 border-t">
                <TransactionEditor
                  tx={tx}
                  onSaved={() => { loadTransactions(); setEditingTxId(null) }}
                  onCancel={() => setEditingTxId(null)}
                />
              </div>
            )}
```

- [ ] **Step 11: Verify TypeScript compiles**

```bash
cd /Users/markmccall/finance-app/client && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 12: Run server tests**

```bash
cd /Users/markmccall/finance-app/server && npx jest --no-coverage 2>&1 | tail -10
```

Expected: 98/98 passing.

- [ ] **Step 13: Commit**

```bash
git add client/src/Register.tsx
git commit -m "feat: wire TransactionEditor into Register with pencil-icon inline editing"
```

---

## Done

Push and open a PR to merge `phase/01f-transaction-editing` into `main`.

```bash
git push -u origin phase/01f-transaction-editing
gh pr create --title "Phase 1f: Full transaction editing" --body "$(cat <<'EOF'
## Summary
- Adds PATCH /api/transactions/:id to update date, payee, amount, and check_number
- Validates that existing splits still sum to new amount (prevents split inconsistency)
- New TransactionEditor component renders inline below the transaction row
- Pencil icon (✎) in desktop table column (hover-visible) and mobile cards (always visible)
- Plaid-synced transactions are editable
- Cancel returns to read mode with no API call
- loadTransactions() called on save — re-sort by date is automatic

## Test Plan
- [ ] Run \`npm test\` in \`server/\` — 98 tests pass
- [ ] Click pencil icon on a transaction — edit form appears below row
- [ ] Edit payee and date, click Save — row updates, form closes, register re-sorts if date changed
- [ ] Edit amount to mismatch splits — Remaining warning appears, Save is disabled
- [ ] Click Cancel — form closes with no change
- [ ] Pencil on desktop: hover-only; on mobile: always visible
- [ ] Both edit and split panels cannot be open simultaneously for the same row
EOF
)"
```
