# Phase 1d — Check Number Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `check_number` to the transactions table, capture it during Plaid sync, accept it in the manual entry form, and display it in the Register alongside the payee.

**Architecture:** SQLite runtime migration adds the column without data loss; the server routes are updated to read/write it; the React form gains an optional field and the payee cell gains a dimmed label. Four independent tasks, each committed separately.

**Tech Stack:** Node 24, better-sqlite3 v12, Express + TypeScript, React 18 + Vite + TypeScript + Tailwind, Jest + supertest

---

## Branch

Create and work on `phase/01d-check-number`. Never commit to `main` directly.

```bash
git checkout -b phase/01d-check-number
```

---

## File Map

| File | Change |
|------|--------|
| `server/src/schema.ts` | Add `check_number TEXT` to `CREATE TABLE`, export `migrateSchema()` |
| `server/src/index.ts` | Import and call `migrateSchema(db)` after `createTables(db)` |
| `server/src/routes/transactions.ts` | `TxRow` + `GET` SELECT + `POST` INSERT |
| `server/src/routes/plaid.ts` | `PlaidTx` type + `upsertTx` INSERT + `ON CONFLICT` |
| `client/src/Register.tsx` | `Transaction` interface + `ManualEntryForm` + payee display |
| `server/src/__tests__/schema.test.ts` | Migration tests |
| `server/src/__tests__/transactions.test.ts` | `check_number` GET + POST tests |
| `server/src/__tests__/plaid.test.ts` | Sync capture tests |

---

## Task 1: Schema Migration

**Files:**
- Modify: `server/src/schema.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these three tests to `server/src/__tests__/schema.test.ts`. The import line at the top already imports from `'../schema'` — add `migrateSchema` to that import:

```typescript
import { createTables, seedCategories, seedTestData, migrateSchema } from '../schema'
```

Then add the tests at the bottom of the file:

```typescript
test('transactions table has check_number column', () => {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(transactions)').all() as Array<{ name: string }>
  expect(cols.map(c => c.name)).toContain('check_number')
})

test('migrateSchema adds check_number when column is missing', () => {
  const db = getDb()
  // Simulate an old database that lacks check_number
  db.exec('DROP TABLE IF EXISTS transaction_splits')
  db.exec('DROP TABLE IF EXISTS transactions')
  db.exec(`
    CREATE TABLE transactions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id            INTEGER NOT NULL,
      plaid_transaction_id  TEXT    UNIQUE,
      date                  TEXT    NOT NULL,
      payee                 TEXT    NOT NULL,
      amount                REAL    NOT NULL,
      is_cleared            INTEGER NOT NULL DEFAULT 0,
      is_manual             INTEGER NOT NULL DEFAULT 0,
      is_removed            INTEGER NOT NULL DEFAULT 0
    )
  `)
  const before = db.prepare('PRAGMA table_info(transactions)').all() as Array<{ name: string }>
  expect(before.map(c => c.name)).not.toContain('check_number')

  migrateSchema(db)

  const after = db.prepare('PRAGMA table_info(transactions)').all() as Array<{ name: string }>
  expect(after.map(c => c.name)).toContain('check_number')
})

test('migrateSchema is idempotent — running twice does not error', () => {
  const db = getDb()
  expect(() => migrateSchema(db)).not.toThrow()
  expect(() => migrateSchema(db)).not.toThrow()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/markmccall/finance-app/server && npx jest schema.test.ts --no-coverage 2>&1 | tail -20
```

Expected: 3 new tests fail (migrateSchema not exported, check_number column missing).

- [ ] **Step 3: Add `check_number` to the CREATE TABLE definition**

In `server/src/schema.ts`, update the `CREATE TABLE IF NOT EXISTS transactions` block (lines 29–39). Add `check_number TEXT` after `amount`:

```typescript
    CREATE TABLE IF NOT EXISTS transactions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id            INTEGER NOT NULL REFERENCES accounts(id),
      plaid_transaction_id  TEXT    UNIQUE,
      date                  TEXT    NOT NULL,
      payee                 TEXT    NOT NULL,
      amount                REAL    NOT NULL,
      check_number          TEXT,
      is_cleared            INTEGER NOT NULL DEFAULT 0,
      is_manual             INTEGER NOT NULL DEFAULT 0,
      is_removed            INTEGER NOT NULL DEFAULT 0
    );
```

- [ ] **Step 4: Export `migrateSchema`**

Add this function at the end of `server/src/schema.ts`, after `seedTestData`:

```typescript
export function migrateSchema(db: Database.Database): void {
  const cols = db.prepare('PRAGMA table_info(transactions)').all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'check_number')) {
    db.exec('ALTER TABLE transactions ADD COLUMN check_number TEXT')
  }
}
```

- [ ] **Step 5: Call `migrateSchema` in `index.ts`**

In `server/src/index.ts`, update the import on line 7:

```typescript
import { createTables, seedCategories, seedTestData, migrateSchema } from './schema'
```

Then in the startup block (around line 41), add the call right after `createTables`:

```typescript
  const db = createDb()
  createTables(db)
  migrateSchema(db)
  seedCategories(db)
  seedTestData(db)
```

- [ ] **Step 6: Run all tests to verify they pass**

```bash
cd /Users/markmccall/finance-app/server && npx jest --no-coverage 2>&1 | tail -20
```

Expected: All tests pass. Total should be ≥ 87 (84 existing + 3 new).

- [ ] **Step 7: Commit**

```bash
git add server/src/schema.ts server/src/index.ts server/src/__tests__/schema.test.ts
git commit -m "feat: add check_number column via schema migration"
```

---

## Task 2: API — GET and POST check_number

**Files:**
- Modify: `server/src/routes/transactions.ts`
- Test: `server/src/__tests__/transactions.test.ts`

- [ ] **Step 1: Write the failing tests**

In `server/src/__tests__/transactions.test.ts`, add one test to the existing `describe('GET /api/transactions', ...)` block and two tests to the existing `describe('POST /api/transactions', ...)` block.

In the GET block, after the last existing test in that block:

```typescript
  test('each transaction row includes check_number field', async () => {
    const res = await request(app).get('/api/transactions?account_id=1')
    expect(res.status).toBe(200)
    const tx = res.body.transactions[0]
    expect('check_number' in tx).toBe(true)
    expect(tx.check_number).toBeNull()
  })
```

In the POST block, after the last existing test in that block:

```typescript
  test('stores check_number when provided', async () => {
    const catId = getCategoryId('Groceries')
    const res = await request(app).post('/api/transactions').send({
      account_id: 1,
      date: '2026-05-10',
      payee: 'AT&T',
      amount: -125.00,
      check_number: '1042',
      splits: [{ category_id: catId, amount: -125.00 }],
    })
    expect(res.status).toBe(201)
    const tx = getDb()
      .prepare('SELECT check_number FROM transactions WHERE id = ?')
      .get(res.body.id) as { check_number: string | null }
    expect(tx.check_number).toBe('1042')
  })

  test('stores null check_number when omitted', async () => {
    const catId = getCategoryId('Groceries')
    const res = await request(app).post('/api/transactions').send({
      account_id: 1,
      date: '2026-05-10',
      payee: 'Kroger',
      amount: -45.00,
      splits: [{ category_id: catId, amount: -45.00 }],
    })
    expect(res.status).toBe(201)
    const tx = getDb()
      .prepare('SELECT check_number FROM transactions WHERE id = ?')
      .get(res.body.id) as { check_number: string | null }
    expect(tx.check_number).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/markmccall/finance-app/server && npx jest transactions.test.ts --no-coverage 2>&1 | tail -20
```

Expected: 3 new tests fail (check_number missing from SELECT and INSERT).

- [ ] **Step 3: Update `TxRow` interface**

In `server/src/routes/transactions.ts`, add `check_number` to the `TxRow` interface (after line 20, after `payee`):

```typescript
interface TxRow {
  id: number
  account_id: number
  account_name: string
  plaid_transaction_id: string | null
  date: string
  payee: string
  amount: number
  check_number: string | null
  is_cleared: number
  is_manual: number
}
```

- [ ] **Step 4: Add `check_number` to the GET SELECT query**

In `server/src/routes/transactions.ts`, update the `txRows` query (around line 86). Change the SELECT to include `t.check_number`:

```typescript
    const txRows = db.prepare(`
      SELECT t.id, t.account_id, a.name as account_name,
             t.plaid_transaction_id, t.date, t.payee, t.amount,
             t.check_number, t.is_cleared, t.is_manual
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.is_removed = 0
        AND t.account_id IN (${accountPlaceholders})
      ORDER BY t.date DESC, t.id DESC
    `).all(...accountIds) as TxRow[]
```

- [ ] **Step 5: Accept and store `check_number` in POST**

In `server/src/routes/transactions.ts`, update the POST handler.

First, update the destructure (line 156) to include `check_number`:

```typescript
    const { account_id, date, payee, amount, splits, check_number } = req.body as {
      account_id: number
      date: string
      payee: string
      amount: number
      splits: SplitInput[]
      check_number?: string | null
    }
```

Then update the `insertTx` prepared statement (around line 195) to include the column and parameter:

```typescript
    const insertTx = db.prepare(
      'INSERT INTO transactions (account_id, date, payee, amount, check_number, is_cleared, is_manual) VALUES (?, ?, ?, ?, ?, 0, 1)'
    )
```

And update the `insertTx.run` call inside the transaction (around line 206):

```typescript
      const result = insertTx.run(account_id, date, payee, amount, check_number?.trim() || null)
```

- [ ] **Step 6: Run all tests to verify they pass**

```bash
cd /Users/markmccall/finance-app/server && npx jest --no-coverage 2>&1 | tail -20
```

Expected: All tests pass. Total should be ≥ 90.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/transactions.ts server/src/__tests__/transactions.test.ts
git commit -m "feat: include check_number in GET and POST transactions API"
```

---

## Task 3: Plaid Sync — Capture check_number

**Files:**
- Modify: `server/src/routes/plaid.ts`
- Test: `server/src/__tests__/plaid.test.ts`

- [ ] **Step 1: Write the failing tests**

In `server/src/__tests__/plaid.test.ts`, add two tests inside the existing `describe('POST /api/plaid/sync', ...)` block, after the last existing test:

```typescript
  test('stores check_number from Plaid transaction', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({
      data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 500 } }] },
    })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{
          transaction_id: 'tx-check',
          account_id: 'acct-aaa',
          date: '2026-05-01',
          name: 'Electric Company',
          merchant_name: null,
          check_number: '1247',
          amount: 145.00,
          pending: false,
        }],
        modified: [],
        removed: [],
        has_more: false,
        next_cursor: 'cursor-x',
      },
    })

    await request(app).post('/api/plaid/sync').send({})

    const tx = getDb()
      .prepare("SELECT check_number FROM transactions WHERE plaid_transaction_id = 'tx-check'")
      .get() as { check_number: string | null } | undefined
    expect(tx?.check_number).toBe('1247')
  })

  test('stores null check_number when Plaid transaction has none', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({
      data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 500 } }] },
    })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{
          transaction_id: 'tx-nocheck',
          account_id: 'acct-aaa',
          date: '2026-05-01',
          name: 'Starbucks',
          merchant_name: 'Starbucks',
          amount: 5.50,
          pending: false,
        }],
        modified: [],
        removed: [],
        has_more: false,
        next_cursor: 'cursor-y',
      },
    })

    await request(app).post('/api/plaid/sync').send({})

    const tx = getDb()
      .prepare("SELECT check_number FROM transactions WHERE plaid_transaction_id = 'tx-nocheck'")
      .get() as { check_number: string | null } | undefined
    expect(tx?.check_number).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/markmccall/finance-app/server && npx jest plaid.test.ts --no-coverage 2>&1 | tail -20
```

Expected: 2 new tests fail (check_number not in INSERT).

- [ ] **Step 3: Update `PlaidTx` type**

In `server/src/routes/plaid.ts`, update the inline `PlaidTx` type definition (line 140). Add `check_number`:

```typescript
      type PlaidTx = { transaction_id: string; account_id: string; date: string; name: string; merchant_name?: string | null; check_number?: string | null; amount: number; pending: boolean }
```

- [ ] **Step 4: Update `upsertTx` to include `check_number`**

In `server/src/routes/plaid.ts`, update the `upsertTx` prepared statement (lines 168–177):

```typescript
      const upsertTx = db.prepare(`
        INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount, check_number, is_cleared)
        VALUES (@account_id, @plaid_transaction_id, @date, @payee, @amount, @check_number, @is_cleared)
        ON CONFLICT(plaid_transaction_id) DO UPDATE SET
          date = excluded.date,
          payee = excluded.payee,
          amount = excluded.amount,
          check_number = excluded.check_number,
          is_cleared = excluded.is_cleared,
          is_removed = 0
      `)
```

- [ ] **Step 5: Pass `check_number` in the `upsertTx.run` call**

In `server/src/routes/plaid.ts`, update the `upsertTx.run` call (around line 195):

```typescript
          upsertTx.run({
            account_id: accountId,
            plaid_transaction_id: tx.transaction_id,
            date: tx.date,
            payee: tx.merchant_name ?? tx.name,
            amount: -(tx.amount),  // negate: Plaid positive=debit, we store negative=debit
            check_number: tx.check_number ?? null,
            is_cleared: tx.pending ? 0 : 1,
          })
```

- [ ] **Step 6: Run all tests to verify they pass**

```bash
cd /Users/markmccall/finance-app/server && npx jest --no-coverage 2>&1 | tail -20
```

Expected: All tests pass. Total should be ≥ 92.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/plaid.ts server/src/__tests__/plaid.test.ts
git commit -m "feat: capture check_number from Plaid sync"
```

---

## Task 4: Client — Transaction Interface, Form Field, Display

**Files:**
- Modify: `client/src/Register.tsx`

No new test files — this is pure UI. Verify with TypeScript compile after each step.

- [ ] **Step 1: Add `check_number` to the `Transaction` interface**

In `client/src/Register.tsx`, update the `Transaction` interface (lines 30–41). Add `check_number` after `payee`:

```typescript
interface Transaction {
  id: number
  account_id: number
  account_name: string
  date: string
  payee: string
  amount: number
  check_number: string | null
  is_cleared: 0 | 1
  is_manual: 0 | 1
  splits: Split[]
  running_balance: number
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd /Users/markmccall/finance-app/client && npx tsc --noEmit 2>&1
```

Expected: No errors. If there are errors, fix them before continuing.

- [ ] **Step 3: Update the desktop table payee cell**

In `client/src/Register.tsx`, find the desktop table payee cell (around line 548):

```tsx
                  <td className="py-2 pr-4 font-medium">{tx.payee}</td>
```

Replace it with:

```tsx
                  <td className="py-2 pr-4 font-medium">
                    {tx.payee}
                    {tx.check_number && (
                      <span className="text-gray-400 text-xs ml-1">· Check #{tx.check_number}</span>
                    )}
                  </td>
```

- [ ] **Step 4: Update the mobile card payee line**

In `client/src/Register.tsx`, find the mobile card payee div (around line 601):

```tsx
                <div className="font-medium truncate">{tx.payee}</div>
```

Replace it with:

```tsx
                <div className="font-medium truncate">
                  {tx.payee}
                  {tx.check_number && (
                    <span className="text-gray-400 text-xs ml-1">· Check #{tx.check_number}</span>
                  )}
                </div>
```

- [ ] **Step 5: Add `checkNumber` state to `ManualEntryForm`**

In `client/src/Register.tsx`, inside the `ManualEntryForm` function body, find the state declarations (around line 207). Add `checkNumber` state directly after the `amount` state:

```typescript
  const [amount, setAmount] = useState('')
  const [checkNumber, setCheckNumber] = useState('')
```

- [ ] **Step 6: Add the Check # input to the form**

In `client/src/Register.tsx`, find the form grid `<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">` (around line 277). The grid has four cells: Date, Payee, Account, Amount. Add a fifth cell for Check # after Amount. Change the grid class to `grid-cols-2 md:grid-cols-5` and append the new cell:

```tsx
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
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
            placeholder="Payee"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Account</label>
          <select
            value={accountId}
            onChange={e => setAccountId(Number(e.target.value))}
            className="w-full border rounded px-2 py-1 text-sm"
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Amount (– for expense)</label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={e => {
              setAmount(e.target.value)
              const val = parseFloat(e.target.value) || 0
              setDrafts([{ category_id: uncategorized?.id ?? null, amount: val ? val.toFixed(2) : '' }])
            }}
            placeholder="-50.00"
            className="w-full border rounded px-2 py-1 text-sm font-mono text-right"
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
```

- [ ] **Step 7: Include `check_number` in the POST body**

In `client/src/Register.tsx`, inside the `submit` function, find the `JSON.stringify` call (around line 252). Add `check_number` to the body:

```typescript
        body: JSON.stringify({
          account_id: Number(accountId),
          date,
          payee: payee.trim(),
          amount: parsedAmount,
          check_number: checkNumber.trim() || null,
          splits: drafts.map(d => ({
            category_id: d.category_id,
            amount: parseFloat(d.amount),
          })),
        }),
```

- [ ] **Step 8: Verify TypeScript compiles cleanly**

```bash
cd /Users/markmccall/finance-app/client && npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 9: Run the full server test suite one final time**

```bash
cd /Users/markmccall/finance-app/server && npx jest --no-coverage 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add client/src/Register.tsx
git commit -m "feat: add check number field to manual entry form and register display"
```

---

## Done

All four tasks complete. Open a PR to merge `phase/01d-check-number` into `main`.

```bash
git push -u origin phase/01d-check-number
gh pr create --title "Phase 1d: Check number support" --body "$(cat <<'EOF'
## Summary
- Adds \`check_number TEXT\` column to transactions via runtime migration (no data loss)
- Plaid sync captures \`transaction.check_number\` from API response
- Manual entry form has an optional Check # field
- Register displays \`Payee · Check #1247\` when a check number is present

## Test Plan
- [ ] Run \`npm test\` in \`server/\` — all tests pass
- [ ] Start dev server, open Register, add a manual transaction with a check number, confirm it appears in the list
- [ ] Add a manual transaction without a check number, confirm display is unaffected
EOF
)"
```
