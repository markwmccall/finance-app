import { createDb, getDb, closeDb } from '../db'
import { createTables, seedCategories, seedTestData, migrateSchema } from '../schema'

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

test('seedCategories inserts 7 parent categories', () => {
  const db = getDb()
  seedCategories(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM categories WHERE parent_id IS NULL AND is_system = 0').get() as { n: number }).n
  expect(count).toBe(7)
})

test('seedCategories inserts 14 child categories', () => {
  const db = getDb()
  seedCategories(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM categories WHERE parent_id IS NOT NULL').get() as { n: number }).n
  expect(count).toBe(14)
})

test('seedCategories inserts 1 system category (Uncategorized)', () => {
  const db = getDb()
  seedCategories(db)
  const row = db.prepare("SELECT * FROM categories WHERE is_system = 1").get() as { name: string } | undefined
  expect(row?.name).toBe('Uncategorized')
})

test('seedCategories is idempotent — running twice does not double-insert', () => {
  const db = getDb()
  seedCategories(db)
  seedCategories(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM categories').get() as { n: number }).n
  expect(count).toBe(22) // 7 parents + 14 children + 1 system
})

test('Food · Groceries child is linked to Food parent', () => {
  const db = getDb()
  seedCategories(db)
  const parent = db.prepare("SELECT id FROM categories WHERE name = 'Food'").get() as { id: number }
  const child = db.prepare("SELECT parent_id FROM categories WHERE name = 'Groceries'").get() as { parent_id: number }
  expect(child.parent_id).toBe(parent.id)
})

test('seedTestData inserts 1 plaid_item', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM plaid_items').get() as { n: number }).n
  expect(count).toBe(1)
})

test('seedTestData inserts 2 accounts', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM accounts').get() as { n: number }).n
  expect(count).toBe(2)
})

test('seedTestData inserts 10 transactions', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM transactions').get() as { n: number }).n
  expect(count).toBe(10)
})

test('seedTestData inserts 2 scheduled transactions', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM scheduled_transactions').get() as { n: number }).n
  expect(count).toBe(2)
})

test('seedTestData is idempotent', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM accounts').get() as { n: number }).n
  expect(count).toBe(2)
})

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
