# Phase 1c — Register View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Register view — transaction list with running balance, account/category filters, split editing, manual transaction entry, and category management.

**Architecture:** Seven server routes (accounts list, categories CRUD + reorder, transactions list + create + cleared toggle + split update) plus four client components (Register page, CategoryPicker typeahead, split entry UI, CategoryPanel). Running balance computed server-side across all non-removed transactions before category filter is applied, so the balance column always reflects actual account state regardless of active filters.

**Tech Stack:** Node.js 24 + Express + TypeScript + better-sqlite3 (server); React 18 + Tailwind CSS + TypeScript (client); supertest + jest (tests).

---

## File Map

**Server — new files:**
- `server/src/routes/accounts.ts` — `GET /api/accounts`
- `server/src/routes/categories.ts` — `GET /api/categories`, `POST /api/categories`, `PATCH /api/categories/:id`, `DELETE /api/categories/:id`, `POST /api/categories/reorder`
- `server/src/routes/transactions.ts` — `GET /api/transactions`, `POST /api/transactions`, `PATCH /api/transactions/:id/cleared`, `PUT /api/transactions/:id/splits`
- `server/src/__tests__/accounts.test.ts`
- `server/src/__tests__/categories.test.ts`
- `server/src/__tests__/transactions.test.ts`

**Server — modified files:**
- `server/src/routes/index.ts` — mount accounts, categories, transactions routers

**Client — new files:**
- `client/src/Register.tsx` — main Register page (table + mobile cards, filters, cleared toggle)
- `client/src/CategoryPicker.tsx` — searchable typeahead combobox
- `client/src/CategoryPanel.tsx` — category management panel

**Client — modified files:**
- `client/src/App.tsx` — replace stub `Register` function with `import Register from './Register'`

---

### Task 1: GET /api/accounts and GET /api/categories

**Files:**
- Create: `server/src/routes/accounts.ts`
- Create: `server/src/routes/categories.ts`
- Modify: `server/src/routes/index.ts`
- Create: `server/src/__tests__/accounts.test.ts`
- Create: `server/src/__tests__/categories.test.ts`

- [ ] **Step 1: Write failing tests for GET /api/accounts**

`server/src/__tests__/accounts.test.ts`:
```typescript
import request from 'supertest'
import { app } from '../index'
import { createDb, getDb, closeDb } from '../db'
import { createTables, seedCategories, seedTestData } from '../schema'

beforeEach(() => {
  createDb(':memory:')
  createTables(getDb())
  seedCategories(getDb())
  seedTestData(getDb())
})

afterEach(() => { closeDb() })

describe('GET /api/accounts', () => {
  test('returns all active accounts', async () => {
    const res = await request(app).get('/api/accounts')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(2) // seedTestData creates checking + savings
    const names = res.body.map((a: { name: string }) => a.name)
    expect(names).toContain('Truist Checking')
    expect(names).toContain('Truist Savings')
  })

  test('each account has id, name, type, subtype, current_balance, mask, is_manual', async () => {
    const res = await request(app).get('/api/accounts')
    const checking = res.body.find((a: { name: string }) => a.name === 'Truist Checking')
    expect(checking).toMatchObject({
      id: expect.any(Number),
      name: 'Truist Checking',
      type: 'depository',
      subtype: 'checking',
      current_balance: 4250,
      mask: '4823',
      is_manual: 0,
    })
  })

  test('does not return inactive accounts', async () => {
    getDb().prepare('UPDATE accounts SET is_active = 0 WHERE name = ?').run('Truist Savings')
    const res = await request(app).get('/api/accounts')
    expect(res.body.length).toBe(1)
    expect(res.body[0].name).toBe('Truist Checking')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/markmccall/finance-app && npm test -w server -- --testPathPattern=accounts
```

Expected: FAIL — route does not exist yet (404).

- [ ] **Step 3: Write failing tests for GET /api/categories**

`server/src/__tests__/categories.test.ts`:
```typescript
import request from 'supertest'
import { app } from '../index'
import { createDb, getDb, closeDb } from '../db'
import { createTables, seedCategories } from '../schema'

beforeEach(() => {
  createDb(':memory:')
  createTables(getDb())
  seedCategories(getDb())
})

afterEach(() => { closeDb() })

describe('GET /api/categories', () => {
  test('returns all active categories', async () => {
    const res = await request(app).get('/api/categories')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    // 7 parents + 14 children + 1 system = 22
    expect(res.body.length).toBe(22)
  })

  test('each category has id, name, parent_id, parent_name, is_system, is_active, sort_order', async () => {
    const res = await request(app).get('/api/categories')
    const groceries = res.body.find((c: { name: string }) => c.name === 'Groceries')
    expect(groceries).toMatchObject({
      id: expect.any(Number),
      name: 'Groceries',
      parent_id: expect.any(Number),
      parent_name: 'Food',
      is_system: 0,
      is_active: 1,
      sort_order: 0,
    })
  })

  test('parent categories have parent_id and parent_name as null', async () => {
    const res = await request(app).get('/api/categories')
    const food = res.body.find((c: { name: string }) => c.name === 'Food')
    expect(food.parent_id).toBeNull()
    expect(food.parent_name).toBeNull()
  })

  test('Uncategorized is included and marked is_system=1', async () => {
    const res = await request(app).get('/api/categories')
    const uncat = res.body.find((c: { name: string }) => c.name === 'Uncategorized')
    expect(uncat).toBeDefined()
    expect(uncat.is_system).toBe(1)
  })

  test('inactive categories are excluded', async () => {
    getDb().prepare("UPDATE categories SET is_active = 0 WHERE name = 'Groceries'").run()
    const res = await request(app).get('/api/categories')
    const groceries = res.body.find((c: { name: string }) => c.name === 'Groceries')
    expect(groceries).toBeUndefined()
    expect(res.body.length).toBe(21)
  })
})
```

- [ ] **Step 4: Create accounts route**

`server/src/routes/accounts.ts`:
```typescript
import { Router } from 'express'
import { getDb } from '../db'

export const accountsRouter = Router()

accountsRouter.get('/', (_req, res) => {
  const db = getDb()
  const accounts = db.prepare(`
    SELECT id, plaid_item_id, name, type, subtype, mask, is_manual,
           starting_balance, current_balance, is_active
    FROM accounts
    WHERE is_active = 1
    ORDER BY name
  `).all()
  res.json(accounts)
})
```

- [ ] **Step 5: Create categories route**

`server/src/routes/categories.ts`:
```typescript
import { Router, Request, Response } from 'express'
import { getDb } from '../db'

export const categoriesRouter = Router()

categoriesRouter.get('/', (_req, res) => {
  const db = getDb()
  const categories = db.prepare(`
    SELECT c.id, c.name, c.parent_id, pc.name as parent_name,
           c.is_system, c.is_active, c.sort_order
    FROM categories c
    LEFT JOIN categories pc ON pc.id = c.parent_id
    WHERE c.is_active = 1
    ORDER BY COALESCE(pc.sort_order, c.sort_order), c.sort_order
  `).all()
  res.json(categories)
})
```

- [ ] **Step 6: Mount new routers in index.ts**

`server/src/routes/index.ts`:
```typescript
import { Router } from 'express'
import { getDb } from '../db'
import { plaidRouter } from './plaid'
import { accountsRouter } from './accounts'
import { categoriesRouter } from './categories'

export const router = Router()

router.get('/health', (_req, res) => {
  const db = getDb()
  const result = db.prepare("SELECT 'ok' AS status").get() as { status: string }
  res.json(result)
})

router.use('/plaid', plaidRouter)
router.use('/accounts', accountsRouter)
router.use('/categories', categoriesRouter)
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd /Users/markmccall/finance-app && npm test -w server -- --testPathPattern="accounts|categories"
```

Expected: PASS — all new tests green.

- [ ] **Step 8: Run full test suite to check for regressions**

```bash
cd /Users/markmccall/finance-app && npm test -w server
```

Expected: all 36 existing tests + new tests PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/markmccall/finance-app
git add server/src/routes/accounts.ts server/src/routes/categories.ts server/src/routes/index.ts server/src/__tests__/accounts.test.ts server/src/__tests__/categories.test.ts
git commit -m "feat: add GET /api/accounts and GET /api/categories"
```

---

### Task 2: GET /api/transactions

**Files:**
- Create: `server/src/routes/transactions.ts`
- Modify: `server/src/routes/index.ts`
- Create: `server/src/__tests__/transactions.test.ts`

**Running balance algorithm:** Fetch all non-removed transactions for the requested accounts ordered newest-first. For each account, assign running balances starting from `current_balance` (the balance right now) and subtracting each transaction's amount going back in time. So `balance[i] = account.current_balance` for the newest transaction, and each subsequent older transaction gets `balance[i+1] = balance[i] - tx[i].amount`. Apply the category filter after running balance assignment (so the balance column always reflects actual account state). Then paginate.

- [ ] **Step 1: Write failing tests**

`server/src/__tests__/transactions.test.ts`:
```typescript
import request from 'supertest'
import { app } from '../index'
import { createDb, getDb, closeDb } from '../db'
import { createTables, seedCategories, seedTestData } from '../schema'

beforeEach(() => {
  createDb(':memory:')
  createTables(getDb())
  seedCategories(getDb())
  seedTestData(getDb())
})

afterEach(() => { closeDb() })

function addSplit(txId: number, categoryId: number, amount: number) {
  getDb().prepare(
    'INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)'
  ).run(txId, categoryId, amount)
}

function getCategoryId(name: string): number {
  const row = getDb().prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }
  return row.id
}

describe('GET /api/transactions', () => {
  test('returns transactions newest-first with running balance', async () => {
    const res = await request(app).get('/api/transactions')
    expect(res.status).toBe(200)
    expect(res.body.transactions).toBeDefined()
    expect(res.body.total).toBeGreaterThan(0)
    const txs = res.body.transactions
    for (let i = 1; i < txs.length; i++) {
      expect(txs[i].date <= txs[i - 1].date).toBe(true)
    }
  })

  test('running balance for first (newest) transaction equals account current_balance', async () => {
    const res = await request(app).get('/api/transactions?account_id=1')
    expect(res.status).toBe(200)
    const txs = res.body.transactions
    expect(txs.length).toBeGreaterThan(0)
    // Truist Checking current_balance is 4250 (seeded)
    expect(txs[0].running_balance).toBeCloseTo(4250, 2)
  })

  test('running balance decrements correctly going back in time', async () => {
    const res = await request(app).get('/api/transactions?account_id=1')
    const txs = res.body.transactions
    // balance[1] = balance[0] - txs[0].amount
    expect(txs[1].running_balance).toBeCloseTo(txs[0].running_balance - txs[0].amount, 2)
  })

  test('filters by account_id', async () => {
    const res = await request(app).get('/api/transactions?account_id=1')
    expect(res.status).toBe(200)
    res.body.transactions.forEach((tx: { account_id: number }) => {
      expect(tx.account_id).toBe(1)
    })
  })

  test('returns 0 transactions for account with no transactions', async () => {
    // account_id=2 is Truist Savings — no transactions seeded
    const res = await request(app).get('/api/transactions?account_id=2')
    expect(res.status).toBe(200)
    expect(res.body.transactions.length).toBe(0)
    expect(res.body.total).toBe(0)
  })

  test('each transaction includes account_name', async () => {
    const res = await request(app).get('/api/transactions?account_id=1')
    expect(res.body.transactions[0].account_name).toBe('Truist Checking')
  })

  test('each transaction includes splits array', async () => {
    const db = getDb()
    const txRow = db.prepare('SELECT id, amount FROM transactions LIMIT 1').get() as { id: number; amount: number }
    const catId = getCategoryId('Groceries')
    addSplit(txRow.id, catId, txRow.amount)

    const res = await request(app).get('/api/transactions?account_id=1')
    const txWithSplit = res.body.transactions.find((t: { id: number }) => t.id === txRow.id)
    expect(txWithSplit.splits).toBeDefined()
    expect(txWithSplit.splits.length).toBe(1)
    expect(txWithSplit.splits[0].category_name).toBe('Groceries')
    expect(txWithSplit.splits[0].parent_category_name).toBe('Food')
  })

  test('filters by category_id (leaf)', async () => {
    const db = getDb()
    const txRow = db.prepare('SELECT id, amount FROM transactions LIMIT 1').get() as { id: number; amount: number }
    const catId = getCategoryId('Groceries')
    addSplit(txRow.id, catId, txRow.amount)

    const res = await request(app).get(`/api/transactions?account_id=1&category_id=${catId}`)
    expect(res.status).toBe(200)
    expect(res.body.transactions.length).toBe(1)
    expect(res.body.transactions[0].id).toBe(txRow.id)
  })

  test('filters by parent category_id returns children', async () => {
    const db = getDb()
    const grocId = getCategoryId('Groceries')
    const diningId = getCategoryId('Dining Out')
    const foodId = getCategoryId('Food')

    const txs = db.prepare('SELECT id, amount FROM transactions LIMIT 2').all() as Array<{ id: number; amount: number }>
    addSplit(txs[0].id, grocId, txs[0].amount)
    addSplit(txs[1].id, diningId, txs[1].amount)

    const res = await request(app).get(`/api/transactions?account_id=1&category_id=${foodId}`)
    expect(res.body.transactions.length).toBe(2)
  })

  test('supports pagination with limit and offset', async () => {
    const res1 = await request(app).get('/api/transactions?account_id=1&limit=3&offset=0')
    const res2 = await request(app).get('/api/transactions?account_id=1&limit=3&offset=3')
    expect(res1.body.transactions.length).toBe(3)
    expect(res2.body.transactions.length).toBe(3)
    expect(res1.body.transactions[0].id).not.toBe(res2.body.transactions[0].id)
    expect(res1.body.total).toBe(10) // 10 transactions seeded for checking
  })

  test('excludes soft-deleted transactions', async () => {
    getDb().prepare(
      'UPDATE transactions SET is_removed = 1 WHERE id = (SELECT id FROM transactions LIMIT 1)'
    ).run()
    const res = await request(app).get('/api/transactions?account_id=1')
    expect(res.body.total).toBe(9)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/markmccall/finance-app && npm test -w server -- --testPathPattern=transactions
```

Expected: FAIL — route does not exist yet.

- [ ] **Step 3: Create transactions route with GET handler**

`server/src/routes/transactions.ts`:
```typescript
import { Router, Request, Response } from 'express'
import { getDb } from '../db'

export const transactionsRouter = Router()

interface AccountRow {
  id: number
  current_balance: number
}

interface TxRow {
  id: number
  account_id: number
  account_name: string
  plaid_transaction_id: string | null
  date: string
  payee: string
  amount: number
  is_cleared: number
  is_manual: number
}

interface SplitRow {
  id: number
  transaction_id: number
  category_id: number
  category_name: string
  parent_category_name: string | null
  amount: number
}

interface TxWithBalance extends TxRow {
  splits: Omit<SplitRow, 'transaction_id'>[]
  running_balance: number
}

transactionsRouter.get('/', (req: Request, res: Response) => {
  const db = getDb()
  const accountId = req.query.account_id ? Number(req.query.account_id) : null
  const categoryId = req.query.category_id ? Number(req.query.category_id) : null
  const limit = req.query.limit ? Number(req.query.limit) : 50
  const offset = req.query.offset ? Number(req.query.offset) : 0

  let accountIds: number[]
  if (accountId) {
    accountIds = [accountId]
  } else {
    accountIds = (
      db.prepare('SELECT id FROM accounts WHERE is_active = 1').all() as { id: number }[]
    ).map(a => a.id)
  }

  if (accountIds.length === 0) {
    res.json({ transactions: [], total: 0 })
    return
  }

  // Expand parent category to its children for filtering
  let categoryIds: number[] | null = null
  if (categoryId) {
    const cat = db.prepare('SELECT id, parent_id FROM categories WHERE id = ?').get(categoryId) as {
      id: number
      parent_id: number | null
    } | undefined
    if (!cat) {
      res.json({ transactions: [], total: 0 })
      return
    }
    if (cat.parent_id === null) {
      const children = db.prepare('SELECT id FROM categories WHERE parent_id = ?').all(categoryId) as { id: number }[]
      categoryIds = children.map(c => c.id)
    } else {
      categoryIds = [categoryId]
    }
  }

  const accountPlaceholders = accountIds.map(() => '?').join(',')

  const accounts = db.prepare(
    `SELECT id, current_balance FROM accounts WHERE id IN (${accountPlaceholders})`
  ).all(...accountIds) as AccountRow[]
  const accountBalanceMap = new Map(accounts.map(a => [a.id, a.current_balance]))

  const txRows = db.prepare(`
    SELECT t.id, t.account_id, a.name as account_name,
           t.plaid_transaction_id, t.date, t.payee, t.amount,
           t.is_cleared, t.is_manual
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.is_removed = 0
      AND t.account_id IN (${accountPlaceholders})
    ORDER BY t.date DESC, t.id DESC
  `).all(...accountIds) as TxRow[]

  const txIds = txRows.map(t => t.id)
  const splitsByTxId = new Map<number, Omit<SplitRow, 'transaction_id'>[]>()
  if (txIds.length > 0) {
    const splitPlaceholders = txIds.map(() => '?').join(',')
    const splitRows = db.prepare(`
      SELECT ts.id, ts.transaction_id, ts.category_id, ts.amount,
             c.name as category_name,
             pc.name as parent_category_name
      FROM transaction_splits ts
      JOIN categories c ON c.id = ts.category_id
      LEFT JOIN categories pc ON pc.id = c.parent_id
      WHERE ts.transaction_id IN (${splitPlaceholders})
    `).all(...txIds) as SplitRow[]

    for (const split of splitRows) {
      const { transaction_id, ...splitData } = split
      if (!splitsByTxId.has(transaction_id)) splitsByTxId.set(transaction_id, [])
      splitsByTxId.get(transaction_id)!.push(splitData)
    }
  }

  // Compute running balances per account (newest-first order)
  // balance[0] = account.current_balance; balance[i] = balance[i-1] - txRows[i-1].amount
  const runningBalances = new Map<number, number>()
  const balanceState = new Map(accountBalanceMap)
  for (const tx of txRows) {
    runningBalances.set(tx.id, balanceState.get(tx.account_id) ?? 0)
    balanceState.set(tx.account_id, (balanceState.get(tx.account_id) ?? 0) - tx.amount)
  }

  let allTxs: TxWithBalance[] = txRows.map(tx => ({
    ...tx,
    splits: splitsByTxId.get(tx.id) ?? [],
    running_balance: runningBalances.get(tx.id) ?? 0,
  }))

  if (categoryIds !== null) {
    const catSet = new Set(categoryIds)
    allTxs = allTxs.filter(tx => tx.splits.some(s => catSet.has(s.category_id)))
  }

  const total = allTxs.length
  const paginated = allTxs.slice(offset, offset + limit)

  res.json({ transactions: paginated, total })
})
```

- [ ] **Step 4: Mount transactions router in index.ts**

`server/src/routes/index.ts`:
```typescript
import { Router } from 'express'
import { getDb } from '../db'
import { plaidRouter } from './plaid'
import { accountsRouter } from './accounts'
import { categoriesRouter } from './categories'
import { transactionsRouter } from './transactions'

export const router = Router()

router.get('/health', (_req, res) => {
  const db = getDb()
  const result = db.prepare("SELECT 'ok' AS status").get() as { status: string }
  res.json(result)
})

router.use('/plaid', plaidRouter)
router.use('/accounts', accountsRouter)
router.use('/categories', categoriesRouter)
router.use('/transactions', transactionsRouter)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/markmccall/finance-app && npm test -w server -- --testPathPattern=transactions
```

Expected: PASS.

- [ ] **Step 6: Run full suite**

```bash
cd /Users/markmccall/finance-app && npm test -w server
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/markmccall/finance-app
git add server/src/routes/transactions.ts server/src/routes/index.ts server/src/__tests__/transactions.test.ts
git commit -m "feat: add GET /api/transactions with running balance, filters, and pagination"
```

---

### Task 3: POST /api/transactions, PATCH /api/transactions/:id/cleared, PUT /api/transactions/:id/splits

**Files:**
- Modify: `server/src/routes/transactions.ts`
- Modify: `server/src/__tests__/transactions.test.ts`

- [ ] **Step 1: Write failing tests (append to transactions.test.ts)**

Add after the existing `describe('GET /api/transactions', ...)` block:

```typescript
describe('POST /api/transactions', () => {
  test('creates a manual transaction with a single split', async () => {
    const catId = getCategoryId('Groceries')
    const res = await request(app).post('/api/transactions').send({
      account_id: 1,
      date: '2026-05-10',
      payee: 'Whole Foods',
      amount: -62.50,
      splits: [{ category_id: catId, amount: -62.50 }],
    })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    const tx = getDb().prepare('SELECT * FROM transactions WHERE id = ?').get(res.body.id) as {
      is_manual: number; payee: string
    }
    expect(tx.is_manual).toBe(1)
    expect(tx.payee).toBe('Whole Foods')
  })

  test('creates splits for the transaction', async () => {
    const grocId = getCategoryId('Groceries')
    const diningId = getCategoryId('Dining Out')
    const res = await request(app).post('/api/transactions').send({
      account_id: 1,
      date: '2026-05-10',
      payee: 'Split Purchase',
      amount: -100,
      splits: [
        { category_id: grocId, amount: -60 },
        { category_id: diningId, amount: -40 },
      ],
    })
    expect(res.status).toBe(201)
    const splits = getDb().prepare(
      'SELECT * FROM transaction_splits WHERE transaction_id = ?'
    ).all(res.body.id)
    expect(splits.length).toBe(2)
  })

  test('updates account current_balance', async () => {
    const catId = getCategoryId('Groceries')
    const before = (
      getDb().prepare('SELECT current_balance FROM accounts WHERE id = 1').get() as { current_balance: number }
    ).current_balance
    await request(app).post('/api/transactions').send({
      account_id: 1,
      date: '2026-05-10',
      payee: 'Test',
      amount: -50,
      splits: [{ category_id: catId, amount: -50 }],
    })
    const after = (
      getDb().prepare('SELECT current_balance FROM accounts WHERE id = 1').get() as { current_balance: number }
    ).current_balance
    expect(after).toBeCloseTo(before - 50, 2)
  })

  test('returns 400 when splits do not sum to transaction amount', async () => {
    const catId = getCategoryId('Groceries')
    const res = await request(app).post('/api/transactions').send({
      account_id: 1,
      date: '2026-05-10',
      payee: 'Bad Split',
      amount: -100,
      splits: [{ category_id: catId, amount: -60 }],
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 when splits array is empty', async () => {
    const res = await request(app).post('/api/transactions').send({
      account_id: 1,
      date: '2026-05-10',
      payee: 'No Splits',
      amount: -50,
      splits: [],
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 when account_id does not exist', async () => {
    const catId = getCategoryId('Groceries')
    const res = await request(app).post('/api/transactions').send({
      account_id: 9999,
      date: '2026-05-10',
      payee: 'Ghost Account',
      amount: -50,
      splits: [{ category_id: catId, amount: -50 }],
    })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/transactions/:id/cleared', () => {
  test('toggles is_cleared from 0 to 1', async () => {
    const tx = getDb().prepare(
      'SELECT id, is_cleared FROM transactions WHERE is_cleared = 0 LIMIT 1'
    ).get() as { id: number; is_cleared: number }
    const res = await request(app).patch(`/api/transactions/${tx.id}/cleared`)
    expect(res.status).toBe(200)
    expect(res.body.is_cleared).toBe(1)
    const updated = getDb().prepare(
      'SELECT is_cleared FROM transactions WHERE id = ?'
    ).get(tx.id) as { is_cleared: number }
    expect(updated.is_cleared).toBe(1)
  })

  test('toggles is_cleared from 1 to 0', async () => {
    const tx = getDb().prepare(
      'SELECT id FROM transactions WHERE is_cleared = 1 LIMIT 1'
    ).get() as { id: number }
    await request(app).patch(`/api/transactions/${tx.id}/cleared`)
    const updated = getDb().prepare(
      'SELECT is_cleared FROM transactions WHERE id = ?'
    ).get(tx.id) as { is_cleared: number }
    expect(updated.is_cleared).toBe(0)
  })

  test('returns 404 for unknown transaction id', async () => {
    const res = await request(app).patch('/api/transactions/9999/cleared')
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/transactions/:id/splits', () => {
  test('replaces splits for a transaction', async () => {
    const db = getDb()
    const txRow = db.prepare(
      'SELECT id, amount FROM transactions LIMIT 1'
    ).get() as { id: number; amount: number }
    const grocId = getCategoryId('Groceries')
    addSplit(txRow.id, grocId, txRow.amount)

    const diningId = getCategoryId('Dining Out')
    const res = await request(app).put(`/api/transactions/${txRow.id}/splits`).send({
      splits: [{ category_id: diningId, amount: txRow.amount }],
    })
    expect(res.status).toBe(200)

    const splits = db.prepare(
      'SELECT * FROM transaction_splits WHERE transaction_id = ?'
    ).all(txRow.id)
    expect(splits.length).toBe(1)
    expect((splits[0] as { category_id: number }).category_id).toBe(diningId)
  })

  test('returns 400 when new splits do not sum to transaction amount', async () => {
    const txRow = getDb().prepare(
      'SELECT id, amount FROM transactions LIMIT 1'
    ).get() as { id: number; amount: number }
    const catId = getCategoryId('Groceries')
    const res = await request(app).put(`/api/transactions/${txRow.id}/splits`).send({
      splits: [{ category_id: catId, amount: txRow.amount + 10 }],
    })
    expect(res.status).toBe(400)
  })

  test('returns 404 for unknown transaction id', async () => {
    const catId = getCategoryId('Groceries')
    const res = await request(app).put('/api/transactions/9999/splits').send({
      splits: [{ category_id: catId, amount: -50 }],
    })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
cd /Users/markmccall/finance-app && npm test -w server -- --testPathPattern=transactions
```

Expected: GET tests PASS, POST/PATCH/PUT tests FAIL.

- [ ] **Step 3: Implement POST, PATCH, PUT in transactions.ts**

Append to `server/src/routes/transactions.ts` (after the `transactionsRouter.get` handler):

```typescript
interface SplitInput {
  category_id: number
  amount: number
}

transactionsRouter.post('/', (req: Request, res: Response) => {
  const db = getDb()
  const { account_id, date, payee, amount, splits } = req.body as {
    account_id: number
    date: string
    payee: string
    amount: number
    splits: SplitInput[]
  }

  if (!splits || splits.length === 0) {
    res.status(400).json({ error: 'At least one split is required' })
    return
  }

  const splitSum = splits.reduce((s: number, sp: SplitInput) => s + sp.amount, 0)
  if (Math.abs(splitSum - amount) > 0.001) {
    res.status(400).json({ error: 'Split amounts must sum to transaction amount' })
    return
  }

  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id)
  if (!account) {
    res.status(400).json({ error: 'Account not found' })
    return
  }

  const insertTx = db.prepare(
    'INSERT INTO transactions (account_id, date, payee, amount, is_cleared, is_manual) VALUES (?, ?, ?, ?, 0, 1)'
  )
  const insertSplit = db.prepare(
    'INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)'
  )
  const updateBalance = db.prepare(
    'UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?'
  )

  const txId = db.transaction(() => {
    const result = insertTx.run(account_id, date, payee, amount)
    const id = result.lastInsertRowid as number
    for (const split of splits) {
      insertSplit.run(id, split.category_id, split.amount)
    }
    updateBalance.run(amount, account_id)
    return id
  })()

  res.status(201).json({ id: txId })
})

transactionsRouter.patch('/:id/cleared', (req: Request, res: Response) => {
  const db = getDb()
  const id = Number(req.params.id)
  const tx = db.prepare(
    'SELECT id, is_cleared FROM transactions WHERE id = ? AND is_removed = 0'
  ).get(id) as { id: number; is_cleared: number } | undefined
  if (!tx) {
    res.status(404).json({ error: 'Transaction not found' })
    return
  }
  const newCleared = tx.is_cleared === 0 ? 1 : 0
  db.prepare('UPDATE transactions SET is_cleared = ? WHERE id = ?').run(newCleared, id)
  res.json({ id, is_cleared: newCleared })
})

transactionsRouter.put('/:id/splits', (req: Request, res: Response) => {
  const db = getDb()
  const id = Number(req.params.id)
  const { splits } = req.body as { splits: SplitInput[] }

  const tx = db.prepare(
    'SELECT id, amount FROM transactions WHERE id = ? AND is_removed = 0'
  ).get(id) as { id: number; amount: number } | undefined
  if (!tx) {
    res.status(404).json({ error: 'Transaction not found' })
    return
  }

  if (!splits || splits.length === 0) {
    res.status(400).json({ error: 'At least one split is required' })
    return
  }

  const splitSum = splits.reduce((s: number, sp: SplitInput) => s + sp.amount, 0)
  if (Math.abs(splitSum - tx.amount) > 0.001) {
    res.status(400).json({ error: 'Split amounts must sum to transaction amount' })
    return
  }

  db.transaction(() => {
    db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(id)
    const insertSplit = db.prepare(
      'INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)'
    )
    for (const split of splits) {
      insertSplit.run(id, split.category_id, split.amount)
    }
  })()

  res.json({ id })
})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/markmccall/finance-app && npm test -w server -- --testPathPattern=transactions
```

Expected: all tests PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /Users/markmccall/finance-app && npm test -w server
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/markmccall/finance-app
git add server/src/routes/transactions.ts server/src/__tests__/transactions.test.ts
git commit -m "feat: add POST /api/transactions, PATCH cleared toggle, PUT splits"
```

---

### Task 4: Category management API

**Files:**
- Modify: `server/src/routes/categories.ts`
- Modify: `server/src/__tests__/categories.test.ts`

Rules:
- Cannot rename or deactivate `is_system = 1` (Uncategorized)
- Cannot deactivate a parent that still has active children
- Deactivate sets `is_active = 0` — does NOT delete (existing splits are preserved)
- Reorder: `POST /api/categories/reorder` with `{ categories: Array<{ id, sort_order }> }`

**Important:** Express matches routes in registration order. `POST /api/categories/reorder` must be registered before any route that could match `/categories/:id` — but since `/reorder` is a literal path on `POST` and the parameterized route `PATCH /:id` and `DELETE /:id` are different methods, there's no conflict. Still, register `/reorder` first in the file.

- [ ] **Step 1: Write failing tests (append to categories.test.ts)**

Add after the existing `describe('GET /api/categories', ...)` block:

```typescript
function getCategoryId(name: string): number {
  const row = getDb().prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }
  return row.id
}

describe('POST /api/categories', () => {
  test('creates a new child category', async () => {
    const foodId = getCategoryId('Food')
    const res = await request(app).post('/api/categories').send({ name: 'Bakery', parent_id: foodId })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    const cat = getDb().prepare('SELECT * FROM categories WHERE id = ?').get(res.body.id) as {
      name: string; parent_id: number
    }
    expect(cat.name).toBe('Bakery')
    expect(cat.parent_id).toBe(foodId)
  })

  test('creates a new top-level parent category', async () => {
    const res = await request(app).post('/api/categories').send({ name: 'Gifts' })
    expect(res.status).toBe(201)
    const cat = getDb().prepare(
      'SELECT parent_id FROM categories WHERE id = ?'
    ).get(res.body.id) as { parent_id: number | null }
    expect(cat.parent_id).toBeNull()
  })

  test('returns 400 for missing name', async () => {
    const res = await request(app).post('/api/categories').send({ parent_id: 1 })
    expect(res.status).toBe(400)
  })

  test('returns 400 when parent does not exist', async () => {
    const res = await request(app).post('/api/categories').send({ name: 'Ghost Child', parent_id: 9999 })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/categories/:id', () => {
  test('renames a category', async () => {
    const id = getCategoryId('Groceries')
    const res = await request(app).patch(`/api/categories/${id}`).send({ name: 'Supermarket' })
    expect(res.status).toBe(200)
    const cat = getDb().prepare(
      'SELECT name FROM categories WHERE id = ?'
    ).get(id) as { name: string }
    expect(cat.name).toBe('Supermarket')
  })

  test('returns 400 when renaming Uncategorized', async () => {
    const id = getCategoryId('Uncategorized')
    const res = await request(app).patch(`/api/categories/${id}`).send({ name: 'Something Else' })
    expect(res.status).toBe(400)
  })

  test('returns 404 for unknown category', async () => {
    const res = await request(app).patch('/api/categories/9999').send({ name: 'Ghost' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/categories/:id', () => {
  test('deactivates a leaf category', async () => {
    const id = getCategoryId('Groceries')
    const res = await request(app).delete(`/api/categories/${id}`)
    expect(res.status).toBe(200)
    const cat = getDb().prepare(
      'SELECT is_active FROM categories WHERE id = ?'
    ).get(id) as { is_active: number }
    expect(cat.is_active).toBe(0)
  })

  test('returns 400 when deleting Uncategorized', async () => {
    const id = getCategoryId('Uncategorized')
    const res = await request(app).delete(`/api/categories/${id}`)
    expect(res.status).toBe(400)
  })

  test('returns 400 when deleting a parent with active children', async () => {
    const id = getCategoryId('Food')
    const res = await request(app).delete(`/api/categories/${id}`)
    expect(res.status).toBe(400)
  })

  test('returns 404 for unknown category', async () => {
    const res = await request(app).delete('/api/categories/9999')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/categories/reorder', () => {
  test('updates sort_order for specified categories', async () => {
    const grocId = getCategoryId('Groceries')
    const diningId = getCategoryId('Dining Out')
    const res = await request(app).post('/api/categories/reorder').send({
      categories: [
        { id: grocId, sort_order: 10 },
        { id: diningId, sort_order: 20 },
      ],
    })
    expect(res.status).toBe(200)
    const groc = getDb().prepare(
      'SELECT sort_order FROM categories WHERE id = ?'
    ).get(grocId) as { sort_order: number }
    expect(groc.sort_order).toBe(10)
    const dining = getDb().prepare(
      'SELECT sort_order FROM categories WHERE id = ?'
    ).get(diningId) as { sort_order: number }
    expect(dining.sort_order).toBe(20)
  })

  test('returns 400 for empty categories array', async () => {
    const res = await request(app).post('/api/categories/reorder').send({ categories: [] })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
cd /Users/markmccall/finance-app && npm test -w server -- --testPathPattern=categories
```

Expected: GET tests PASS, POST/PATCH/DELETE/reorder tests FAIL.

- [ ] **Step 3: Implement category management routes**

Append to `server/src/routes/categories.ts` (register `/reorder` before parameterized routes):

```typescript
categoriesRouter.post('/reorder', (req: Request, res: Response) => {
  const db = getDb()
  const { categories } = req.body as { categories: Array<{ id: number; sort_order: number }> }
  if (!categories || categories.length === 0) {
    res.status(400).json({ error: 'categories array is required' })
    return
  }
  const update = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?')
  db.transaction(() => {
    for (const { id, sort_order } of categories) {
      update.run(sort_order, id)
    }
  })()
  res.json({ ok: true })
})

categoriesRouter.post('/', (req: Request, res: Response) => {
  const db = getDb()
  const { name, parent_id } = req.body as { name?: string; parent_id?: number }
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (parent_id !== undefined) {
    const parent = db.prepare('SELECT id FROM categories WHERE id = ?').get(parent_id)
    if (!parent) {
      res.status(400).json({ error: 'Parent category not found' })
      return
    }
  }
  const result = db.prepare(
    'INSERT INTO categories (name, parent_id, is_system, is_active, sort_order) VALUES (?, ?, 0, 1, 0)'
  ).run(name, parent_id ?? null)
  res.status(201).json({ id: result.lastInsertRowid })
})

categoriesRouter.patch('/:id', (req: Request, res: Response) => {
  const db = getDb()
  const id = Number(req.params.id)
  const cat = db.prepare(
    'SELECT id, is_system FROM categories WHERE id = ?'
  ).get(id) as { id: number; is_system: number } | undefined
  if (!cat) {
    res.status(404).json({ error: 'Category not found' })
    return
  }
  if (cat.is_system) {
    res.status(400).json({ error: 'Cannot rename system category' })
    return
  }
  const { name } = req.body as { name: string }
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id)
  res.json({ id })
})

categoriesRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb()
  const id = Number(req.params.id)
  const cat = db.prepare(
    'SELECT id, is_system FROM categories WHERE id = ?'
  ).get(id) as { id: number; is_system: number } | undefined
  if (!cat) {
    res.status(404).json({ error: 'Category not found' })
    return
  }
  if (cat.is_system) {
    res.status(400).json({ error: 'Cannot deactivate system category' })
    return
  }
  const activeChildren = db.prepare(
    'SELECT COUNT(*) as n FROM categories WHERE parent_id = ? AND is_active = 1'
  ).get(id) as { n: number }
  if (activeChildren.n > 0) {
    res.status(400).json({ error: 'Cannot deactivate a category with active children' })
    return
  }
  db.prepare('UPDATE categories SET is_active = 0 WHERE id = ?').run(id)
  res.json({ id })
})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/markmccall/finance-app && npm test -w server -- --testPathPattern=categories
```

Expected: all tests PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /Users/markmccall/finance-app && npm test -w server
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/markmccall/finance-app
git add server/src/routes/categories.ts server/src/__tests__/categories.test.ts
git commit -m "feat: add category management API (POST, PATCH, DELETE, reorder)"
```

---

### Task 5: Register page — layout, filters, transaction list

**Files:**
- Create: `client/src/Register.tsx`
- Modify: `client/src/App.tsx`

Builds the full Register page: account filter dropdown, category filter dropdown (with optgroup parent/child structure) + gear icon placeholder, desktop table (Date · Payee · Category · Amount · Balance · Cleared), mobile card list, and cleared toggle. No split editing or manual entry yet — those come in Tasks 7 and 8.

The `Category` interface must include `is_system`, `is_active`, and `sort_order` because `CategoryPanel` (Task 9) receives the same `categories` state.

- [ ] **Step 1: Create Register.tsx**

`client/src/Register.tsx`:
```tsx
import { useEffect, useState, useCallback } from 'react'

interface Account {
  id: number
  name: string
  type: string
  current_balance: number
}

interface Category {
  id: number
  name: string
  parent_id: number | null
  parent_name: string | null
  is_system: number
  is_active: number
  sort_order: number
}

interface Split {
  id: number
  category_id: number
  category_name: string
  parent_category_name: string | null
  amount: number
}

interface Transaction {
  id: number
  account_id: number
  account_name: string
  date: string
  payee: string
  amount: number
  is_cleared: number
  is_manual: number
  splits: Split[]
  running_balance: number
}

function fmtAmount(amount: number): string {
  const abs = Math.abs(amount).toFixed(2)
  return amount < 0 ? `-$${abs}` : `$${abs}`
}

function fmtBalance(balance: number): string {
  return `$${balance.toFixed(2)}`
}

function categoryLabel(tx: Transaction): string {
  if (tx.splits.length === 0) return 'Uncategorized'
  if (tx.splits.length === 1) return tx.splits[0].category_name
  return 'Split →'
}

export default function Register() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [selectedAccount, setSelectedAccount] = useState<number | ''>('')
  const [selectedCategory, setSelectedCategory] = useState<number | ''>('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(setAccounts)
    fetch('/api/categories').then(r => r.json()).then(setCategories)
  }, [])

  const loadTransactions = useCallback(() => {
    const params = new URLSearchParams()
    if (selectedAccount !== '') params.set('account_id', String(selectedAccount))
    if (selectedCategory !== '') params.set('category_id', String(selectedCategory))
    params.set('limit', String(limit))
    params.set('offset', String(offset))
    fetch(`/api/transactions?${params}`)
      .then(r => r.json())
      .then(data => {
        setTransactions(data.transactions)
        setTotal(data.total)
      })
  }, [selectedAccount, selectedCategory, offset])

  useEffect(() => {
    setOffset(0)
  }, [selectedAccount, selectedCategory])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  async function toggleCleared(tx: Transaction) {
    await fetch(`/api/transactions/${tx.id}/cleared`, { method: 'PATCH' })
    loadTransactions()
  }

  const parentCategories = categories.filter(c => c.parent_id === null && c.is_system === 0)
  const childCategories = categories.filter(c => c.parent_id !== null)

  return (
    <div className="p-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select
          className="border rounded px-2 py-1 text-sm"
          value={selectedAccount}
          onChange={e => setSelectedAccount(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">All Accounts</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <select
            className="border rounded px-2 py-1 text-sm"
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">All Categories</option>
            {parentCategories.map(p => (
              <optgroup key={p.id} label={p.name}>
                <option value={p.id}>{p.name} (all)</option>
                {childCategories
                  .filter(c => c.parent_id === p.id)
                  .map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
            title="Manage categories"
            onClick={() => {/* wired in Task 9 */}}
          >
            ⚙
          </button>
        </div>

        <span className="ml-auto text-sm text-gray-500">{total} transactions</span>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Payee</th>
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium text-right">Amount</th>
              <th className="py-2 pr-4 font-medium text-right">Balance</th>
              <th className="py-2 font-medium text-center">Cleared</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(tx => (
              <tr key={tx.id} className="border-b hover:bg-gray-50">
                <td className="py-2 pr-4 text-gray-600">{tx.date}</td>
                <td className="py-2 pr-4 font-medium">{tx.payee}</td>
                <td className="py-2 pr-4 text-gray-600">{categoryLabel(tx)}</td>
                <td className={`py-2 pr-4 text-right font-mono ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmtAmount(tx.amount)}
                </td>
                <td className="py-2 pr-4 text-right font-mono text-gray-700">
                  {fmtBalance(tx.running_balance)}
                </td>
                <td className="py-2 text-center">
                  <button
                    onClick={() => toggleCleared(tx)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto ${tx.is_cleared ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}
                    title={tx.is_cleared ? 'Mark uncleared' : 'Mark cleared'}
                  >
                    {tx.is_cleared ? '✓' : ''}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {transactions.map(tx => (
          <div key={tx.id} className="bg-white rounded border p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{tx.payee}</div>
              <div className="text-xs text-gray-500">{tx.date} · {fmtBalance(tx.running_balance)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{categoryLabel(tx)}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`font-mono text-sm ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {fmtAmount(tx.amount)}
              </span>
              <button
                onClick={() => toggleCleared(tx)}
                className={`w-6 h-6 rounded border-2 flex items-center justify-center ${tx.is_cleared ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}
              >
                {tx.is_cleared ? '✓' : ''}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="mt-4 flex gap-2 justify-center">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="px-3 py-1 text-sm border rounded disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500 self-center">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
            className="px-3 py-1 text-sm border rounded disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update App.tsx to import Register**

In `client/src/App.tsx`:

Remove this stub function:
```tsx
function Register() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Register</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
```

Add this import at the top (after the existing imports):
```tsx
import Register from './Register'
```

- [ ] **Step 3: Start dev server and verify in browser**

```bash
cd /Users/markmccall/finance-app && npm run dev
```

Navigate to `http://localhost:5173/register`. Verify:
- Account filter shows "Truist Checking" and "Truist Savings"
- Category filter shows parent groups with children in optgroups
- Transaction table shows 10 rows (all for Truist Checking by default)
- Amounts: red for negatives, green for Payroll income
- Balance column: first row shows $4,250.00 (Truist Checking current_balance)
- Cleared checkboxes: filled for cleared transactions, empty for Publix (today, uncleared)
- Clicking a cleared checkbox persists after reload
- Resize browser below 768px: cards replace table

- [ ] **Step 4: Commit**

```bash
cd /Users/markmccall/finance-app
git add client/src/Register.tsx client/src/App.tsx
git commit -m "feat: Register page with desktop table, mobile cards, account/category filters, cleared toggle"
```

---

### Task 6: CategoryPicker component

**Files:**
- Create: `client/src/CategoryPicker.tsx`

A searchable typeahead combobox. Displays leaf categories as "Parent · Child", top-level categories as just "Name". Filters by substring match on the full display path. Closes on outside click.

- [ ] **Step 1: Create CategoryPicker.tsx**

`client/src/CategoryPicker.tsx`:
```tsx
import { useState, useRef, useEffect } from 'react'

interface Category {
  id: number
  name: string
  parent_id: number | null
  parent_name: string | null
}

interface Props {
  categories: Category[]
  value: number | null
  onChange: (categoryId: number) => void
  placeholder?: string
}

function displayName(cat: Category): string {
  return cat.parent_name ? `${cat.parent_name} · ${cat.name}` : cat.name
}

export default function CategoryPicker({ categories, value, onChange, placeholder = 'Select category' }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = value !== null ? categories.find(c => c.id === value) : null

  const filtered = search.length === 0
    ? categories
    : categories.filter(c => displayName(c).toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function handleSelect(cat: Category) {
    onChange(cat.id)
    setOpen(false)
    setSearch('')
  }

  function handleButtonClick() {
    setOpen(prev => !prev)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleButtonClick}
        className="w-full text-left border rounded px-2 py-1 text-sm bg-white flex justify-between items-center gap-1"
      >
        <span className={selected ? '' : 'text-gray-400'}>
          {selected ? displayName(selected) : placeholder}
        </span>
        <span className="text-gray-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-white border rounded shadow-lg">
          <div className="p-2 border-b">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full text-sm border rounded px-2 py-1 outline-none"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
            )}
            {filtered.map(cat => (
              <li
                key={cat.id}
                onMouseDown={() => handleSelect(cat)}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 ${cat.id === value ? 'bg-indigo-100 font-medium' : ''}`}
              >
                {displayName(cat)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/markmccall/finance-app && npm run build -w client 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/markmccall/finance-app
git add client/src/CategoryPicker.tsx
git commit -m "feat: CategoryPicker searchable typeahead combobox"
```

---

### Task 7: Split entry and editing UI

**Files:**
- Modify: `client/src/Register.tsx`

Adds expandable split editing to each transaction. Clicking the category cell (desktop) or tapping the card body (mobile) expands the split editor below that row. The editor shows one row per split with a CategoryPicker + amount field, a running remainder counter, and an "Auto-fill to Uncategorized" button. Saves via `PUT /api/transactions/:id/splits`.

Only leaf categories (those with no children) are assignable to splits.

- [ ] **Step 1: Add SplitEditor component to Register.tsx**

Add these imports at the top of `Register.tsx`:
```tsx
import CategoryPicker from './CategoryPicker'
```

Add this component before the `Register` default export:

```tsx
interface SplitDraft {
  category_id: number | null
  amount: string
}

interface SplitEditorProps {
  tx: Transaction
  categories: Category[]
  onSaved: () => void
}

function SplitEditor({ tx, categories, onSaved }: SplitEditorProps) {
  const leafCategories = categories.filter(
    c => !categories.some(other => other.parent_id === c.id)
  )
  const uncategorized = categories.find(c => c.name === 'Uncategorized')

  const initialDrafts: SplitDraft[] = tx.splits.length > 0
    ? tx.splits.map(s => ({ category_id: s.category_id, amount: s.amount.toFixed(2) }))
    : [{ category_id: uncategorized?.id ?? null, amount: tx.amount.toFixed(2) }]

  const [drafts, setDrafts] = useState<SplitDraft[]>(initialDrafts)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const assignedSum = drafts.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0)
  const remainder = parseFloat((tx.amount - assignedSum).toFixed(2))

  function updateDraft(i: number, patch: Partial<SplitDraft>) {
    setDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }

  function addRow() {
    setDrafts(prev => [...prev, { category_id: null, amount: '' }])
  }

  function removeRow(i: number) {
    setDrafts(prev => prev.filter((_, idx) => idx !== i))
  }

  function autoFillRemainder() {
    if (!uncategorized || Math.abs(remainder) < 0.001) return
    setDrafts(prev => [...prev, { category_id: uncategorized.id, amount: remainder.toFixed(2) }])
  }

  async function save() {
    if (Math.abs(remainder) > 0.001) {
      setError(`Remaining $${remainder.toFixed(2)} must be $0.00 before saving`)
      return
    }
    if (drafts.some(d => d.category_id === null)) {
      setError('All rows must have a category selected')
      return
    }
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`/api/transactions/${tx.id}/splits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          splits: drafts.map(d => ({ category_id: d.category_id, amount: parseFloat(d.amount) })),
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
      <div className="space-y-2">
        {drafts.map((draft, i) => (
          <div key={i} className="flex gap-2 items-center">
            <div className="flex-1">
              <CategoryPicker
                categories={leafCategories}
                value={draft.category_id}
                onChange={catId => updateDraft(i, { category_id: catId })}
              />
            </div>
            <input
              type="number"
              step="0.01"
              value={draft.amount}
              onChange={e => updateDraft(i, { amount: e.target.value })}
              className="w-28 border rounded px-2 py-1 text-right text-sm font-mono"
            />
            {drafts.length > 1 && (
              <button
                onClick={() => removeRow(i)}
                className="text-gray-400 hover:text-red-500 text-lg leading-none"
                title="Remove row"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <button onClick={addRow} className="text-indigo-600 text-xs hover:underline">+ Add row</button>
        {Math.abs(remainder) > 0.001 && (
          <>
            <span className={`text-xs font-mono ${remainder < 0 ? 'text-red-500' : 'text-amber-600'}`}>
              Remaining: {remainder > 0 ? '+' : ''}{remainder.toFixed(2)}
            </span>
            <button onClick={autoFillRemainder} className="text-xs text-gray-500 hover:underline">
              Auto-fill to Uncategorized
            </button>
          </>
        )}
        {Math.abs(remainder) <= 0.001 && (
          <span className="text-xs text-green-600">✓ Balanced</span>
        )}
        <button
          onClick={save}
          disabled={saving || Math.abs(remainder) > 0.001}
          className="ml-auto bg-indigo-600 text-white text-xs px-3 py-1 rounded disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Add expandedTxId state and wire SplitEditor**

Add state at top of `Register` function body (after existing state):
```tsx
const [expandedTxId, setExpandedTxId] = useState<number | null>(null)
```

In the desktop table, replace the category `<td>` to be clickable:
```tsx
<td
  className="py-2 pr-4 text-gray-600 cursor-pointer hover:text-indigo-600"
  onClick={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
>
  {categoryLabel(tx)}
</td>
```

After the main `<tr>` for each transaction (still inside `transactions.map`), add an expansion row:
```tsx
{expandedTxId === tx.id && (
  <tr key={`${tx.id}-expand`}>
    <td colSpan={6} className="px-4 pb-3">
      <SplitEditor
        tx={tx}
        categories={categories}
        onSaved={() => { loadTransactions(); setExpandedTxId(null) }}
      />
    </td>
  </tr>
)}
```

In mobile cards, wrap the card body to be tappable and show SplitEditor conditionally. Replace the current mobile card markup with:
```tsx
<div key={tx.id} className="bg-white rounded border">
  <div
    className="p-3 flex items-start gap-3 cursor-pointer"
    onClick={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
  >
    <div className="flex-1 min-w-0">
      <div className="font-medium truncate">{tx.payee}</div>
      <div className="text-xs text-gray-500">{tx.date} · {fmtBalance(tx.running_balance)}</div>
      <div className="text-xs text-gray-400 mt-0.5">{categoryLabel(tx)}</div>
    </div>
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
    </div>
  </div>
  {expandedTxId === tx.id && (
    <div className="px-3 pb-3 border-t">
      <SplitEditor
        tx={tx}
        categories={categories}
        onSaved={() => { loadTransactions(); setExpandedTxId(null) }}
      />
    </div>
  )}
</div>
```

- [ ] **Step 3: Verify in browser**

```bash
cd /Users/markmccall/finance-app && npm run dev
```

Navigate to `/register`. Click a category cell on any transaction:
- SplitEditor expands below the row
- Since no splits are seeded, defaults to one row: "Uncategorized" with the full transaction amount
- CategoryPicker shows searchable dropdown: typing "groc" shows "Food · Groceries"
- Change to Groceries, click Save → category column updates to "Groceries"
- Click same row again → collapses
- Try a two-split: Add row, split amounts, click Auto-fill when remainder > 0
- Save disabled until remainder = 0
- Mobile: tap card body to expand, tap cleared button without expanding

- [ ] **Step 4: Commit**

```bash
cd /Users/markmccall/finance-app
git add client/src/Register.tsx
git commit -m "feat: split entry UI with CategoryPicker, remainder counter, auto-fill to Uncategorized"
```

---

### Task 8: Manual transaction entry form

**Files:**
- Modify: `client/src/Register.tsx`

Adds an "Add Transaction" button that reveals an inline form above the transaction list. Fields: Date (defaults to today), Payee, Account (required), Amount. Includes inline split editor. Submits via `POST /api/transactions` and refreshes the list on success.

- [ ] **Step 1: Add ManualEntryForm component to Register.tsx**

Add before the `Register` default export (after `SplitEditor`):

```tsx
interface ManualEntryFormProps {
  accounts: Account[]
  categories: Category[]
  onSaved: () => void
  onCancel: () => void
}

function ManualEntryForm({ accounts, categories, onSaved, onCancel }: ManualEntryFormProps) {
  const today = new Date().toISOString().slice(0, 10)
  const uncategorized = categories.find(c => c.name === 'Uncategorized')
  const leafCategories = categories.filter(
    c => !categories.some(other => other.parent_id === c.id)
  )

  const [date, setDate] = useState(today)
  const [payee, setPayee] = useState('')
  const [accountId, setAccountId] = useState<number | ''>(accounts[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [drafts, setDrafts] = useState<SplitDraft[]>([
    { category_id: uncategorized?.id ?? null, amount: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const parsedAmount = parseFloat(amount) || 0
  const assignedSum = drafts.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0)
  const remainder = parseFloat((parsedAmount - assignedSum).toFixed(2))

  function updateDraft(i: number, patch: Partial<SplitDraft>) {
    setDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }

  function addRow() {
    setDrafts(prev => [...prev, { category_id: null, amount: '' }])
  }

  function removeRow(i: number) {
    setDrafts(prev => prev.filter((_, idx) => idx !== i))
  }

  function autoFill() {
    if (!uncategorized || Math.abs(remainder) < 0.001) return
    setDrafts(prev => [...prev, { category_id: uncategorized.id, amount: remainder.toFixed(2) }])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!payee.trim()) { setError('Payee is required'); return }
    if (accountId === '') { setError('Account is required'); return }
    if (!parsedAmount) { setError('Amount is required'); return }
    if (drafts.some(d => d.category_id === null)) { setError('All splits need a category'); return }
    if (Math.abs(remainder) > 0.001) { setError('Splits must sum to transaction amount'); return }

    setSaving(true)
    setError('')
    try {
      const r = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: Number(accountId),
          date,
          payee: payee.trim(),
          amount: parsedAmount,
          splits: drafts.map(d => ({
            category_id: d.category_id,
            amount: parseFloat(d.amount),
          })),
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
    <form onSubmit={submit} className="mb-4 p-4 border rounded bg-white shadow-sm">
      <h3 className="font-semibold text-sm mb-3">New Transaction</h3>
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
      </div>

      <div className="text-xs text-gray-500 mb-1 font-medium">Splits</div>
      <div className="space-y-2 mb-2">
        {drafts.map((draft, i) => (
          <div key={i} className="flex gap-2 items-center">
            <div className="flex-1">
              <CategoryPicker
                categories={leafCategories}
                value={draft.category_id}
                onChange={catId => updateDraft(i, { category_id: catId })}
              />
            </div>
            <input
              type="number"
              step="0.01"
              value={draft.amount}
              onChange={e => updateDraft(i, { amount: e.target.value })}
              className="w-28 border rounded px-2 py-1 text-right text-sm font-mono"
            />
            {drafts.length > 1 && (
              <button type="button" onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500 text-lg">×</button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <button type="button" onClick={addRow} className="text-indigo-600 text-xs hover:underline">+ Add row</button>
        {Math.abs(remainder) > 0.001 && parsedAmount !== 0 && (
          <>
            <span className={`text-xs font-mono ${remainder < 0 ? 'text-red-500' : 'text-amber-600'}`}>
              Remaining: {remainder > 0 ? '+' : ''}{remainder.toFixed(2)}
            </span>
            <button type="button" onClick={autoFill} className="text-xs text-gray-500 hover:underline">
              Auto-fill to Uncategorized
            </button>
          </>
        )}
        {parsedAmount !== 0 && Math.abs(remainder) <= 0.001 && (
          <span className="text-xs text-green-600">✓ Balanced</span>
        )}
      </div>

      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm px-4 py-1.5 rounded border hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Add showEntryForm state and wire form into Register**

Add state at top of `Register` function body:
```tsx
const [showEntryForm, setShowEntryForm] = useState(false)
```

In the filters row, add "Add Transaction" button (before the transaction count span):
```tsx
<button
  onClick={() => setShowEntryForm(true)}
  className="bg-indigo-600 text-white text-sm px-3 py-1 rounded hover:bg-indigo-700"
>
  + Add Transaction
</button>
```

Between the filters `<div>` and the desktop table `<div>`, insert:
```tsx
{showEntryForm && (
  <ManualEntryForm
    accounts={accounts}
    categories={categories}
    onSaved={() => { loadTransactions(); setShowEntryForm(false) }}
    onCancel={() => setShowEntryForm(false)}
  />
)}
```

- [ ] **Step 3: Verify in browser**

```bash
cd /Users/markmccall/finance-app && npm run dev
```

Navigate to `/register`. Click "Add Transaction":
- Form appears above the list
- Enter date, payee (e.g. "Coffee Shop"), account, amount (e.g. -5.50)
- Amount field change resets split to one Uncategorized row with that amount
- Change category via CategoryPicker
- Save → new transaction appears at top of list with correct running balance
- Account current_balance updates (visible after next sync or page reload)
- Cancel closes form without saving

- [ ] **Step 4: Commit**

```bash
cd /Users/markmccall/finance-app
git add client/src/Register.tsx
git commit -m "feat: manual transaction entry form with inline split editor"
```

---

### Task 9: Category management panel

**Files:**
- Create: `client/src/CategoryPanel.tsx`
- Modify: `client/src/Register.tsx`

A slide-in panel from the right, opened by the gear icon. Shows all active categories grouped under their parent headers. Controls per category: rename (inline input), remove (deactivate), and reorder (↑/↓ buttons). "Uncategorized" shown at bottom, grayed, no controls. Changes call the category management API and trigger a categories reload in the Register.

- [ ] **Step 1: Create CategoryPanel.tsx**

`client/src/CategoryPanel.tsx`:
```tsx
import { useState } from 'react'

interface Category {
  id: number
  name: string
  parent_id: number | null
  parent_name: string | null
  is_system: number
  is_active: number
  sort_order: number
}

interface Props {
  categories: Category[]
  onClose: () => void
  onChanged: () => void
}

export default function CategoryPanel({ categories, onClose, onChanged }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [addingParentId, setAddingParentId] = useState<number | null | undefined>(undefined)
  const [newName, setNewName] = useState('')
  const [showAddTop, setShowAddTop] = useState(false)
  const [error, setError] = useState('')

  // undefined = not adding; null = adding top-level; number = adding child to that parent
  const parents = categories
    .filter(c => c.parent_id === null && c.is_system === 0)
    .sort((a, b) => a.sort_order - b.sort_order)
  const uncategorized = categories.find(c => c.is_system === 1)

  function childrenOf(parentId: number) {
    return categories
      .filter(c => c.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order)
  }

  async function rename(id: number) {
    if (!editName.trim()) return
    const r = await fetch(`/api/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() }),
    })
    if (r.ok) {
      setEditingId(null)
      setEditName('')
      onChanged()
    } else {
      const body = await r.json()
      setError(body.error ?? 'Rename failed')
    }
  }

  async function deactivate(id: number) {
    const r = await fetch(`/api/categories/${id}`, { method: 'DELETE' })
    if (r.ok) {
      onChanged()
    } else {
      const body = await r.json()
      setError(body.error ?? 'Remove failed')
    }
  }

  async function addCategory(name: string, parentId: number | null) {
    if (!name.trim()) return
    const payload: { name: string; parent_id?: number } = { name: name.trim() }
    if (parentId !== null) payload.parent_id = parentId
    const r = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.ok) {
      setNewName('')
      setAddingParentId(undefined)
      setShowAddTop(false)
      onChanged()
    } else {
      const body = await r.json()
      setError(body.error ?? 'Add failed')
    }
  }

  async function swap(catA: Category, catB: Category) {
    await fetch('/api/categories/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: [
          { id: catA.id, sort_order: catB.sort_order },
          { id: catB.id, sort_order: catA.sort_order },
        ],
      }),
    })
    onChanged()
  }

  function renderControls(cat: Category, siblings: Category[], isChild = false) {
    const idx = siblings.findIndex(c => c.id === cat.id)
    if (editingId === cat.id) {
      return (
        <div className={`flex items-center gap-2 py-1 ${isChild ? 'pl-4' : ''}`}>
          <input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') rename(cat.id)
              if (e.key === 'Escape') { setEditingId(null); setError('') }
            }}
            className="border rounded px-2 py-0.5 text-sm flex-1"
          />
          <button onClick={() => rename(cat.id)} className="text-xs text-indigo-600 hover:underline">Save</button>
          <button onClick={() => { setEditingId(null); setError('') }} className="text-xs text-gray-400 hover:underline">Cancel</button>
        </div>
      )
    }
    return (
      <div className={`flex items-center gap-1 py-1 ${isChild ? 'pl-4' : ''}`}>
        <span className="flex-1 text-sm">{cat.name}</span>
        <button
          onClick={() => idx > 0 && swap(cat, siblings[idx - 1])}
          disabled={idx === 0}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1 text-xs"
          title="Move up"
        >↑</button>
        <button
          onClick={() => idx < siblings.length - 1 && swap(cat, siblings[idx + 1])}
          disabled={idx === siblings.length - 1}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1 text-xs"
          title="Move down"
        >↓</button>
        <button
          onClick={() => { setEditingId(cat.id); setEditName(cat.name) }}
          className="text-xs text-gray-500 hover:text-indigo-600 px-1"
        >Rename</button>
        <button
          onClick={() => deactivate(cat.id)}
          className="text-xs text-gray-500 hover:text-red-600 px-1"
        >Remove</button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-80 bg-white shadow-xl overflow-y-auto flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="font-semibold">Manage Categories</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {error && (
          <div className="mx-4 mt-3 p-2 bg-red-50 text-red-700 text-xs rounded flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="underline ml-2">Dismiss</button>
          </div>
        )}

        <div className="p-4 flex-1">
          {parents.map(parent => {
            const children = childrenOf(parent.id)
            return (
              <div key={parent.id} className="mb-4">
                <div className="border-b pb-1 mb-1 font-medium text-sm">
                  {renderControls(parent, parents)}
                </div>
                {children.map(child => renderControls(child, children, true))}
                {addingParentId === parent.id ? (
                  <div className="pl-4 flex gap-2 mt-1">
                    <input
                      autoFocus
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') addCategory(newName, parent.id)
                        if (e.key === 'Escape') setAddingParentId(undefined)
                      }}
                      placeholder="Category name"
                      className="border rounded px-2 py-0.5 text-sm flex-1"
                    />
                    <button onClick={() => addCategory(newName, parent.id)} className="text-xs text-indigo-600">Add</button>
                    <button onClick={() => setAddingParentId(undefined)} className="text-xs text-gray-400">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingParentId(parent.id); setNewName('') }}
                    className="pl-4 text-xs text-indigo-500 hover:underline mt-0.5"
                  >
                    + Add child
                  </button>
                )}
              </div>
            )
          })}

          {showAddTop ? (
            <div className="flex gap-2 mt-2">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addCategory(newName, null)
                  if (e.key === 'Escape') setShowAddTop(false)
                }}
                placeholder="New category name"
                className="border rounded px-2 py-0.5 text-sm flex-1"
              />
              <button onClick={() => addCategory(newName, null)} className="text-xs text-indigo-600">Add</button>
              <button onClick={() => setShowAddTop(false)} className="text-xs text-gray-400">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => { setShowAddTop(true); setNewName('') }}
              className="text-xs text-indigo-500 hover:underline mt-2"
            >
              + Add top-level category
            </button>
          )}

          {uncategorized && (
            <div className="mt-6 pt-4 border-t">
              <span className="text-sm text-gray-400 italic">{uncategorized.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire gear icon in Register.tsx**

Add import at top of `Register.tsx`:
```tsx
import CategoryPanel from './CategoryPanel'
```

Add state at top of `Register` function body:
```tsx
const [showCategoryPanel, setShowCategoryPanel] = useState(false)
```

Update the gear icon button's `onClick`:
```tsx
onClick={() => setShowCategoryPanel(true)}
```

Add the panel render at the very end of the `Register` return, inside the outer `<div className="p-4">`:
```tsx
{showCategoryPanel && (
  <CategoryPanel
    categories={categories}
    onClose={() => setShowCategoryPanel(false)}
    onChanged={() => {
      fetch('/api/categories').then(r => r.json()).then(setCategories)
      loadTransactions()
    }}
  />
)}
```

- [ ] **Step 3: Verify in browser**

```bash
cd /Users/markmccall/finance-app && npm run dev
```

Navigate to `/register`. Click ⚙:
- Panel slides in from the right with semi-transparent backdrop
- All 7 parent categories listed with their children below
- Click Rename on "Groceries" → inline input appears → type new name → press Enter → panel updates, category filter dropdown updates
- Click Remove on a leaf category → it disappears from panel and filter dropdown
- Click ↑/↓ on a category → order updates (verify GET /api/categories returns new order)
- Click "+ Add child" under Food → enter "Bakery" → appears in Food children and in CategoryPicker
- Click "+ Add top-level category" → enter "Savings" → appears as new parent
- "Uncategorized" at bottom: grayed, italic, no buttons
- Click backdrop or × to close panel

- [ ] **Step 4: Run full test suite**

```bash
cd /Users/markmccall/finance-app && npm test -w server
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/markmccall/finance-app
git add client/src/CategoryPanel.tsx client/src/Register.tsx
git commit -m "feat: category management panel with add, rename, reorder, and deactivate"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task(s) |
|---|---|
| Transaction list, newest first, with running balance | Task 2 (API), Task 5 (UI) |
| Desktop columns: Date · Payee · Category · Amount · Balance · Cleared | Task 5 |
| Mobile: card per tx, tap cleared, tap body to expand splits | Task 5 (cards + cleared), Task 7 (expand) |
| Account filter dropdown | Task 1 (API), Task 5 (UI) |
| Category filter: All / specific / parent shows children | Task 2 (parent expansion), Task 5 (optgroup UI) |
| Cleared/uncleared — tappable | Task 3 (PATCH), Task 5 (toggle button) |
| Manual transaction entry | Task 3 (POST), Task 8 (UI form) |
| Category column: name or "Split →" | Task 5 (`categoryLabel` helper) |
| Gear icon opens category management | Task 9 |
| Category picker: searchable typeahead, "Parent · Child" path | Task 6 |
| Split entry: picker + amount per row, remainder counter, auto-fill | Task 7 |
| Cannot save until remaining = $0.00 | Task 7 (Save button disabled) |
| Category management: add, rename, reorder, deactivate | Task 4 (API), Task 9 (UI) |
| Uncategorized not editable | Task 4 (400 on system cat), Task 9 (no controls rendered) |

**Placeholder scan:** No TBDs or incomplete sections.

**Type consistency:**
- `Category` interface in `Register.tsx` includes `is_system`, `is_active`, `sort_order` — matches what `CategoryPanel.tsx` expects. ✓
- `SplitDraft` defined once before `SplitEditor`, reused in `ManualEntryForm`. ✓
- `addingParentId` uses `number | null | undefined` — `undefined` = not adding, `null` = adding top-level, `number` = adding child. ✓

All 14 spec requirements have corresponding implementation tasks.
