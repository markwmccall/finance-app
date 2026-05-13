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

  test('filters by Uncategorized category_id returns matching transactions', async () => {
    const db = getDb()
    const txRow = db.prepare('SELECT id, amount FROM transactions LIMIT 1').get() as { id: number; amount: number }
    const uncatId = getCategoryId('Uncategorized')
    addSplit(txRow.id, uncatId, txRow.amount)

    const res = await request(app).get(`/api/transactions?account_id=1&category_id=${uncatId}`)
    expect(res.status).toBe(200)
    expect(res.body.transactions.length).toBe(1)
    expect(res.body.transactions[0].id).toBe(txRow.id)
  })

  test('excludes soft-deleted transactions', async () => {
    getDb().prepare(
      'UPDATE transactions SET is_removed = 1 WHERE id = (SELECT id FROM transactions LIMIT 1)'
    ).run()
    const res = await request(app).get('/api/transactions?account_id=1')
    expect(res.body.total).toBe(9)
  })

  test('each transaction row includes check_number field', async () => {
    const res = await request(app).get('/api/transactions?account_id=1')
    expect(res.status).toBe(200)
    const tx = res.body.transactions[0]
    expect('check_number' in tx).toBe(true)
    expect(tx.check_number).toBeNull()
  })
})

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
    const res = await request(app).patch(`/api/transactions/${tx.id}/cleared`)
    expect(res.status).toBe(200)
    expect(res.body.is_cleared).toBe(0)
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
