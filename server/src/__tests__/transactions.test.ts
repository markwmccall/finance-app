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
