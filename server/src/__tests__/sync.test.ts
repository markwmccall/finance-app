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
