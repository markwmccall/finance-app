# Phase 1b — Plaid Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up Plaid Link, token exchange, transaction sync (cursor loop), and account status — plus the Accounts view that drives it all.

**Architecture:** Server-side: a `plaid-client.ts` singleton wraps the Plaid SDK; a `routes/plaid.ts` router handles four endpoints (link-token, exchange-token, sync, status); each route uses `getDb()` for SQLite. The sync route calls Plaid outside a DB transaction, then commits everything atomically. Client-side: `Accounts.tsx` uses `react-plaid-link` (already installed) to open Link, exchange tokens, display status, and trigger sync.

**Tech Stack:** plaid-node ^24 (already installed), react-plaid-link ^3.5.2 (already installed), supertest + jest (already installed), better-sqlite3 in-memory DB for route tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/src/plaid-client.ts` | Create | PlaidApi singleton factory |
| `server/src/routes/plaid.ts` | Create | Four route handlers |
| `server/src/__tests__/plaid.test.ts` | Create | Route tests with mocked Plaid SDK |
| `server/src/routes/index.ts` | Modify | Mount plaid router |
| `client/src/Accounts.tsx` | Create | Accounts view with Link, Sync Now, re-auth |
| `client/src/App.tsx` | Modify | Import Accounts from new file |

---

## Task 1: Plaid client singleton

**Files:**
- Create: `server/src/plaid-client.ts`
- Test: `server/src/__tests__/plaid-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/__tests__/plaid-client.test.ts
import { getPlaidClient } from '../plaid-client'

test('getPlaidClient returns a PlaidApi instance', () => {
  process.env.PLAID_CLIENT_ID = 'test-client-id'
  process.env.PLAID_SECRET = 'test-secret'
  process.env.PLAID_ENV = 'sandbox'
  const client = getPlaidClient()
  expect(client).toBeDefined()
  expect(typeof client.linkTokenCreate).toBe('function')
  expect(typeof client.transactionsSync).toBe('function')
})

test('getPlaidClient returns the same instance on second call', () => {
  process.env.PLAID_CLIENT_ID = 'test-client-id'
  process.env.PLAID_SECRET = 'test-secret'
  process.env.PLAID_ENV = 'sandbox'
  const a = getPlaidClient()
  const b = getPlaidClient()
  expect(a).toBe(b)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx jest src/__tests__/plaid-client.test.ts --no-coverage
```
Expected: FAIL — `getPlaidClient` not found.

- [ ] **Step 3: Write implementation**

```typescript
// server/src/plaid-client.ts
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

let client: PlaidApi | null = null

export function getPlaidClient(): PlaidApi {
  if (client) return client
  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID ?? '',
        'PLAID-SECRET': process.env.PLAID_SECRET ?? '',
      },
    },
  })
  client = new PlaidApi(config)
  return client
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && npx jest src/__tests__/plaid-client.test.ts --no-coverage
```
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/plaid-client.ts server/src/__tests__/plaid-client.test.ts
git commit -m "feat: add Plaid client singleton"
```

---

## Task 2: Link token route

**Files:**
- Create: `server/src/routes/plaid.ts` (router with first route only)
- Create: `server/src/__tests__/plaid.test.ts` (first test block only)

The link token route has two modes:
- **Initial connection** (no body or `item_id` absent): create a link token with `products: [Products.Transactions]`
- **Update mode / re-auth** (`item_id` in body): look up the item's `access_token`, create an update-mode link token (no `products` key — Plaid errors if you include it in update mode)

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/__tests__/plaid.test.ts
import request from 'supertest'
import { app } from '../index'
import { createDb, getDb, closeDb } from '../db'
import { createTables, seedTestData, seedCategories } from '../schema'
import * as plaidClientModule from '../plaid-client'

jest.mock('../plaid-client')

const mockLinkTokenCreate = jest.fn()
const mockExchangeToken = jest.fn()
const mockAccountsGet = jest.fn()
const mockTransactionsSync = jest.fn()

const mockClient = {
  linkTokenCreate: mockLinkTokenCreate,
  itemPublicTokenExchange: mockExchangeToken,
  accountsGet: mockAccountsGet,
  transactionsSync: mockTransactionsSync,
}

beforeEach(() => {
  createDb(':memory:')
  createTables(getDb())
  seedCategories(getDb())
  ;(plaidClientModule.getPlaidClient as jest.Mock).mockReturnValue(mockClient)
})

afterEach(() => {
  closeDb()
  jest.clearAllMocks()
})

describe('POST /api/plaid/link-token', () => {
  test('returns link_token for initial connection', async () => {
    mockLinkTokenCreate.mockResolvedValueOnce({
      data: { link_token: 'link-sandbox-abc123' },
    })
    const res = await request(app).post('/api/plaid/link-token').send({})
    expect(res.status).toBe(200)
    expect(res.body.link_token).toBe('link-sandbox-abc123')
    expect(mockLinkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ products: expect.arrayContaining(['transactions']) })
    )
  })

  test('returns update-mode link_token when item_id provided', async () => {
    seedTestData(getDb())
    // item id=1 is seeded by seedTestData (Truist)
    mockLinkTokenCreate.mockResolvedValueOnce({
      data: { link_token: 'link-sandbox-update-mode' },
    })
    const res = await request(app).post('/api/plaid/link-token').send({ item_id: 1 })
    expect(res.status).toBe(200)
    expect(res.body.link_token).toBe('link-sandbox-update-mode')
    // update mode: access_token present, NO products key
    const callArg = mockLinkTokenCreate.mock.calls[0][0]
    expect(callArg.access_token).toBeDefined()
    expect(callArg.products).toBeUndefined()
  })

  test('returns 404 when item_id does not exist', async () => {
    const res = await request(app).post('/api/plaid/link-token').send({ item_id: 999 })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx jest src/__tests__/plaid.test.ts --no-coverage
```
Expected: FAIL — route `/api/plaid/link-token` not found.

- [ ] **Step 3: Write implementation**

```typescript
// server/src/routes/plaid.ts
import { Router } from 'express'
import { Products, CountryCode } from 'plaid'
import { getPlaidClient } from '../plaid-client'
import { getDb } from '../db'

export const plaidRouter = Router()

// POST /api/plaid/link-token
// Body: {} for initial connection, { item_id: number } for re-auth update mode
plaidRouter.post('/link-token', async (req, res) => {
  try {
    const { item_id } = req.body as { item_id?: number }
    const plaid = getPlaidClient()

    if (item_id != null) {
      // Update mode: look up access_token for re-auth
      const item = getDb()
        .prepare('SELECT access_token FROM plaid_items WHERE id = ?')
        .get(item_id) as { access_token: string } | undefined
      if (!item) {
        res.status(404).json({ error: 'Item not found' })
        return
      }
      const response = await plaid.linkTokenCreate({
        user: { client_user_id: 'local-user' },
        client_name: process.env.VITE_APP_NAME ?? 'Finance',
        access_token: item.access_token,
        country_codes: [CountryCode.Us],
        language: 'en',
      })
      res.json({ link_token: response.data.link_token })
      return
    }

    // Initial connection
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: 'local-user' },
      client_name: process.env.VITE_APP_NAME ?? 'Finance',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    })
    res.json({ link_token: response.data.link_token })
  } catch (err) {
    console.error('link-token error:', err)
    res.status(500).json({ error: 'Failed to create link token' })
  }
})
```

Mount the plaid router temporarily so the tests can hit it. Add to `server/src/routes/index.ts`:

```typescript
// server/src/routes/index.ts
import { Router } from 'express'
import { getDb } from '../db'
import { plaidRouter } from './plaid'

export const router = Router()

router.get('/health', (_req, res) => {
  const db = getDb()
  const result = db.prepare("SELECT 'ok' AS status").get() as { status: string }
  res.json(result)
})

router.use('/plaid', plaidRouter)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && npx jest src/__tests__/plaid.test.ts --no-coverage -t "link-token"
```
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/plaid.ts server/src/routes/index.ts server/src/__tests__/plaid.test.ts
git commit -m "feat: add Plaid link-token route"
```

---

## Task 3: Exchange token route

**Files:**
- Modify: `server/src/routes/plaid.ts` (add exchange-token route)
- Modify: `server/src/__tests__/plaid.test.ts` (add exchange-token tests)

This route:
1. Calls `itemPublicTokenExchange` to get the `access_token` and `item_id`
2. Calls `accountsGet` with the new access_token to get account list
3. Writes to DB in a single transaction: upsert `plaid_items`, upsert each `account`
4. Returns the new item and accounts

Amount convention: Plaid amounts are **positive for debits** (money out), **negative for credits** (money in). We store amounts with the **opposite sign**: negative for debits, positive for credits. This matches standard accounting — `balance = starting_balance + SUM(amount)` works correctly.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/__tests__/plaid.test.ts`:

```typescript
describe('POST /api/plaid/exchange-token', () => {
  test('exchanges public token and stores item + accounts', async () => {
    mockExchangeToken.mockResolvedValueOnce({
      data: { access_token: 'access-sandbox-xyz', item_id: 'plaid-item-abc' },
    })
    mockAccountsGet.mockResolvedValueOnce({
      data: {
        accounts: [
          {
            account_id: 'acc-001',
            name: 'Gold Standard Checking',
            type: 'depository',
            subtype: 'checking',
            mask: '1234',
            balances: { current: 1500.00 },
          },
        ],
      },
    })

    const res = await request(app)
      .post('/api/plaid/exchange-token')
      .send({ public_token: 'public-sandbox-token', institution_name: 'First National Bank' })

    expect(res.status).toBe(200)
    expect(res.body.item_id).toBeDefined()
    expect(res.body.accounts).toHaveLength(1)
    expect(res.body.accounts[0].name).toBe('Gold Standard Checking')

    // Verify DB writes
    const db = getDb()
    const item = db.prepare("SELECT * FROM plaid_items WHERE plaid_item_id = 'plaid-item-abc'").get() as any
    expect(item).toBeDefined()
    expect(item.institution_name).toBe('First National Bank')
    expect(item.access_token).toBe('access-sandbox-xyz')
    expect(item.status).toBe('active')

    const accounts = db.prepare('SELECT * FROM accounts WHERE plaid_item_id = ?').all(item.id) as any[]
    expect(accounts).toHaveLength(1)
    expect(accounts[0].plaid_account_id).toBe('acc-001')
    expect(accounts[0].current_balance).toBe(1500.00)
  })

  test('returns 400 when public_token missing', async () => {
    const res = await request(app).post('/api/plaid/exchange-token').send({})
    expect(res.status).toBe(400)
  })

  test('re-connecting an existing institution upserts without duplicating', async () => {
    mockExchangeToken.mockResolvedValueOnce({
      data: { access_token: 'access-sandbox-new', item_id: 'plaid-item-abc' },
    })
    mockAccountsGet.mockResolvedValueOnce({
      data: {
        accounts: [
          {
            account_id: 'acc-001',
            name: 'Gold Standard Checking',
            type: 'depository',
            subtype: 'checking',
            mask: '1234',
            balances: { current: 2000.00 },
          },
        ],
      },
    })

    // First connect
    mockExchangeToken.mockResolvedValueOnce({
      data: { access_token: 'access-sandbox-old', item_id: 'plaid-item-abc' },
    })
    mockAccountsGet.mockResolvedValueOnce({
      data: {
        accounts: [
          {
            account_id: 'acc-001',
            name: 'Gold Standard Checking',
            type: 'depository',
            subtype: 'checking',
            mask: '1234',
            balances: { current: 1000.00 },
          },
        ],
      },
    })
    await request(app)
      .post('/api/plaid/exchange-token')
      .send({ public_token: 'public-token-1', institution_name: 'First National Bank' })

    // Re-connect (mock already set up above as first mock)
    mockExchangeToken.mockResolvedValueOnce({
      data: { access_token: 'access-sandbox-new', item_id: 'plaid-item-abc' },
    })
    mockAccountsGet.mockResolvedValueOnce({
      data: {
        accounts: [
          {
            account_id: 'acc-001',
            name: 'Gold Standard Checking',
            type: 'depository',
            subtype: 'checking',
            mask: '1234',
            balances: { current: 2000.00 },
          },
        ],
      },
    })
    await request(app)
      .post('/api/plaid/exchange-token')
      .send({ public_token: 'public-token-2', institution_name: 'First National Bank' })

    const db = getDb()
    const itemCount = (db.prepare("SELECT COUNT(*) as n FROM plaid_items WHERE plaid_item_id = 'plaid-item-abc'").get() as any).n
    expect(itemCount).toBe(1)
    const accCount = (db.prepare("SELECT COUNT(*) as n FROM accounts WHERE plaid_account_id = 'acc-001'").get() as any).n
    expect(accCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx jest src/__tests__/plaid.test.ts --no-coverage -t "exchange-token"
```
Expected: FAIL — `POST /api/plaid/exchange-token` returns 404.

- [ ] **Step 3: Write implementation**

Append to `server/src/routes/plaid.ts` after the link-token route:

```typescript
// POST /api/plaid/exchange-token
// Body: { public_token: string, institution_name: string }
plaidRouter.post('/exchange-token', async (req, res) => {
  const { public_token, institution_name } = req.body as {
    public_token?: string
    institution_name?: string
  }
  if (!public_token) {
    res.status(400).json({ error: 'public_token is required' })
    return
  }

  try {
    const plaid = getPlaidClient()

    const exchangeRes = await plaid.itemPublicTokenExchange({ public_token })
    const { access_token, item_id: plaid_item_id } = exchangeRes.data

    const accountsRes = await plaid.accountsGet({ access_token })
    const plaidAccounts = accountsRes.data.accounts

    const db = getDb()

    const upsertItem = db.prepare(`
      INSERT INTO plaid_items (institution_name, plaid_item_id, access_token, status)
      VALUES (@institution_name, @plaid_item_id, @access_token, 'active')
      ON CONFLICT(plaid_item_id) DO UPDATE SET
        access_token = excluded.access_token,
        status = 'active'
    `)

    const upsertAccount = db.prepare(`
      INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, subtype, mask, current_balance)
      VALUES (@plaid_item_id, @plaid_account_id, @name, @type, @subtype, @mask, @current_balance)
      ON CONFLICT(plaid_account_id) DO UPDATE SET
        name = excluded.name,
        current_balance = excluded.current_balance,
        mask = excluded.mask,
        plaid_item_id = excluded.plaid_item_id
    `)

    const result = db.transaction(() => {
      upsertItem.run({ institution_name: institution_name ?? 'Unknown', plaid_item_id, access_token })
      const item = db.prepare('SELECT id FROM plaid_items WHERE plaid_item_id = ?').get(plaid_item_id) as { id: number }
      for (const acct of plaidAccounts) {
        upsertAccount.run({
          plaid_item_id: item.id,
          plaid_account_id: acct.account_id,
          name: acct.name,
          type: acct.type,
          subtype: acct.subtype ?? null,
          mask: acct.mask ?? null,
          current_balance: acct.balances.current ?? 0,
        })
      }
      return item
    })()

    const savedAccounts = db
      .prepare('SELECT id, name, type, subtype, mask, current_balance FROM accounts WHERE plaid_item_id = ?')
      .all(result.id) as Array<{ id: number; name: string; type: string; subtype: string | null; mask: string | null; current_balance: number }>

    res.json({ item_id: result.id, accounts: savedAccounts })
  } catch (err) {
    console.error('exchange-token error:', err)
    res.status(500).json({ error: 'Failed to exchange token' })
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && npx jest src/__tests__/plaid.test.ts --no-coverage -t "exchange-token"
```
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/plaid.ts server/src/__tests__/plaid.test.ts
git commit -m "feat: add Plaid exchange-token route"
```

---

## Task 4: Sync route

**Files:**
- Modify: `server/src/routes/plaid.ts` (add sync route)
- Modify: `server/src/__tests__/plaid.test.ts` (add sync tests)

This is the most complex route. The exact sequence for each active `plaid_item`:

1. Call `accountsGet` → get current balances
2. Call `transactionsSync` in a cursor loop until `has_more = false`, accumulating `added`, `modified`, `removed` arrays
3. Open a **single SQLite transaction** and:
   - Upsert each added/modified transaction
   - Soft-delete each removed transaction (`is_removed = 1`)
   - Update each account's `current_balance`
   - Update `plaid_items.cursor` and `plaid_items.last_synced_at`
4. If the Plaid SDK throws with `error_code = 'ITEM_LOGIN_REQUIRED'`: set item status to `needs_reauth`, continue to next item

Amount sign convention (critical): Plaid stores **positive = debit (money out), negative = credit (money in)**. We store the **negated value**: `amount = -(plaid_amount)`. This means in our DB, expenses are negative and income is positive — matching standard accounting. The running balance formula is: `balance = starting_balance + SUM(amount)`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/__tests__/plaid.test.ts`:

```typescript
describe('POST /api/plaid/sync', () => {
  function seedItem(db: ReturnType<typeof getDb>) {
    db.prepare(`
      INSERT INTO plaid_items (id, institution_name, plaid_item_id, access_token, status, cursor)
      VALUES (10, 'Test Bank', 'item-xxx', 'access-token-xxx', 'active', NULL)
    `).run()
    db.prepare(`
      INSERT INTO accounts (id, plaid_item_id, plaid_account_id, name, type, current_balance)
      VALUES (20, 10, 'acct-aaa', 'Checking', 'depository', 500)
    `).run()
  }

  test('runs cursor loop until has_more is false', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    // First page: has_more = true
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-1', account_id: 'acct-aaa', date: '2026-05-01', name: 'Coffee', amount: 5.00, pending: false }],
        modified: [],
        removed: [],
        has_more: true,
        next_cursor: 'cursor-page-2',
      },
    })
    // Second page: has_more = false
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-2', account_id: 'acct-aaa', date: '2026-05-02', name: 'Salary', amount: -2000.00, pending: false }],
        modified: [],
        removed: [],
        has_more: false,
        next_cursor: 'cursor-page-3',
      },
    })

    const res = await request(app).post('/api/plaid/sync').send({})
    expect(res.status).toBe(200)
    expect(mockTransactionsSync).toHaveBeenCalledTimes(2)
    // Second call must pass the cursor from the first response
    expect(mockTransactionsSync.mock.calls[1][0].cursor).toBe('cursor-page-2')

    const db = getDb()
    const txs = db.prepare('SELECT * FROM transactions WHERE account_id = 20').all() as any[]
    expect(txs).toHaveLength(2)
    // tx-1: Plaid amount 5.00 (debit) → stored as -5.00
    const coffee = txs.find((t: any) => t.plaid_transaction_id === 'tx-1')
    expect(coffee?.amount).toBeCloseTo(-5.00)
    // tx-2: Plaid amount -2000.00 (credit) → stored as +2000.00
    const salary = txs.find((t: any) => t.plaid_transaction_id === 'tx-2')
    expect(salary?.amount).toBeCloseTo(2000.00)
  })

  test('soft-deletes removed transactions', async () => {
    seedItem(getDb())
    // Seed an existing transaction to be removed
    getDb().prepare(`
      INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount)
      VALUES (20, 'tx-old', '2026-04-01', 'Old Merchant', -10)
    `).run()

    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [],
        modified: [],
        removed: [{ transaction_id: 'tx-old' }],
        has_more: false,
        next_cursor: 'cursor-x',
      },
    })

    await request(app).post('/api/plaid/sync').send({})

    const db = getDb()
    const tx = db.prepare("SELECT is_removed FROM transactions WHERE plaid_transaction_id = 'tx-old'").get() as any
    expect(tx?.is_removed).toBe(1)
  })

  test('updates account balance and cursor in a single DB transaction', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 999.99 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cursor-final' },
    })

    await request(app).post('/api/plaid/sync').send({})

    const db = getDb()
    const account = db.prepare('SELECT current_balance FROM accounts WHERE id = 20').get() as any
    expect(account.current_balance).toBeCloseTo(999.99)

    const item = db.prepare('SELECT cursor, last_synced_at FROM plaid_items WHERE id = 10').get() as any
    expect(item.cursor).toBe('cursor-final')
    expect(item.last_synced_at).not.toBeNull()
  })

  test('sets needs_reauth status on ITEM_LOGIN_REQUIRED', async () => {
    seedItem(getDb())
    const plaidError = {
      response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } },
    }
    mockAccountsGet.mockRejectedValueOnce(plaidError)

    const res = await request(app).post('/api/plaid/sync').send({})
    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe('needs_reauth')

    const db = getDb()
    const item = db.prepare('SELECT status FROM plaid_items WHERE id = 10').get() as any
    expect(item.status).toBe('needs_reauth')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx jest src/__tests__/plaid.test.ts --no-coverage -t "sync"
```
Expected: FAIL — `POST /api/plaid/sync` returns 404.

- [ ] **Step 3: Write implementation**

Append to `server/src/routes/plaid.ts`:

```typescript
// POST /api/plaid/sync
// Syncs all active plaid_items. Returns per-item results.
plaidRouter.post('/sync', async (_req, res) => {
  const db = getDb()
  const items = db.prepare(
    "SELECT id, plaid_item_id, access_token, cursor FROM plaid_items WHERE status != 'needs_reauth'"
  ).all() as Array<{ id: number; plaid_item_id: string; access_token: string; cursor: string | null }>

  const results: Array<{ id: number; status: string; added?: number; modified?: number; removed?: number }> = []

  for (const item of items) {
    try {
      const plaid = getPlaidClient()

      // Step 1: Get current account balances
      const accountsRes = await plaid.accountsGet({ access_token: item.access_token })
      const plaidAccounts = accountsRes.data.accounts

      // Step 2: Cursor loop — accumulate all pages
      const added: Array<{ transaction_id: string; account_id: string; date: string; name: string; merchant_name?: string | null; amount: number; pending: boolean }> = []
      const modified: typeof added = []
      const removed: Array<{ transaction_id: string }> = []
      let cursor = item.cursor ?? undefined
      let hasMore = true

      while (hasMore) {
        const syncRes = await plaid.transactionsSync({
          access_token: item.access_token,
          cursor,
        })
        const page = syncRes.data
        added.push(...(page.added as typeof added))
        modified.push(...(page.modified as typeof added))
        removed.push(...(page.removed as typeof removed))
        hasMore = page.has_more
        cursor = page.next_cursor
      }

      // Step 3: Build account_id lookup (plaid_account_id → local id)
      const accountRows = db
        .prepare('SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id = ?')
        .all(item.id) as Array<{ id: number; plaid_account_id: string }>
      const accountIdMap = new Map(accountRows.map((r) => [r.plaid_account_id, r.id]))

      // Step 4: Single DB transaction
      const upsertTx = db.prepare(`
        INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount, is_cleared)
        VALUES (@account_id, @plaid_transaction_id, @date, @payee, @amount, @is_cleared)
        ON CONFLICT(plaid_transaction_id) DO UPDATE SET
          date = excluded.date,
          payee = excluded.payee,
          amount = excluded.amount,
          is_cleared = excluded.is_cleared,
          is_removed = 0
      `)
      const softDelete = db.prepare(
        'UPDATE transactions SET is_removed = 1 WHERE plaid_transaction_id = ?'
      )
      const updateBalance = db.prepare(
        'UPDATE accounts SET current_balance = ? WHERE plaid_account_id = ?'
      )
      const updateItem = db.prepare(
        "UPDATE plaid_items SET cursor = ?, last_synced_at = datetime('now') WHERE id = ?"
      )

      db.transaction(() => {
        for (const tx of [...added, ...modified]) {
          const accountId = accountIdMap.get(tx.account_id)
          if (accountId == null) continue
          upsertTx.run({
            account_id: accountId,
            plaid_transaction_id: tx.transaction_id,
            date: tx.date,
            payee: tx.merchant_name ?? tx.name,
            amount: -(tx.amount),  // negate: Plaid positive=debit, we store negative=debit
            is_cleared: tx.pending ? 0 : 1,
          })
        }
        for (const rt of removed) {
          softDelete.run(rt.transaction_id)
        }
        for (const acct of plaidAccounts) {
          updateBalance.run(acct.balances.current ?? 0, acct.account_id)
        }
        updateItem.run(cursor ?? null, item.id)
      })()

      results.push({ id: item.id, status: 'ok', added: added.length, modified: modified.length, removed: removed.length })
    } catch (err: unknown) {
      const plaidErr = err as { response?: { data?: { error_code?: string } } }
      if (plaidErr.response?.data?.error_code === 'ITEM_LOGIN_REQUIRED') {
        db.prepare("UPDATE plaid_items SET status = 'needs_reauth' WHERE id = ?").run(item.id)
        results.push({ id: item.id, status: 'needs_reauth' })
        continue
      }
      console.error(`sync error for item ${item.id}:`, err)
      results.push({ id: item.id, status: 'error' })
    }
  }

  res.json({ results })
})
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && npx jest src/__tests__/plaid.test.ts --no-coverage -t "sync"
```
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/plaid.ts server/src/__tests__/plaid.test.ts
git commit -m "feat: add Plaid sync route with cursor loop and atomic DB writes"
```

---

## Task 5: Status route

**Files:**
- Modify: `server/src/routes/plaid.ts` (add status route)
- Modify: `server/src/__tests__/plaid.test.ts` (add status tests)

- [ ] **Step 1: Write the failing tests**

Append to `server/src/__tests__/plaid.test.ts`:

```typescript
describe('GET /api/plaid/status', () => {
  test('returns empty array when no items connected', async () => {
    const res = await request(app).get('/api/plaid/status')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  test('returns items with account_count and last_synced_at', async () => {
    const db = getDb()
    db.prepare(`
      INSERT INTO plaid_items (id, institution_name, plaid_item_id, access_token, status, last_synced_at)
      VALUES (50, 'Truist', 'item-truist', 'access-truist', 'active', '2026-05-10 12:00:00')
    `).run()
    db.prepare(`
      INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, current_balance, is_active)
      VALUES (50, 'acct-t1', 'Checking', 'depository', 1200, 1),
             (50, 'acct-t2', 'Savings', 'depository', 3000, 1)
    `).run()

    const res = await request(app).get('/api/plaid/status')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    const item = res.body.items[0]
    expect(item.institution_name).toBe('Truist')
    expect(item.status).toBe('active')
    expect(item.account_count).toBe(2)
    expect(item.last_synced_at).toBe('2026-05-10 12:00:00')
  })

  test('returns needs_reauth status correctly', async () => {
    const db = getDb()
    db.prepare(`
      INSERT INTO plaid_items (id, institution_name, plaid_item_id, access_token, status)
      VALUES (51, 'Ally', 'item-ally', 'access-ally', 'needs_reauth')
    `).run()

    const res = await request(app).get('/api/plaid/status')
    expect(res.body.items[0].status).toBe('needs_reauth')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npx jest src/__tests__/plaid.test.ts --no-coverage -t "status"
```
Expected: FAIL — `GET /api/plaid/status` returns 404.

- [ ] **Step 3: Write implementation**

Append to `server/src/routes/plaid.ts`:

```typescript
// GET /api/plaid/status
// Returns all connected plaid_items with account count and last sync time
plaidRouter.get('/status', (_req, res) => {
  const db = getDb()
  const items = db.prepare(`
    SELECT
      pi.id,
      pi.institution_name,
      pi.status,
      pi.last_synced_at,
      COUNT(a.id) AS account_count
    FROM plaid_items pi
    LEFT JOIN accounts a ON a.plaid_item_id = pi.id AND a.is_active = 1
    GROUP BY pi.id
    ORDER BY pi.institution_name
  `).all()
  res.json({ items })
})
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && npx jest src/__tests__/plaid.test.ts --no-coverage -t "status"
```
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Run full server test suite**

```bash
cd server && npm test
```
Expected: All tests pass (db, schema, plaid-client, plaid routes).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/plaid.ts server/src/__tests__/plaid.test.ts
git commit -m "feat: add Plaid status route"
```

---

## Task 6: Router wiring + type-check

**Files:**
- `server/src/routes/index.ts` was already updated in Task 2. Verify it's complete.
- Run full type-check to ensure all types are clean before touching the client.

- [ ] **Step 1: Verify routes/index.ts is correct**

The file should look exactly like this:

```typescript
// server/src/routes/index.ts
import { Router } from 'express'
import { getDb } from '../db'
import { plaidRouter } from './plaid'

export const router = Router()

router.get('/health', (_req, res) => {
  const db = getDb()
  const result = db.prepare("SELECT 'ok' AS status").get() as { status: string }
  res.json(result)
})

router.use('/plaid', plaidRouter)
```

- [ ] **Step 2: Run TypeScript type-check**

```bash
cd server && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Run all tests**

```bash
cd server && npm test
```
Expected: All tests pass.

- [ ] **Step 4: Commit if any cleanup was needed**

Only commit if `routes/index.ts` needed changes. If it was already correct from Task 2, skip this commit.

```bash
git add server/src/routes/index.ts
git commit -m "chore: verify router wiring is complete"
```

---

## Task 7: Accounts view — Connect Account flow

**Files:**
- Create: `client/src/Accounts.tsx`
- Modify: `client/src/App.tsx`

The `react-plaid-link` package is already installed (v3.5.2). The `usePlaidLink` hook requires an `onSuccess` callback and a `token` prop. The flow is:

1. Component mounts → fetch `/api/plaid/link-token` to get the link token (initial connection)
2. User clicks "Connect Account" → `open()` from `usePlaidLink` launches the Plaid Link widget
3. On success: Plaid calls `onSuccess(public_token, metadata)` → POST to `/api/plaid/exchange-token` with `{ public_token, institution_name: metadata.institution.name }`
4. On completion: re-fetch `/api/plaid/status` to refresh the list

The `usePlaidLink` hook can only be called once with a fixed token. To support connecting multiple institutions or reconnecting, the component re-fetches a new link token each time the user initiates a connection.

- [ ] **Step 1: Write the implementation**

```typescript
// client/src/Accounts.tsx
import { useEffect, useState, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'

type PlaidItem = {
  id: number
  institution_name: string
  status: 'active' | 'needs_reauth'
  account_count: number
  last_synced_at: string | null
}

type ConnectButtonProps = {
  linkToken: string
  onConnected: () => void
}

function ConnectButton({ linkToken, onConnected }: ConnectButtonProps) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      await fetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_token,
          institution_name: metadata.institution?.name ?? 'Unknown',
        }),
      })
      onConnected()
    },
  })

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
    >
      Connect Account
    </button>
  )
}

export default function Accounts() {
  const [items, setItems] = useState<PlaidItem[]>([])
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResults, setSyncResults] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/plaid/status')
    const data = await res.json()
    setItems(data.items)
  }, [])

  const fetchLinkToken = useCallback(async () => {
    const res = await fetch('/api/plaid/link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    setLinkToken(data.link_token)
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchLinkToken()
  }, [fetchStatus, fetchLinkToken])

  const handleConnected = useCallback(() => {
    fetchStatus()
    fetchLinkToken()  // refresh token for next connection
  }, [fetchStatus, fetchLinkToken])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResults(null)
    try {
      const res = await fetch('/api/plaid/sync', { method: 'POST' })
      const data = await res.json()
      const summary = data.results
        .map((r: { id: number; status: string; added?: number }) =>
          r.status === 'ok' ? `+${r.added ?? 0} transactions` : r.status
        )
        .join(', ')
      setSyncResults(summary)
      await fetchStatus()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Accounts</h1>
        <div className="flex gap-3">
          {linkToken && (
            <ConnectButton linkToken={linkToken} onConnected={handleConnected} />
          )}
          <button
            onClick={handleSync}
            disabled={syncing || items.length === 0}
            className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {syncResults && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
          Sync complete: {syncResults}
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-4">No accounts connected yet.</p>
          {linkToken && (
            <ConnectButton linkToken={linkToken} onConnected={handleConnected} />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} onReauth={fetchStatus} />
          ))}
        </div>
      )}
    </div>
  )
}

function ItemCard({ item, onReauth }: { item: PlaidItem; onReauth: () => void }) {
  const [reAuthToken, setReAuthToken] = useState<string | null>(null)

  const fetchUpdateToken = useCallback(async () => {
    const res = await fetch('/api/plaid/link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id }),
    })
    const data = await res.json()
    setReAuthToken(data.link_token)
  }, [item.id])

  useEffect(() => {
    if (item.status === 'needs_reauth') {
      fetchUpdateToken()
    }
  }, [item.status, fetchUpdateToken])

  return (
    <div className={`p-4 border rounded-lg ${item.status === 'needs_reauth' ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{item.institution_name}</h2>
          <p className="text-sm text-gray-500">
            {item.account_count} account{item.account_count !== 1 ? 's' : ''}
            {item.last_synced_at && ` · Last synced ${new Date(item.last_synced_at + 'Z').toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {item.status === 'needs_reauth' ? (
            <>
              <span className="text-sm text-amber-700 font-medium">Needs reconnect</span>
              {reAuthToken && (
                <ReAuthButton token={reAuthToken} onSuccess={onReauth} />
              )}
            </>
          ) : (
            <span className="text-sm text-green-700">Connected</span>
          )}
        </div>
      </div>
    </div>
  )
}

function ReAuthButton({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async () => {
      // After re-auth, trigger a sync to restore active status
      await fetch('/api/plaid/sync', { method: 'POST' })
      onSuccess()
    },
  })

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50"
    >
      Reconnect
    </button>
  )
}
```

- [ ] **Step 2: Update App.tsx to import from Accounts.tsx**

Replace the inline `Accounts` function in `client/src/App.tsx`:

```typescript
// client/src/App.tsx
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Accounts from './Accounts'

function Dashboard() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Dashboard</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Register() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Register</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Calendar() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Calendar</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Scheduled() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Scheduled</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/register', label: 'Register', end: false },
  { to: '/calendar', label: 'Calendar', end: false },
  { to: '/scheduled', label: 'Scheduled', end: false },
  { to: '/accounts', label: 'Accounts', end: false },
]

function Nav() {
  return (
    <nav className="bg-indigo-600 text-white px-4 py-3 flex items-center gap-6 shadow">
      <span className="font-semibold text-lg mr-2">
        {import.meta.env.VITE_APP_NAME}
      </span>
      {navItems.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            isActive ? 'font-semibold underline underline-offset-4' : 'opacity-75 hover:opacity-100 transition-opacity'
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/register" element={<Register />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/scheduled" element={<Scheduled />} />
            <Route path="/accounts" element={<Accounts />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
```

- [ ] **Step 3: Type-check client**

```bash
cd client && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/Accounts.tsx client/src/App.tsx
git commit -m "feat: add Accounts view with Plaid Link connect flow"
```

---

## Task 8: End-to-end verification and branch wrap-up

- [ ] **Step 1: Start the dev servers**

In one terminal:
```bash
cd /Users/markmccall/finance-app && npm run dev
```
This starts both `server` (port 3001) and `client` (port 5173) via `concurrently`.

- [ ] **Step 2: Verify the health endpoint still works**

```bash
curl http://localhost:3001/api/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 3: Verify the status endpoint returns empty items**

```bash
curl http://localhost:3001/api/plaid/status
```
Expected: `{"items":[]}`

- [ ] **Step 4: Verify client builds without errors**

```bash
cd client && npm run build
```
Expected: Build completes without TypeScript or Vite errors.

- [ ] **Step 5: Run full server test suite one final time**

```bash
cd server && npm test
```
Expected: All tests pass.

- [ ] **Step 6: Commit any final cleanup**

Only commit if there are outstanding changes. Otherwise skip.

```bash
git status
# If clean, skip. If there are changes:
git add <changed files>
git commit -m "chore: Phase 1b final cleanup"
```

- [ ] **Step 7: Use superpowers:finishing-a-development-branch skill**

The implementation is complete. Hand off to the finishing-a-development-branch skill to push and create the PR.

---

## Self-Review Checklist

**Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| POST /api/plaid/link-token | Task 2 |
| POST /api/plaid/exchange-token | Task 3 |
| POST /api/plaid/sync — cursor loop until has_more=false | Task 4 |
| Sync atomicity: single DB transaction per item | Task 4 |
| Soft-delete removed transactions | Task 4 |
| ITEM_LOGIN_REQUIRED → needs_reauth | Task 4 |
| GET /api/plaid/status | Task 5 |
| Plaid Link widget (initial connection) | Task 7 |
| Re-auth update mode | Tasks 2 + 7 |
| Sync Now button | Task 7 |
| Auth product excluded (no full account numbers) | Task 3 — only Transactions product used |
| access_token never logged | Route handlers use console.error without logging access_token |

**Placeholder scan:** None found.

**Type consistency:**
- `PlaidItem` type defined in `Accounts.tsx` — matches columns returned by `/api/plaid/status`
- `account_id` in sync route uses `accountIdMap` to translate Plaid's `plaid_account_id` to our local `accounts.id`
- `cursor` stored as `TEXT` in schema — matches `string | null` used in routes
