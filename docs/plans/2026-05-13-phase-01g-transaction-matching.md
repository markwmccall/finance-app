# Phase 1g — Transaction Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Park incoming Plaid transactions in a review queue at sync time and give Laurie an inline pseudo-register to merge, accept, or discard each one — preventing duplicates when a manual transaction was already entered.

**Architecture:** Server-side matching runs during sync and writes to a new `sync_review_queue` table instead of inserting directly into `transactions`. The `POST /api/plaid/sync` endpoint becomes SSE, streaming per-institution progress events while running all institutions in parallel. A new `server/src/routes/sync.ts` handles queue CRUD. `SyncQueue.tsx` renders a flat transaction list above the register; row selection highlights the matched register transaction in amber via a `highlightTxId` callback to `Register`.

**Tech Stack:** Node 24 · better-sqlite3 v12 · Express + TypeScript · `jaro-winkler` npm package · Jest + supertest; React 18 + TypeScript + Tailwind CSS.

---

### Task 1: Branch + jaro-winkler + matching module

**Files:**
- Create: `server/src/matching.ts`
- Create: `server/src/types/jaro-winkler.d.ts`
- Create: `server/src/__tests__/matching.test.ts`

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/markmccall/finance-app && git checkout -b phase/01g-transaction-matching
```

- [ ] **Step 2: Install jaro-winkler**

```bash
cd server && npm install jaro-winkler && cd ..
```

Expected: `jaro-winkler` appears in `server/package.json` dependencies.

- [ ] **Step 3: Write the failing tests**

Create `server/src/__tests__/matching.test.ts`:

```typescript
import { normalizePayee, matchTransaction, MATCH_CONFIDENCE_THRESHOLD } from '../matching'

describe('normalizePayee', () => {
  test('lowercases input', () => {
    expect(normalizePayee('KROGER')).toBe('kroger')
  })

  test('strips trailing merchant code: KROGER #0412 → kroger', () => {
    expect(normalizePayee('KROGER #0412')).toBe('kroger')
  })

  test('strips asterisk separator: AT&T *DIRECT → at&t direct', () => {
    expect(normalizePayee('AT&T *DIRECT')).toBe('at&t direct')
  })

  test('strips check number pattern CHECK #1042', () => {
    expect(normalizePayee('Payment CHECK #1042')).toBe('payment')
  })

  test('strips chk pattern: Bill Pay CHK 1042 → bill pay', () => {
    expect(normalizePayee('Bill Pay CHK 1042')).toBe('bill pay')
  })

  test('strips standalone 3+ digit sequences', () => {
    expect(normalizePayee('Store 12345')).toBe('store')
  })

  test('collapses whitespace and trims', () => {
    expect(normalizePayee('  Target   Run  ')).toBe('target run')
  })

  test('passes through clean payee', () => {
    expect(normalizePayee('Netflix')).toBe('netflix')
  })
})

describe('MATCH_CONFIDENCE_THRESHOLD', () => {
  test('is 0.50', () => {
    expect(MATCH_CONFIDENCE_THRESHOLD).toBe(0.50)
  })
})

describe('matchTransaction', () => {
  const targetRun = {
    id: 1,
    date: '2026-05-07',
    payee: 'Target Run',
    amount: -43.22,
    check_number: null as string | null,
  }

  test('matches by check_number (exact)', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: '1042' },
      [{ id: 1, date: '2026-05-07', payee: 'AT&T Bill Pay', amount: -125.00, check_number: '1042' }]
    )
    expect(result).not.toBeNull()
    expect(result?.reason).toBe('check_number')
    expect(result?.confidence).toBeNull()
    expect(result?.transaction_id).toBe(1)
  })

  test('no match when candidate check_number differs', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: '1042' },
      [{ id: 1, date: '2026-05-07', payee: 'AT&T Bill Pay', amount: -125.00, check_number: '9999' }]
    )
    expect(result).toBeNull()
  })

  test('matches by amount + date + payee similarity', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'Target', amount: -43.22, check_number: null },
      [targetRun]
    )
    expect(result).not.toBeNull()
    expect(result?.reason).toBe('amount_date_payee')
    expect(result?.confidence).toBeGreaterThanOrEqual(0.50)
    expect(result?.transaction_id).toBe(1)
  })

  test('no match when date difference > 1 day', () => {
    const result = matchTransaction(
      { date: '2026-05-10', payee: 'Target', amount: -43.22, check_number: null },
      [targetRun] // date: 2026-05-07, diff = 3 days
    )
    expect(result).toBeNull()
  })

  test('no match when amount differs by more than 0.001', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'Target', amount: -50.00, check_number: null },
      [targetRun]
    )
    expect(result).toBeNull()
  })

  test('no match when payee similarity < threshold', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'Walmart', amount: -43.22, check_number: null },
      [targetRun] // 'walmart' vs 'target run' → low similarity
    )
    expect(result).toBeNull()
  })

  test('picks highest confidence among multiple candidates', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'Target', amount: -43.22, check_number: null },
      [
        { id: 1, date: '2026-05-07', payee: 'Target Run', amount: -43.22, check_number: null },
        { id: 2, date: '2026-05-08', payee: 'Target', amount: -43.22, check_number: null },
      ]
    )
    // 'target' vs 'target' = 1.0 > 'target' vs 'target run'
    expect(result?.transaction_id).toBe(2)
  })

  test('check_number takes priority when both candidates could match', () => {
    const result = matchTransaction(
      { date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: '1042' },
      [
        { id: 1, date: '2026-05-07', payee: 'AT&T Bill Pay', amount: -125.00, check_number: '1042' },
        { id: 2, date: '2026-05-08', payee: 'AT&T', amount: -125.00, check_number: null },
      ]
    )
    expect(result?.reason).toBe('check_number')
    expect(result?.transaction_id).toBe(1)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd server && npm test -- --testPathPattern=matching --verbose
```

Expected: `FAIL  src/__tests__/matching.test.ts` — Cannot find module '../matching'

- [ ] **Step 5: Create jaro-winkler type declaration**

Create `server/src/types/jaro-winkler.d.ts`:

```typescript
declare module 'jaro-winkler' {
  function jaroWinklerDistance(s1: string, s2: string): number
  export = jaroWinklerDistance
}
```

- [ ] **Step 6: Write matching.ts**

Create `server/src/matching.ts`:

```typescript
import jaroWinkler from 'jaro-winkler'

export const MATCH_CONFIDENCE_THRESHOLD = 0.50

export function normalizePayee(raw: string): string {
  let s = raw.toLowerCase()
  s = s.replace(/\s*#\s*\d+/g, '')
  s = s.replace(/\s*\*+\s*/g, ' ')
  s = s.replace(/\bch(?:eck|k)\s*#?\s*\d+\b/g, '')
  s = s.replace(/\s+-\s+/g, ' ')
  s = s.replace(/\b\d{3,}\b/g, '')
  return s.replace(/\s+/g, ' ').trim()
}

export interface MatchCandidate {
  id: number
  date: string
  payee: string
  amount: number
  check_number: string | null
}

export interface PlaidTxInput {
  date: string
  payee: string
  amount: number
  check_number: string | null
}

export interface MatchResult {
  transaction_id: number
  reason: 'check_number' | 'amount_date_payee'
  confidence: number | null
}

export function matchTransaction(
  plaid: PlaidTxInput,
  candidates: MatchCandidate[]
): MatchResult | null {
  if (plaid.check_number) {
    const hit = candidates.find(c => c.check_number === plaid.check_number)
    if (hit) return { transaction_id: hit.id, reason: 'check_number', confidence: null }
  }

  const plaidMs = new Date(plaid.date).getTime()
  const plaidNorm = normalizePayee(plaid.payee)
  let best: { candidate: MatchCandidate; score: number } | null = null

  for (const c of candidates) {
    const daysDiff = Math.abs((plaidMs - new Date(c.date).getTime()) / 86_400_000)
    if (daysDiff > 1.0) continue
    if (Math.abs(plaid.amount - c.amount) > 0.001) continue

    const score = jaroWinkler(plaidNorm, normalizePayee(c.payee))
    if (score >= MATCH_CONFIDENCE_THRESHOLD && (!best || score > best.score)) {
      best = { candidate: c, score }
    }
  }

  if (best) {
    return { transaction_id: best.candidate.id, reason: 'amount_date_payee', confidence: best.score }
  }
  return null
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd server && npm test -- --testPathPattern=matching --verbose
```

Expected: All 15 matching tests PASS

- [ ] **Step 8: Run full suite to verify no regressions**

```bash
cd server && npm test
```

Expected: All ≥98 existing tests still pass.

- [ ] **Step 9: Commit**

```bash
git add server/package.json server/package-lock.json server/src/matching.ts server/src/types/jaro-winkler.d.ts server/src/__tests__/matching.test.ts
git commit -m "feat: add payee normalization and transaction matching module"
```

---

### Task 2: Schema migration — sync_review_queue table

**Files:**
- Modify: `server/src/schema.ts`
- Modify: `server/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these three tests at the end of `server/src/__tests__/schema.test.ts`:

```typescript
test('createTables creates sync_review_queue table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_review_queue'").get()
  expect(row).toBeDefined()
})

test('sync_review_queue has all required columns', () => {
  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(sync_review_queue)').all() as Array<{ name: string }>
  const names = cols.map(c => c.name)
  for (const col of ['id', 'account_id', 'plaid_transaction_id', 'plaid_date', 'plaid_payee',
    'plaid_amount', 'plaid_check_number', 'match_transaction_id', 'match_reason',
    'match_confidence', 'status', 'created_at']) {
    expect(names).toContain(col)
  }
})

test('migrateSchema creates sync_review_queue when table is missing', () => {
  const db = getDb()
  db.exec('DROP TABLE IF EXISTS sync_review_queue')
  const before = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_review_queue'").get()
  expect(before).toBeUndefined()

  migrateSchema(db)

  const after = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_review_queue'").get()
  expect(after).toBeDefined()
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && npm test -- --testPathPattern=schema --verbose
```

Expected: 3 new tests FAIL — table does not exist yet

- [ ] **Step 3: Add sync_review_queue to createTables()**

In `server/src/schema.ts`, inside the `db.exec(`` ` `` ... `` ` ``)` block in `createTables`, add the new table before the closing backtick:

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

- [ ] **Step 4: Add migrateSchema entry for sync_review_queue**

At the end of `migrateSchema()` in `server/src/schema.ts`, after the existing `check_number` migration, add:

```typescript
  db.exec(`
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
    )
  `)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npm test -- --testPathPattern=schema --verbose
```

Expected: All schema tests PASS (was 20, now 23)

- [ ] **Step 6: Run full suite**

```bash
cd server && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/schema.ts server/src/__tests__/schema.test.ts
git commit -m "feat: add sync_review_queue table and migration"
```

---

### Task 3: Queue CRUD routes

**Files:**
- Create: `server/src/routes/sync.ts`
- Create: `server/src/__tests__/sync.test.ts`
- Modify: `server/src/routes/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/__tests__/sync.test.ts`:

```typescript
import request from 'supertest'
import { app } from '../index'
import { createDb, getDb, closeDb } from '../db'
import { createTables, seedCategories } from '../schema'

function seedFixture() {
  const db = getDb()
  db.prepare(`
    INSERT INTO plaid_items (id, institution_name, plaid_item_id, access_token, status)
    VALUES (10, 'Test Bank', 'item-xxx', 'access-test', 'active')
  `).run()
  db.prepare(`
    INSERT INTO accounts (id, plaid_item_id, plaid_account_id, name, type, current_balance)
    VALUES (20, 10, 'acct-aaa', 'Checking', 'depository', 1000)
  `).run()
  db.prepare(`
    INSERT INTO transactions (id, account_id, date, payee, amount, is_manual, is_cleared)
    VALUES (100, 20, '2026-05-07', 'Target Run', -43.22, 1, 0)
  `).run()
  db.prepare(`
    INSERT INTO sync_review_queue
      (id, account_id, plaid_transaction_id, plaid_date, plaid_payee, plaid_amount,
       status, match_transaction_id, match_reason, match_confidence)
    VALUES
      (1, 20, 'plaid-tx-review',  '2026-05-08', 'Target',     -43.22, 'needs_review', 100, 'amount_date_payee', 0.91),
      (2, 20, 'plaid-tx-matched', '2026-05-11', 'AT&T',       -125.00, 'auto_matched', NULL, NULL, NULL),
      (3, 20, 'plaid-tx-new',     '2026-05-11', 'Whole Foods', -84.12, 'new', NULL, NULL, NULL)
  `).run()
}

beforeEach(() => {
  createDb(':memory:')
  createTables(getDb())
  seedCategories(getDb())
})

afterEach(() => {
  closeDb()
})

describe('GET /api/sync/queue', () => {
  test('returns empty accounts array and zero total when no queue rows', async () => {
    const res = await request(app).get('/api/sync/queue')
    expect(res.status).toBe(200)
    expect(res.body.accounts).toEqual([])
    expect(res.body.total_pending).toBe(0)
  })

  test('groups rows by account with correct status buckets', async () => {
    seedFixture()
    const res = await request(app).get('/api/sync/queue')
    expect(res.status).toBe(200)
    expect(res.body.accounts).toHaveLength(1)
    const acct = res.body.accounts[0]
    expect(acct.account_id).toBe(20)
    expect(acct.account_name).toBe('Checking')
    expect(acct.needs_review).toHaveLength(1)
    expect(acct.auto_matched).toHaveLength(1)
    expect(acct.new).toHaveLength(1)
    expect(res.body.total_pending).toBe(3)
  })

  test('includes match_payee and match_date on needs_review rows', async () => {
    seedFixture()
    const res = await request(app).get('/api/sync/queue')
    const item = res.body.accounts[0].needs_review[0]
    expect(item.plaid_payee).toBe('Target')
    expect(item.match_payee).toBe('Target Run')
    expect(item.match_date).toBe('2026-05-07')
    expect(item.match_confidence).toBeCloseTo(0.91)
  })
})

describe('POST /api/sync/queue/:id/accept — merge path', () => {
  test('copies plaid_transaction_id onto matched transaction and removes queue row', async () => {
    seedFixture()
    const res = await request(app).post('/api/sync/queue/1/accept').send({})
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const db = getDb()
    const tx = db.prepare('SELECT plaid_transaction_id, is_cleared FROM transactions WHERE id = 100').get() as { plaid_transaction_id: string; is_cleared: number }
    expect(tx.plaid_transaction_id).toBe('plaid-tx-review')
    expect(tx.is_cleared).toBe(1)

    const queueRow = db.prepare('SELECT * FROM sync_review_queue WHERE id = 1').get()
    expect(queueRow).toBeUndefined()
  })
})

describe('POST /api/sync/queue/:id/accept — force_new path', () => {
  test('inserts new transaction and removes queue row when force_new: true', async () => {
    seedFixture()
    const res = await request(app).post('/api/sync/queue/1/accept').send({ force_new: true })
    expect(res.status).toBe(200)

    const db = getDb()
    const newTx = db.prepare("SELECT * FROM transactions WHERE plaid_transaction_id = 'plaid-tx-review'").get() as { payee: string; amount: number; is_cleared: number; is_manual: number } | undefined
    expect(newTx).toBeDefined()
    expect(newTx?.payee).toBe('Target')
    expect(newTx?.amount).toBeCloseTo(-43.22)
    expect(newTx?.is_cleared).toBe(1)
    expect(newTx?.is_manual).toBe(0)

    const queueRow = db.prepare('SELECT * FROM sync_review_queue WHERE id = 1').get()
    expect(queueRow).toBeUndefined()
  })

  test('inserts new transaction from new-status row (no force_new needed)', async () => {
    seedFixture()
    const res = await request(app).post('/api/sync/queue/3/accept').send({})
    expect(res.status).toBe(200)

    const db = getDb()
    const newTx = db.prepare("SELECT * FROM transactions WHERE plaid_transaction_id = 'plaid-tx-new'").get() as { payee: string; amount: number } | undefined
    expect(newTx).toBeDefined()
    expect(newTx?.payee).toBe('Whole Foods')
    expect(newTx?.amount).toBeCloseTo(-84.12)

    const queueRow = db.prepare('SELECT * FROM sync_review_queue WHERE id = 3').get()
    expect(queueRow).toBeUndefined()
  })
})

describe('POST /api/sync/queue/:id/reject', () => {
  test('removes queue row without modifying the matched transaction', async () => {
    seedFixture()
    const res = await request(app).post('/api/sync/queue/1/reject').send({})
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const db = getDb()
    expect(db.prepare('SELECT * FROM sync_review_queue WHERE id = 1').get()).toBeUndefined()
    const tx = db.prepare('SELECT plaid_transaction_id FROM transactions WHERE id = 100').get() as { plaid_transaction_id: string | null }
    expect(tx.plaid_transaction_id).toBeNull()
  })

  test('returns 404 for non-existent queue row', async () => {
    seedFixture()
    const res = await request(app).post('/api/sync/queue/999/reject').send({})
    expect(res.status).toBe(404)
  })
})

describe('POST /api/sync/queue/:id/undo-match', () => {
  test('demotes auto_matched to needs_review', async () => {
    seedFixture()
    const res = await request(app).post('/api/sync/queue/2/undo-match').send({})
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const row = getDb().prepare('SELECT status FROM sync_review_queue WHERE id = 2').get() as { status: string }
    expect(row.status).toBe('needs_review')
  })

  test('returns 404 for non-existent queue row', async () => {
    seedFixture()
    const res = await request(app).post('/api/sync/queue/999/undo-match').send({})
    expect(res.status).toBe(404)
  })
})

describe('POST /api/sync/queue/:id/merge-with', () => {
  test('merges plaid tx with user-specified transaction', async () => {
    seedFixture()
    getDb().prepare(`
      INSERT INTO transactions (id, account_id, date, payee, amount, is_manual)
      VALUES (200, 20, '2026-05-11', 'AT&T Bill Pay', -125.00, 1)
    `).run()

    const res = await request(app)
      .post('/api/sync/queue/2/merge-with')
      .send({ transaction_id: 200 })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const db = getDb()
    const tx = db.prepare('SELECT plaid_transaction_id, is_cleared FROM transactions WHERE id = 200').get() as { plaid_transaction_id: string; is_cleared: number }
    expect(tx.plaid_transaction_id).toBe('plaid-tx-matched')
    expect(tx.is_cleared).toBe(1)

    expect(db.prepare('SELECT * FROM sync_review_queue WHERE id = 2').get()).toBeUndefined()
  })

  test('returns 400 when target already has plaid_transaction_id', async () => {
    seedFixture()
    getDb().prepare(`
      INSERT INTO transactions (id, account_id, date, payee, amount, is_manual, plaid_transaction_id)
      VALUES (300, 20, '2026-05-01', 'Netflix', -17.99, 0, 'plaid-tx-netflix')
    `).run()

    const res = await request(app).post('/api/sync/queue/1/merge-with').send({ transaction_id: 300 })
    expect(res.status).toBe(400)
  })

  test('returns 400 when target transaction is_removed', async () => {
    seedFixture()
    getDb().prepare(`
      INSERT INTO transactions (id, account_id, date, payee, amount, is_manual, is_removed)
      VALUES (400, 20, '2026-05-01', 'Old Tx', -10.00, 1, 1)
    `).run()

    const res = await request(app).post('/api/sync/queue/1/merge-with').send({ transaction_id: 400 })
    expect(res.status).toBe(400)
  })

  test('returns 400 when transaction_id not found', async () => {
    seedFixture()
    const res = await request(app).post('/api/sync/queue/1/merge-with').send({ transaction_id: 9999 })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/sync/queue/accept-all', () => {
  test('accepts auto_matched and new rows, skips needs_review', async () => {
    seedFixture()
    // auto_matched row (id=2) has no match_transaction_id set — it will follow insert-new path
    const res = await request(app).post('/api/sync/queue/accept-all').send({})
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(2)

    const remaining = getDb().prepare('SELECT status FROM sync_review_queue').all() as Array<{ status: string }>
    expect(remaining).toHaveLength(1)
    expect(remaining[0].status).toBe('needs_review')
  })

  test('scopes to account_id when provided', async () => {
    seedFixture()
    getDb().prepare(`
      INSERT INTO accounts (id, plaid_item_id, plaid_account_id, name, type, current_balance)
      VALUES (21, 10, 'acct-bbb', 'Savings', 'depository', 500)
    `).run()
    getDb().prepare(`
      INSERT INTO sync_review_queue (account_id, plaid_transaction_id, plaid_date, plaid_payee, plaid_amount, status)
      VALUES (21, 'plaid-tx-savings', '2026-05-12', 'Paycheck', 2800.00, 'new')
    `).run()

    const res = await request(app).post('/api/sync/queue/accept-all').send({ account_id: 20 })
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(2) // only account 20

    const savingsRow = getDb().prepare('SELECT * FROM sync_review_queue WHERE account_id = 21').get()
    expect(savingsRow).toBeDefined() // untouched
  })
})

describe('sync_review_queue idempotency', () => {
  test('INSERT OR IGNORE prevents duplicate rows on re-sync', async () => {
    seedFixture()
    const db = getDb()
    const before = (db.prepare('SELECT COUNT(*) as n FROM sync_review_queue').get() as { n: number }).n

    expect(() => {
      db.prepare(`
        INSERT OR IGNORE INTO sync_review_queue
          (account_id, plaid_transaction_id, plaid_date, plaid_payee, plaid_amount, status)
        VALUES (20, 'plaid-tx-new', '2026-05-11', 'Whole Foods', -84.12, 'new')
      `).run()
    }).not.toThrow()

    const after = (db.prepare('SELECT COUNT(*) as n FROM sync_review_queue').get() as { n: number }).n
    expect(after).toBe(before) // no new row inserted
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test -- --testPathPattern=sync --verbose
```

Expected: `FAIL src/__tests__/sync.test.ts` — route not found (404s)

- [ ] **Step 3: Write sync.ts**

Create `server/src/routes/sync.ts`:

```typescript
import { Router } from 'express'
import { getDb } from '../db'

export const syncRouter = Router()

// GET /api/sync/queue
syncRouter.get('/queue', (_req, res) => {
  const db = getDb()

  type QueueRow = {
    id: number; account_id: number; account_name: string
    plaid_transaction_id: string; plaid_date: string; plaid_payee: string
    plaid_amount: number; plaid_check_number: string | null
    match_transaction_id: number | null; match_reason: string | null
    match_confidence: number | null; status: string
    match_payee: string | null; match_date: string | null
  }

  const rows = db.prepare(`
    SELECT
      q.id, q.account_id, a.name AS account_name,
      q.plaid_transaction_id, q.plaid_date, q.plaid_payee,
      q.plaid_amount, q.plaid_check_number,
      q.match_transaction_id, q.match_reason, q.match_confidence, q.status,
      t.payee AS match_payee, t.date AS match_date
    FROM sync_review_queue q
    JOIN accounts a ON a.id = q.account_id
    LEFT JOIN transactions t ON t.id = q.match_transaction_id
    ORDER BY q.account_id, q.id
  `).all() as QueueRow[]

  const accountMap = new Map<number, {
    account_id: number; account_name: string
    auto_matched: QueueRow[]; needs_review: QueueRow[]; new: QueueRow[]
  }>()

  for (const row of rows) {
    if (!accountMap.has(row.account_id)) {
      accountMap.set(row.account_id, {
        account_id: row.account_id, account_name: row.account_name,
        auto_matched: [], needs_review: [], new: [],
      })
    }
    const entry = accountMap.get(row.account_id)!
    if (row.status === 'auto_matched') entry.auto_matched.push(row)
    else if (row.status === 'needs_review') entry.needs_review.push(row)
    else if (row.status === 'new') entry.new.push(row)
  }

  res.json({ accounts: Array.from(accountMap.values()), total_pending: rows.length })
})

// POST /api/sync/queue/accept-all
// Defined before /:id/* so Express does not match 'accept-all' as an id param
syncRouter.post('/queue/accept-all', (req, res) => {
  const { account_id } = req.body as { account_id?: number }
  const db = getDb()

  type AcceptRow = {
    id: number; account_id: number; plaid_transaction_id: string
    plaid_date: string; plaid_payee: string; plaid_amount: number
    plaid_check_number: string | null; match_transaction_id: number | null; status: string
  }

  const toAccept = db.prepare(`
    SELECT q.id, q.account_id, q.plaid_transaction_id, q.plaid_date, q.plaid_payee,
           q.plaid_amount, q.plaid_check_number, q.match_transaction_id, q.status
    FROM sync_review_queue q
    WHERE q.status IN ('auto_matched', 'new')
    ${account_id != null ? 'AND q.account_id = ?' : ''}
  `).all(...(account_id != null ? [account_id] : [])) as AcceptRow[]

  const mergeStmt = db.prepare(`
    UPDATE transactions SET plaid_transaction_id = ?, is_cleared = 1 WHERE id = ?
  `)
  const insertStmt = db.prepare(`
    INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount, check_number, is_cleared, is_manual, is_removed)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)
  `)
  const deleteStmt = db.prepare('DELETE FROM sync_review_queue WHERE id = ?')

  db.transaction(() => {
    for (const row of toAccept) {
      if (row.status === 'auto_matched' && row.match_transaction_id != null) {
        mergeStmt.run(row.plaid_transaction_id, row.match_transaction_id)
      } else {
        insertStmt.run(
          row.account_id, row.plaid_transaction_id, row.plaid_date,
          row.plaid_payee, row.plaid_amount, row.plaid_check_number ?? null
        )
      }
      deleteStmt.run(row.id)
    }
  })()

  res.json({ accepted: toAccept.length })
})

// POST /api/sync/queue/:id/accept
syncRouter.post('/queue/:id/accept', (req, res) => {
  const id = Number(req.params.id)
  const { force_new } = req.body as { force_new?: boolean }
  const db = getDb()

  type AcceptRow = {
    id: number; account_id: number; plaid_transaction_id: string
    plaid_date: string; plaid_payee: string; plaid_amount: number
    plaid_check_number: string | null; match_transaction_id: number | null; status: string
  }

  const row = db.prepare(`
    SELECT id, account_id, plaid_transaction_id, plaid_date, plaid_payee,
           plaid_amount, plaid_check_number, match_transaction_id, status
    FROM sync_review_queue WHERE id = ?
  `).get(id) as AcceptRow | undefined

  if (!row) { res.status(404).json({ error: 'Queue row not found' }); return }

  db.transaction(() => {
    if (!force_new && row.status !== 'new' && row.match_transaction_id != null) {
      db.prepare(
        'UPDATE transactions SET plaid_transaction_id = ?, is_cleared = 1 WHERE id = ?'
      ).run(row.plaid_transaction_id, row.match_transaction_id)
    } else {
      db.prepare(`
        INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount, check_number, is_cleared, is_manual, is_removed)
        VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)
      `).run(
        row.account_id, row.plaid_transaction_id, row.plaid_date,
        row.plaid_payee, row.plaid_amount, row.plaid_check_number ?? null
      )
    }
    db.prepare('DELETE FROM sync_review_queue WHERE id = ?').run(id)
  })()

  res.json({ ok: true })
})

// POST /api/sync/queue/:id/reject
syncRouter.post('/queue/:id/reject', (req, res) => {
  const id = Number(req.params.id)
  const db = getDb()
  const info = db.prepare('DELETE FROM sync_review_queue WHERE id = ?').run(id)
  if (info.changes === 0) { res.status(404).json({ error: 'Queue row not found' }); return }
  res.json({ ok: true })
})

// POST /api/sync/queue/:id/undo-match
syncRouter.post('/queue/:id/undo-match', (req, res) => {
  const id = Number(req.params.id)
  const db = getDb()
  const info = db.prepare(
    "UPDATE sync_review_queue SET status = 'needs_review' WHERE id = ?"
  ).run(id)
  if (info.changes === 0) { res.status(404).json({ error: 'Queue row not found' }); return }
  res.json({ ok: true })
})

// POST /api/sync/queue/:id/merge-with
syncRouter.post('/queue/:id/merge-with', (req, res) => {
  const id = Number(req.params.id)
  const { transaction_id } = req.body as { transaction_id: number }
  const db = getDb()

  const row = db.prepare('SELECT id, plaid_transaction_id FROM sync_review_queue WHERE id = ?').get(id) as {
    id: number; plaid_transaction_id: string
  } | undefined
  if (!row) { res.status(404).json({ error: 'Queue row not found' }); return }

  const target = db.prepare(
    'SELECT id, plaid_transaction_id, is_removed FROM transactions WHERE id = ?'
  ).get(transaction_id) as { id: number; plaid_transaction_id: string | null; is_removed: number } | undefined

  if (!target || target.is_removed || target.plaid_transaction_id != null) {
    res.status(400).json({ error: 'Invalid merge target' })
    return
  }

  db.transaction(() => {
    db.prepare(
      'UPDATE transactions SET plaid_transaction_id = ?, is_cleared = 1 WHERE id = ?'
    ).run(row.plaid_transaction_id, transaction_id)
    db.prepare('DELETE FROM sync_review_queue WHERE id = ?').run(id)
  })()

  res.json({ ok: true })
})
```

- [ ] **Step 4: Register syncRouter in routes/index.ts**

In `server/src/routes/index.ts`, add the import and mount:

```typescript
import { syncRouter } from './sync'
```

```typescript
router.use('/sync', syncRouter)
```

The full file after edit:

```typescript
import { Router } from 'express'
import { getDb } from '../db'
import { plaidRouter } from './plaid'
import { accountsRouter } from './accounts'
import { categoriesRouter } from './categories'
import { transactionsRouter } from './transactions'
import { syncRouter } from './sync'

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
router.use('/sync', syncRouter)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npm test -- --testPathPattern=sync --verbose
```

Expected: All sync tests PASS

- [ ] **Step 6: Run full suite**

```bash
cd server && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/sync.ts server/src/__tests__/sync.test.ts server/src/routes/index.ts
git commit -m "feat: add sync queue CRUD endpoints"
```

---

### Task 4: Update plaid sync — SSE + queue-based writes

**Files:**
- Modify: `server/src/routes/plaid.ts`
- Modify: `server/src/__tests__/plaid.test.ts`

The sync handler changes from a single JSON response to SSE. Incoming added/modified Plaid transactions go to `sync_review_queue` instead of `transactions`. Removed transactions, cursor, balance, and re-auth behavior remain the same. Institutions run in parallel via `Promise.allSettled`.

- [ ] **Step 1: Update the plaid sync tests**

In `server/src/__tests__/plaid.test.ts`, replace the entire `describe('POST /api/plaid/sync', ...)` block with:

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

  function parseSseEvents(text: string): Array<Record<string, unknown>> {
    return text
      .split('\n')
      .filter(l => l.startsWith('data: '))
      .map(l => JSON.parse(l.slice(6)))
  }

  test('responds with text/event-stream content-type', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cursor-1' },
    })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
  })

  test('parks added transactions in sync_review_queue, not transactions table', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{
          transaction_id: 'tx-1', account_id: 'acct-aaa', date: '2026-05-01',
          name: 'Coffee', merchant_name: null, check_number: null, amount: 5.00, pending: false,
        }],
        modified: [], removed: [], has_more: false, next_cursor: 'cursor-1',
      },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    const db = getDb()
    const txCount = (db.prepare(
      'SELECT COUNT(*) as n FROM transactions WHERE plaid_transaction_id IS NOT NULL AND is_manual = 0'
    ).get() as { n: number }).n
    expect(txCount).toBe(0)

    const queueCount = (db.prepare('SELECT COUNT(*) as n FROM sync_review_queue').get() as { n: number }).n
    expect(queueCount).toBe(1)
  })

  test('emits done event with correct counts', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-1', account_id: 'acct-aaa', date: '2026-05-01', name: 'Coffee', merchant_name: null, check_number: null, amount: 5.00, pending: false }],
        modified: [], removed: [], has_more: false, next_cursor: 'cursor-1',
      },
    })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    const events = parseSseEvents(res.text)
    const doneEvent = events.find(e => e.state === 'done') as { item_id: number; added: number } | undefined
    expect(doneEvent).toBeDefined()
    expect(doneEvent?.item_id).toBe(10)
    expect(doneEvent?.added).toBe(1)
  })

  test('emits complete event at end', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 500 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cursor-z' },
    })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    const events = parseSseEvents(res.text)
    expect(events.find(e => e.type === 'complete')).toBeDefined()
  })

  test('runs cursor loop until has_more is false', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-1', account_id: 'acct-aaa', date: '2026-05-01', name: 'Coffee', merchant_name: null, check_number: null, amount: 5.00, pending: false }],
        modified: [], removed: [], has_more: true, next_cursor: 'cursor-page-2',
      },
    })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-2', account_id: 'acct-aaa', date: '2026-05-02', name: 'Salary', merchant_name: null, check_number: null, amount: -2000.00, pending: false }],
        modified: [], removed: [], has_more: false, next_cursor: 'cursor-page-3',
      },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    expect(mockTransactionsSync).toHaveBeenCalledTimes(2)
    expect(mockTransactionsSync.mock.calls[1][0].cursor).toBe('cursor-page-2')

    const queueCount = (getDb().prepare('SELECT COUNT(*) as n FROM sync_review_queue').get() as { n: number }).n
    expect(queueCount).toBe(2)
  })

  test('soft-deletes removed transactions from the transactions table', async () => {
    seedItem(getDb())
    getDb().prepare(
      'INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount) VALUES (20, \'tx-old\', \'2026-04-01\', \'Old Merchant\', -10)'
    ).run()

    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [{ transaction_id: 'tx-old' }], has_more: false, next_cursor: 'cursor-x' },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    const tx = getDb().prepare("SELECT is_removed FROM transactions WHERE plaid_transaction_id = 'tx-old'").get() as { is_removed: number } | undefined
    expect(tx?.is_removed).toBe(1)
  })

  test('updates account balance and cursor', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 999.99 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cursor-final' },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    const account = getDb().prepare('SELECT current_balance FROM accounts WHERE id = 20').get() as { current_balance: number }
    expect(account.current_balance).toBeCloseTo(999.99)

    const item = getDb().prepare('SELECT cursor, last_synced_at FROM plaid_items WHERE id = 10').get() as { cursor: string; last_synced_at: string }
    expect(item.cursor).toBe('cursor-final')
    expect(item.last_synced_at).not.toBeNull()
  })

  test('emits needs_reauth event and sets item status on ITEM_LOGIN_REQUIRED', async () => {
    seedItem(getDb())
    mockAccountsGet.mockRejectedValueOnce({ response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } } })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    const events = parseSseEvents(res.text)
    const reauthEvent = events.find(e => e.state === 'needs_reauth')
    expect(reauthEvent).toBeDefined()
    expect(reauthEvent?.item_id).toBe(10)

    const item = getDb().prepare('SELECT status FROM plaid_items WHERE id = 10').get() as { status: string }
    expect(item.status).toBe('needs_reauth')
  })

  test('emits error event with error_code, error_message, and request_id', async () => {
    seedItem(getDb())
    mockAccountsGet.mockRejectedValueOnce({
      response: {
        data: { error_code: 'RATE_LIMIT_EXCEEDED', error_message: 'Too many requests.', request_id: 'req-abc-123' },
      },
    })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    const events = parseSseEvents(res.text)
    const errorEvent = events.find(e => e.state === 'error') as { error_code: string; error_message: string; request_id: string } | undefined
    expect(errorEvent?.error_code).toBe('RATE_LIMIT_EXCEEDED')
    expect(errorEvent?.error_message).toBe('Too many requests.')
    expect(errorEvent?.request_id).toBe('req-abc-123')
  })

  test('check_number on Plaid transaction is stored in queue row', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 500 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{
          transaction_id: 'tx-check', account_id: 'acct-aaa', date: '2026-05-01',
          name: 'Electric Company', merchant_name: null, check_number: '1247', amount: 145.00, pending: false,
        }],
        modified: [], removed: [], has_more: false, next_cursor: 'cursor-x',
      },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    const qRow = getDb().prepare(
      "SELECT plaid_check_number FROM sync_review_queue WHERE plaid_transaction_id = 'tx-check'"
    ).get() as { plaid_check_number: string | null } | undefined
    expect(qRow?.plaid_check_number).toBe('1247')
  })
})
```

- [ ] **Step 2: Run updated tests to verify they fail**

```bash
cd server && npm test -- --testPathPattern=plaid --verbose
```

Expected: The new sync tests FAIL — endpoint still returns JSON.

- [ ] **Step 3: Replace the sync handler in plaid.ts**

In `server/src/routes/plaid.ts`, add this import at the top (after existing imports):

```typescript
import { matchTransaction } from '../matching'
```

Replace the entire `plaidRouter.post('/sync', ...)` handler with:

```typescript
// POST /api/plaid/sync
// Streams per-institution progress via SSE. Runs all institutions in parallel.
plaidRouter.post('/sync', async (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const emit = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  const db = getDb()
  const items = db.prepare(
    'SELECT id, plaid_item_id, access_token, cursor, status FROM plaid_items'
  ).all() as Array<{ id: number; plaid_item_id: string; access_token: string; cursor: string | null; status: string }>

  type PlaidTx = {
    transaction_id: string; account_id: string; date: string
    name: string; merchant_name?: string | null; check_number?: string | null
    amount: number; pending: boolean
  }
  type RemovedTx = { transaction_id: string }

  const syncItem = async (item: typeof items[number]) => {
    try {
      const plaid = getPlaidClient()

      emit({ item_id: item.id, state: 'fetching_balances' })
      const accountsRes = await plaid.accountsGet({ access_token: item.access_token })
      const plaidAccounts = accountsRes.data.accounts

      const added: PlaidTx[] = []
      const modified: PlaidTx[] = []
      const removed: RemovedTx[] = []
      let cursor = item.cursor ?? undefined
      let hasMore = true
      let page = 0

      while (hasMore) {
        page++
        emit({ item_id: item.id, state: 'fetching_transactions', page })
        const syncRes = await plaid.transactionsSync({ access_token: item.access_token, cursor })
        const pageData = syncRes.data
        added.push(...(pageData.added as PlaidTx[]))
        modified.push(...(pageData.modified as PlaidTx[]))
        removed.push(...(pageData.removed as RemovedTx[]))
        hasMore = pageData.has_more
        cursor = pageData.next_cursor
      }

      emit({ item_id: item.id, state: 'processing' })

      const accountRows = db
        .prepare('SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id = ?')
        .all(item.id) as Array<{ id: number; plaid_account_id: string }>
      const accountIdMap = new Map(accountRows.map(r => [r.plaid_account_id, r.id]))

      const insertQueue = db.prepare(`
        INSERT OR IGNORE INTO sync_review_queue
          (account_id, plaid_transaction_id, plaid_date, plaid_payee, plaid_amount, plaid_check_number,
           match_transaction_id, match_reason, match_confidence, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const softDelete = db.prepare('UPDATE transactions SET is_removed = 1 WHERE plaid_transaction_id = ?')
      const updateBalance = db.prepare('UPDATE accounts SET current_balance = ? WHERE plaid_account_id = ?')
      const updateItem = db.prepare(
        "UPDATE plaid_items SET cursor = ?, last_synced_at = datetime('now') WHERE id = ?"
      )
      const resetStatus = db.prepare("UPDATE plaid_items SET status = 'active' WHERE id = ?")

      let countAdded = 0
      let countNeedsReview = 0
      let countAutoMatched = 0

      db.transaction(() => {
        for (const tx of [...added, ...modified]) {
          const accountId = accountIdMap.get(tx.account_id)
          if (accountId == null) continue

          const candidates = db.prepare(`
            SELECT id, date, payee, amount, check_number
            FROM transactions
            WHERE account_id = ? AND is_manual = 1 AND plaid_transaction_id IS NULL AND is_removed = 0
          `).all(accountId) as Array<{ id: number; date: string; payee: string; amount: number; check_number: string | null }>

          const plaidAmount = -(tx.amount)
          const match = matchTransaction(
            { date: tx.date, payee: tx.merchant_name ?? tx.name, amount: plaidAmount, check_number: tx.check_number ?? null },
            candidates
          )

          let status: string
          if (match?.reason === 'check_number') {
            status = 'auto_matched'; countAutoMatched++
          } else if (match?.reason === 'amount_date_payee') {
            status = 'needs_review'; countNeedsReview++
          } else {
            status = 'new'; countAdded++
          }

          insertQueue.run(
            accountId, tx.transaction_id, tx.date,
            tx.merchant_name ?? tx.name, plaidAmount, tx.check_number ?? null,
            match?.transaction_id ?? null, match?.reason ?? null, match?.confidence ?? null,
            status
          )
        }
        for (const rt of removed) softDelete.run(rt.transaction_id)
        for (const acct of plaidAccounts) updateBalance.run(acct.balances.current ?? 0, acct.account_id)
        resetStatus.run(item.id)
        updateItem.run(cursor ?? null, item.id)
      })()

      emit({ item_id: item.id, state: 'done', added: countAdded, needs_review: countNeedsReview, auto_matched: countAutoMatched })
    } catch (err: unknown) {
      const plaidErr = err as { response?: { data?: { error_code?: string; error_message?: string; request_id?: string } } }
      if (plaidErr.response?.data?.error_code === 'ITEM_LOGIN_REQUIRED') {
        db.prepare("UPDATE plaid_items SET status = 'needs_reauth' WHERE id = ?").run(item.id)
        emit({ item_id: item.id, state: 'needs_reauth' })
        return
      }
      const errData = plaidErr.response?.data
      emit({
        item_id: item.id,
        state: 'error',
        error_code: errData?.error_code ?? 'UNKNOWN',
        error_message: errData?.error_message ?? 'An unexpected error occurred.',
        request_id: errData?.request_id ?? null,
      })
    }
  }

  await Promise.allSettled(items.map(syncItem))
  emit({ type: 'complete' })
  res.end()
})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test -- --testPathPattern=plaid --verbose
```

Expected: All plaid tests PASS

- [ ] **Step 5: Run full suite**

```bash
cd server && npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/plaid.ts server/src/__tests__/plaid.test.ts
git commit -m "feat: change plaid sync to SSE with parallel items and queue-based writes"
```

---

### Task 5: SyncQueue.tsx — pseudo-register component

**Files:**
- Create: `client/src/SyncQueue.tsx`

`SyncQueue` receives queue rows for one account. It manages row selection locally and informs the parent of: which register transaction to highlight (`onHighlight`), when to enter pick-mode for "Merge with…" (`onPickModeChange`), and when the queue changes (`onQueueChange`).

- [ ] **Step 1: Create SyncQueue.tsx**

Create `client/src/SyncQueue.tsx`:

```tsx
import { useState } from 'react'

export interface QueueRow {
  id: number
  account_id: number
  plaid_transaction_id: string
  plaid_date: string
  plaid_payee: string
  plaid_amount: number
  plaid_check_number: string | null
  match_transaction_id: number | null
  match_reason: string | null
  match_confidence: number | null
  match_payee: string | null
  match_date: string | null
  status: 'auto_matched' | 'needs_review' | 'new'
}

export interface SyncQueueProps {
  accountName: string
  rows: QueueRow[]
  onHighlight: (txId: number | null) => void
  onQueueChange: () => void
  onPickModeChange: (queueRowId: number | null) => void
}

function fmtAmt(amount: number): string {
  const abs = Math.abs(amount).toFixed(2)
  return amount < 0 ? `-$${abs}` : `$${abs}`
}

function confidenceLabel(row: QueueRow): string {
  if (row.match_confidence == null) return ''
  const pct = Math.round(row.match_confidence * 100)
  if (row.match_confidence >= 0.92) return `${pct}% — strong match`
  if (row.match_confidence >= 0.70) return `${pct}% — likely match`
  return `${pct}% — possible match`
}

export default function SyncQueue({ accountName, rows, onHighlight, onQueueChange, onPickModeChange }: SyncQueueProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [pickModeId, setPickModeId] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (rows.length === 0) return null

  if (collapsed) {
    return (
      <div className="border-b border-blue-200 bg-blue-50 px-3 py-2 flex justify-between items-center text-sm">
        <span className="text-blue-800 font-medium">{rows.length} transaction{rows.length !== 1 ? 's' : ''} pending review</span>
        <button onClick={() => setCollapsed(false)} className="text-blue-600 hover:underline text-xs">Show</button>
      </div>
    )
  }

  async function callApi(path: string, body?: Record<string, unknown>) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
    }
    return res.json()
  }

  async function withErrorHandling(fn: () => Promise<void>) {
    try { await fn() } catch (e) { setActionError((e as Error).message) }
  }

  function clearSelection() {
    setSelectedId(null)
    setPickModeId(null)
    onHighlight(null)
    onPickModeChange(null)
  }

  async function handleAccept(row: QueueRow, forceNew = false) {
    await withErrorHandling(async () => {
      await callApi(`/api/sync/queue/${row.id}/accept`, forceNew ? { force_new: true } : undefined)
      clearSelection()
      onQueueChange()
    })
  }

  async function handleReject(row: QueueRow) {
    await withErrorHandling(async () => {
      await callApi(`/api/sync/queue/${row.id}/reject`)
      clearSelection()
      onQueueChange()
    })
  }

  async function handleUndo(row: QueueRow) {
    await withErrorHandling(async () => {
      await callApi(`/api/sync/queue/${row.id}/undo-match`)
      onQueueChange()
    })
  }

  async function handleAcceptAll() {
    await withErrorHandling(async () => {
      await callApi('/api/sync/queue/accept-all', { account_id: rows[0]?.account_id })
      clearSelection()
      setCollapsed(true)
      onQueueChange()
    })
  }

  function enterPickMode(row: QueueRow) {
    setPickModeId(row.id)
    onPickModeChange(row.id)
  }

  function exitPickMode() {
    setPickModeId(null)
    onPickModeChange(null)
  }

  function selectRow(row: QueueRow) {
    if (row.status === 'new') return
    const newId = selectedId === row.id ? null : row.id
    setSelectedId(newId)
    onHighlight(newId !== null ? (row.match_transaction_id ?? null) : null)
    if (pickModeId !== null && newId === null) exitPickMode()
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-blue-900 text-white px-3 py-2 flex justify-between items-center text-sm">
        <span className="font-semibold">
          {rows.length} transaction{rows.length !== 1 ? 's' : ''} downloaded from Plaid · {accountName}
        </span>
        <div className="flex gap-2">
          <button
            onClick={handleAcceptAll}
            className="text-xs bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-3 py-1 rounded"
          >
            Accept all &amp; close
          </button>
          <button
            onClick={() => { clearSelection(); setCollapsed(true) }}
            className="text-xs text-white opacity-70 hover:opacity-100 px-2 py-1 border border-white border-opacity-30 rounded"
          >
            ✕
          </button>
        </div>
      </div>

      {actionError && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-3 py-1 flex justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="underline ml-2">Dismiss</button>
        </div>
      )}

      {/* Column headers */}
      <div className="flex gap-2 px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold tracking-wide border-b border-blue-200">
        <span className="w-20">DATE</span>
        <span className="flex-1">PAYEE (from Plaid)</span>
        <span className="w-20 text-right">AMOUNT</span>
        <span className="w-56 pl-2">STATUS &amp; ACTION</span>
      </div>

      {/* Rows */}
      {rows.map(row => {
        const isSelected = selectedId === row.id
        const inPick = pickModeId === row.id
        const isDimmed = selectedId !== null && !isSelected

        const baseBg = row.status === 'auto_matched' ? 'bg-green-50' : 'bg-white'
        const selectedStyle = isSelected ? 'bg-amber-50 border-l-4 border-amber-400' : baseBg

        return (
          <div key={row.id} className={`${selectedStyle} ${isDimmed ? 'opacity-40' : ''} border-b border-gray-100`}>
            <div
              className={`flex gap-2 items-center px-3 py-1.5 text-sm ${row.status !== 'new' ? 'cursor-pointer' : ''}`}
              onClick={() => selectRow(row)}
            >
              <span className="w-20 text-gray-500 text-xs">{row.plaid_date}</span>
              <span className={`flex-1 font-medium ${isSelected ? 'text-amber-900' : ''}`}>{row.plaid_payee}</span>
              <span className={`w-20 text-right font-mono text-xs ${row.plaid_amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {fmtAmt(row.plaid_amount)}
              </span>
              <div className="w-56 pl-2 flex items-center gap-1 text-xs">
                {row.status === 'auto_matched' && (
                  <>
                    <span className="bg-green-600 text-white px-1.5 py-0.5 rounded whitespace-nowrap">✓ matched</span>
                    <span className="text-gray-500 truncate">→ {row.match_payee}</span>
                    <button
                      onClick={e => { e.stopPropagation(); handleUndo(row) }}
                      className="text-gray-400 hover:text-gray-600 underline ml-1 shrink-0"
                    >undo</button>
                  </>
                )}
                {row.status === 'needs_review' && (
                  <>
                    <span className="bg-amber-400 text-white px-1.5 py-0.5 rounded whitespace-nowrap">⚡ review</span>
                    <span className="text-amber-700 truncate">{confidenceLabel(row)}{row.match_payee ? ` — ${row.match_payee}` : ''}</span>
                  </>
                )}
                {row.status === 'new' && (
                  <>
                    <span className="bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded whitespace-nowrap">new</span>
                    <span className="text-gray-400">will be added</span>
                    <button
                      onClick={e => { e.stopPropagation(); handleReject(row) }}
                      className="text-red-500 hover:text-red-700 ml-1 shrink-0"
                    >✕ skip</button>
                  </>
                )}
              </div>
            </div>

            {/* Inline actions — needs_review selected, not in pick mode */}
            {isSelected && row.status === 'needs_review' && !inPick && (
              <div className="px-3 pb-2 flex gap-2 flex-wrap">
                <button onClick={() => handleAccept(row)} className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">✓ Yes, merge</button>
                <button onClick={() => handleAccept(row, true)} className="text-xs bg-white text-gray-700 border border-gray-300 px-3 py-1 rounded hover:bg-gray-50">Add as new</button>
                <button onClick={() => enterPickMode(row)} className="text-xs bg-white text-gray-700 border border-gray-300 px-3 py-1 rounded hover:bg-gray-50">Merge with…</button>
                <button onClick={() => handleReject(row)} className="text-xs bg-white text-red-600 border border-red-300 px-3 py-1 rounded hover:bg-red-50">Discard</button>
              </div>
            )}

            {/* Pick mode message */}
            {isSelected && inPick && (
              <div className="px-3 pb-2 flex items-center gap-3 text-xs text-amber-800">
                <span>Scroll down and tap a transaction to merge with.</span>
                <button onClick={exitPickMode} className="underline text-gray-500">Cancel</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/SyncQueue.tsx
git commit -m "feat: add SyncQueue pseudo-register component"
```

---

### Task 6: Register.tsx — queue integration

**Files:**
- Modify: `client/src/Register.tsx`

Register fetches the queue for the selected account, renders `SyncQueue` above the transaction list when rows exist, applies amber highlight + dim to the matched register row when a queue row is selected, and handles the "Merge with…" pick mode.

- [ ] **Step 1: Add queue state and fetch logic**

At the top of `client/src/Register.tsx`, add the import:

```typescript
import SyncQueue, { type QueueRow } from './SyncQueue'
```

Inside the `Register` function, after the existing `useState` declarations, add:

```typescript
const [queue, setQueue] = useState<QueueRow[]>([])
const [highlightTxId, setHighlightTxId] = useState<number | null>(null)
const [pickModeQueueRowId, setPickModeQueueRowId] = useState<number | null>(null)
```

Add a `loadQueue` callback (after `loadTransactions`):

```typescript
const loadQueue = useCallback(() => {
  if (selectedAccount === '') { setQueue([]); return }
  fetch('/api/sync/queue')
    .then(r => r.json())
    .then(data => {
      const acct = (data.accounts as Array<{ account_id: number; auto_matched: QueueRow[]; needs_review: QueueRow[]; new: QueueRow[] }>)
        .find(a => a.account_id === selectedAccount)
      if (acct) {
        setQueue([...acct.auto_matched, ...acct.needs_review, ...acct.new])
      } else {
        setQueue([])
      }
    })
    .catch(() => setQueue([]))
}, [selectedAccount])
```

Add a `useEffect` to call `loadQueue` when `selectedAccount` changes:

```typescript
useEffect(() => {
  loadQueue()
}, [loadQueue])
```

- [ ] **Step 2: Add merge-with handler**

Inside the `Register` function, add:

```typescript
async function handleMergeWithTx(transactionId: number) {
  if (pickModeQueueRowId == null) return
  try {
    const res = await fetch(`/api/sync/queue/${pickModeQueueRowId}/merge-with`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: transactionId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError((data as { error?: string }).error ?? `Merge failed: HTTP ${res.status}`)
      return
    }
    setPickModeQueueRowId(null)
    setHighlightTxId(null)
    loadQueue()
  } catch (e) {
    setError(String(e))
  }
}
```

- [ ] **Step 3: Render SyncQueue above the transaction table**

Find the existing `return (` block in `Register`. Just before the `{/* Filters */}` comment (around line 502 in the original), add the `SyncQueue` render:

```tsx
{queue.length > 0 && (
  <SyncQueue
    accountName={accounts.find(a => a.id === selectedAccount)?.name ?? ''}
    rows={queue}
    onHighlight={setHighlightTxId}
    onQueueChange={() => { loadQueue(); loadTransactions() }}
    onPickModeChange={setPickModeQueueRowId}
  />
)}
```

- [ ] **Step 4: Apply highlight + dim and pick-mode merge button to register rows**

In the desktop table body, change the `<tr>` for each transaction from:

```tsx
<tr className="border-b hover:bg-gray-50 group" data-tx-id={tx.id}>
```

to:

```tsx
<tr
  className={`border-b group ${
    highlightTxId === tx.id
      ? 'bg-amber-50 border-l-4 border-amber-400'
      : highlightTxId !== null
      ? 'opacity-30'
      : 'hover:bg-gray-50'
  }`}
  data-tx-id={tx.id}
>
```

In the last `<td>` of the desktop row (the edit pencil column), add the pick-mode merge button before the existing edit button:

```tsx
<td className="py-2 text-center">
  {pickModeQueueRowId !== null && (
    <button
      onClick={() => handleMergeWithTx(tx.id)}
      className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded hover:bg-amber-600"
      title="Merge this transaction with the selected Plaid transaction"
    >
      ↑ merge
    </button>
  )}
  {editingTxId !== tx.id && pickModeQueueRowId === null && (
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

Apply the same highlight + dim styling to the mobile cards. Find the mobile card `<div>`:

```tsx
<div key={tx.id} className="bg-white rounded border" data-tx-id={tx.id}>
```

Change to:

```tsx
<div
  key={tx.id}
  className={`rounded border ${
    highlightTxId === tx.id
      ? 'bg-amber-50 border-amber-400 border-l-4'
      : highlightTxId !== null
      ? 'opacity-30'
      : 'bg-white'
  }`}
  data-tx-id={tx.id}
>
```

Add the pick-mode merge button to the mobile card actions area (inside the `<div className="flex flex-col items-end gap-2">` in each mobile card), before the existing edit button:

```tsx
{pickModeQueueRowId !== null && (
  <button
    onClick={e => { e.stopPropagation(); handleMergeWithTx(tx.id) }}
    className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded"
  >
    ↑ merge
  </button>
)}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add client/src/Register.tsx
git commit -m "feat: integrate SyncQueue into Register with highlight and pick-mode"
```

---

### Task 7: Accounts.tsx — SSE progress display

**Files:**
- Modify: `client/src/Accounts.tsx`

Replace the current fire-and-forget sync with SSE streaming. Show per-institution progress rows with an indeterminate bar and state labels. Expose error detail panel. Update `ReAuthButton` to use the new SSE-based sync path.

- [ ] **Step 1: Add progress state types and state**

At the top of `client/src/Accounts.tsx`, add these types after the existing type declarations:

```typescript
type SyncState =
  | 'waiting'
  | 'fetching_balances'
  | 'fetching_transactions'
  | 'processing'
  | 'done'
  | 'error'
  | 'needs_reauth'

type ItemProgress = {
  item_id: number
  institution_name: string
  state: SyncState
  page?: number
  added?: number
  needs_review?: number
  auto_matched?: number
  error_code?: string
  error_message?: string
  request_id?: string
  error_expanded?: boolean
}
```

Inside the `Accounts` function, replace the existing state declarations:

```typescript
const [syncing, setSyncing] = useState(false)
const [syncResults, setSyncResults] = useState<string | null>(null)
```

with:

```typescript
const [syncing, setSyncing] = useState(false)
const [syncProgress, setSyncProgress] = useState<ItemProgress[]>([])
```

- [ ] **Step 2: Replace handleSync with SSE-streaming version**

Replace the existing `handleSync` function with:

```typescript
const handleSync = async () => {
  setSyncing(true)
  setSyncProgress(items.map(item => ({
    item_id: item.id,
    institution_name: item.institution_name,
    state: 'waiting',
  })))

  function updateProgress(item_id: number, patch: Partial<ItemProgress>) {
    setSyncProgress(prev => prev.map(p => p.item_id === item_id ? { ...p, ...patch } : p))
  }

  try {
    const response = await fetch('/api/plaid/sync', {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
    })

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''

      for (const block of blocks) {
        const match = block.match(/^data:\s*(.+)$/m)
        if (!match) continue
        const event = JSON.parse(match[1]) as Record<string, unknown>

        if (event.type === 'complete') {
          await fetchStatus()
          continue
        }
        const item_id = event.item_id as number
        const state = event.state as SyncState
        updateProgress(item_id, {
          state,
          page: event.page as number | undefined,
          added: event.added as number | undefined,
          needs_review: event.needs_review as number | undefined,
          auto_matched: event.auto_matched as number | undefined,
          error_code: event.error_code as string | undefined,
          error_message: event.error_message as string | undefined,
          request_id: event.request_id as string | undefined,
        })
      }
    }
  } finally {
    setSyncing(false)
  }
}
```

- [ ] **Step 3: Update ReAuthButton to use SSE sync**

In `ReAuthButton`, replace:

```typescript
await fetch('/api/plaid/sync', { method: 'POST' })
```

with:

```typescript
const response = await fetch('/api/plaid/sync', {
  method: 'POST',
  headers: { Accept: 'text/event-stream' },
})
const reader = response.body!.getReader()
while (true) {
  const { done } = await reader.read()
  if (done) break
}
```

- [ ] **Step 4: Replace sync result display with progress rows**

In the `Accounts` function's JSX, replace:

```tsx
{syncResults && (
  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
    Sync complete: {syncResults}
  </div>
)}
```

with:

```tsx
{syncProgress.length > 0 && (
  <div className="mb-4 border rounded divide-y text-sm">
    {syncProgress.map(p => (
      <div key={p.item_id} className="px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium">{p.institution_name}</span>
          <span className="text-xs text-gray-500">
            {p.state === 'waiting' && 'waiting…'}
            {p.state === 'fetching_balances' && 'Fetching balances…'}
            {p.state === 'fetching_transactions' && `Fetching transactions${p.page && p.page > 1 ? ` (page ${p.page})` : ''}…`}
            {p.state === 'processing' && 'Processing…'}
            {p.state === 'done' && (
              <span>
                Done — {p.added ?? 0} new · {p.needs_review ?? 0} review needed{' '}
                <a href="/register" className="underline text-indigo-600 ml-1">Review →</a>
              </span>
            )}
            {p.state === 'needs_reauth' && <span className="text-amber-700">Re-auth required</span>}
            {p.state === 'error' && (
              <span className="text-red-700">
                Error — {p.error_code}{' '}
                <button
                  onClick={() => setSyncProgress(prev => prev.map(x => x.item_id === p.item_id ? { ...x, error_expanded: !x.error_expanded } : x))}
                  className="underline"
                >
                  ▸ details
                </button>
              </span>
            )}
          </span>
        </div>
        {(p.state === 'fetching_balances' || p.state === 'fetching_transactions' || p.state === 'processing') && (
          <div className="h-1 rounded bg-gray-200 overflow-hidden">
            <div className="h-full bg-blue-500 animate-[slide_1.5s_ease-in-out_infinite] w-1/3" />
          </div>
        )}
        {p.state === 'done' && <div className="h-1 rounded bg-green-500" />}
        {p.error_expanded && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs space-y-1">
            <div><span className="font-medium">Error code:</span> {p.error_code}</div>
            <div><span className="font-medium">Message:</span> {p.error_message}</div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Plaid request ID:</span>
              <code className="font-mono bg-gray-100 px-1 rounded">{p.request_id}</code>
              <button
                onClick={() => p.request_id && navigator.clipboard.writeText(p.request_id)}
                className="text-blue-600 hover:underline"
              >Copy</button>
            </div>
          </div>
        )}
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 5: Add the CSS keyframe animation**

In `client/src/index.css`, add the slide animation (Tailwind arbitrary values require this in CSS):

```css
@keyframes slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add client/src/Accounts.tsx client/src/index.css
git commit -m "feat: add SSE-based sync progress display to Accounts page"
```

---

### Task 8: SyncWidget.tsx + Dashboard.tsx + App.tsx

**Files:**
- Create: `client/src/SyncWidget.tsx`
- Create: `client/src/Dashboard.tsx`
- Modify: `client/src/App.tsx`

The Dashboard page gets a `SyncWidget` that shows last-synced time, pending review count, and a "Sync now" button that navigates to Accounts and triggers a sync.

- [ ] **Step 1: Create SyncWidget.tsx**

Create `client/src/SyncWidget.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface QueueSummary {
  total_pending: number
}

interface PlaidStatusItem {
  last_synced_at: string | null
}

export default function SyncWidget() {
  const navigate = useNavigate()
  const [totalPending, setTotalPending] = useState<number | null>(null)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/sync/queue').then(r => r.json() as Promise<QueueSummary>),
      fetch('/api/plaid/status').then(r => r.json() as Promise<{ items: PlaidStatusItem[] }>),
    ])
      .then(([queue, status]) => {
        setTotalPending(queue.total_pending)
        const timestamps = status.items
          .map(i => i.last_synced_at)
          .filter((t): t is string => t != null)
          .sort()
          .reverse()
        setLastSynced(timestamps[0] ?? null)
      })
      .catch(() => { /* silent — widget is non-critical */ })
      .finally(() => setLoading(false))
  }, [])

  function handleSyncNow() {
    navigate('/accounts?sync=1')
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
        <div className="h-3 bg-gray-100 rounded w-3/4" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-sm text-gray-700">Bank Sync</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {lastSynced
              ? `Last synced ${new Date(lastSynced + 'Z').toLocaleDateString()}`
              : 'Never synced'}
          </p>
          {totalPending != null && totalPending > 0 && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              {totalPending} transaction{totalPending !== 1 ? 's' : ''} pending review
            </p>
          )}
        </div>
        <button
          onClick={handleSyncNow}
          className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700"
        >
          Sync now
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create Dashboard.tsx**

Create `client/src/Dashboard.tsx`:

```tsx
import SyncWidget from './SyncWidget'

export default function Dashboard() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SyncWidget />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update App.tsx to import Dashboard**

In `client/src/App.tsx`, add the import:

```typescript
import Dashboard from './Dashboard'
```

Remove the inline stub `function Dashboard() { ... }` block (lines 5–7 in the original file), and keep the `<Route path="/" element={<Dashboard />} />` which now uses the imported component.

The full App.tsx after the change:

```tsx
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Accounts from './Accounts'
import Register from './Register'
import Dashboard from './Dashboard'

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

- [ ] **Step 4: Handle ?sync=1 in Accounts.tsx**

The SyncWidget navigates to `/accounts?sync=1`. Accounts.tsx should auto-trigger sync when this param is present. Add this effect inside the `Accounts` function (after `fetchStatus` and `handleSync` are declared):

```typescript
useEffect(() => {
  if (new URLSearchParams(window.location.search).get('sync') === '1') {
    window.history.replaceState({}, '', '/accounts')
    if (items.length > 0) handleSync()
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [items])
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 6: Run full server test suite**

```bash
cd server && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/SyncWidget.tsx client/src/Dashboard.tsx client/src/App.tsx client/src/Accounts.tsx
git commit -m "feat: add SyncWidget, Dashboard page, and auto-sync on ?sync=1"
```

---
