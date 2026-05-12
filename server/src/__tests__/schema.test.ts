import { createDb, getDb, closeDb } from '../db'
import { createTables } from '../schema'

beforeEach(() => {
  createDb(':memory:')
  createTables(getDb())
})

afterEach(() => {
  closeDb()
})

test('createTables creates plaid_items table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plaid_items'").get()
  expect(row).toBeDefined()
})

test('createTables creates accounts table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get()
  expect(row).toBeDefined()
})

test('createTables creates transactions table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'").get()
  expect(row).toBeDefined()
})

test('createTables creates scheduled_transactions table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_transactions'").get()
  expect(row).toBeDefined()
})

test('createTables creates categories table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'").get()
  expect(row).toBeDefined()
})

test('createTables creates transaction_splits table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transaction_splits'").get()
  expect(row).toBeDefined()
})

test('transactions table has is_removed column', () => {
  const db = getDb()
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>
  expect(cols.map(c => c.name)).toContain('is_removed')
})
