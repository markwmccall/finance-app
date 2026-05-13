import type Database from 'better-sqlite3'

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plaid_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_name TEXT    NOT NULL,
      plaid_item_id    TEXT    NOT NULL UNIQUE,
      access_token     TEXT    NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'active',
      cursor           TEXT,
      last_synced_at   DATETIME
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      plaid_item_id     INTEGER REFERENCES plaid_items(id),
      plaid_account_id  TEXT    UNIQUE,
      name              TEXT    NOT NULL,
      type              TEXT    NOT NULL,
      subtype           TEXT,
      mask              TEXT,
      is_manual         INTEGER NOT NULL DEFAULT 0,
      starting_balance  REAL    NOT NULL DEFAULT 0,
      current_balance   REAL    NOT NULL DEFAULT 0,
      is_active         INTEGER NOT NULL DEFAULT 1
    );

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

    CREATE TABLE IF NOT EXISTS scheduled_transactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      INTEGER NOT NULL REFERENCES accounts(id),
      payee           TEXT    NOT NULL,
      amount          REAL    NOT NULL,
      frequency       TEXT    NOT NULL,
      frequency_day1  INTEGER,
      frequency_day2  INTEGER,
      next_due_date   TEXT    NOT NULL,
      end_date        TEXT,
      is_active       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      parent_id  INTEGER REFERENCES categories(id),
      is_system  INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transaction_splits (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      category_id    INTEGER NOT NULL REFERENCES categories(id),
      amount         REAL    NOT NULL
    );
  `)
}

export function seedCategories(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) as n FROM categories').get() as { n: number }).n
  if (count > 0) return

  const insertParent = db.prepare(
    'INSERT INTO categories (name, parent_id, is_system, is_active, sort_order) VALUES (?, NULL, 0, 1, ?)'
  )
  const insertChild = db.prepare(
    'INSERT INTO categories (name, parent_id, is_system, is_active, sort_order) VALUES (?, ?, 0, 1, ?)'
  )
  const insertSystem = db.prepare(
    'INSERT INTO categories (name, parent_id, is_system, is_active, sort_order) VALUES (?, NULL, 1, 1, 999)'
  )

  const seed = db.transaction(() => {
    const parents: Record<string, number> = {}
    const parentNames = ['Food', 'Transport', 'Home', 'Health', 'Personal', 'Entertainment', 'Income']
    parentNames.forEach((name, i) => {
      const result = insertParent.run(name, i)
      parents[name] = result.lastInsertRowid as number
    })

    const children: Array<[string, string, number]> = [
      ['Groceries',     'Food',          0],
      ['Dining Out',    'Food',          1],
      ['Gas',           'Transport',     0],
      ['Parking',       'Transport',     1],
      ['Utilities',     'Home',          0],
      ['Household',     'Home',          1],
      ['Healthcare',    'Health',        0],
      ['Pharmacy',      'Health',        1],
      ['Clothing',      'Personal',      0],
      ['Personal Care', 'Personal',      1],
      ['Subscriptions', 'Entertainment', 0],
      ['Travel',        'Entertainment', 1],
      ['Payroll',       'Income',        0],
      ['Other Income',  'Income',        1],
    ]

    children.forEach(([name, parentName, order]) => {
      insertChild.run(name, parents[parentName], order)
    })

    insertSystem.run('Uncategorized')
  })

  seed()
}

export function seedTestData(db: Database.Database): void {
  const existingAccounts = (db.prepare('SELECT COUNT(*) as n FROM accounts').get() as { n: number }).n
  if (existingAccounts > 0) return

  const now = new Date().toISOString()

  const item = db.prepare(
    `INSERT INTO plaid_items (institution_name, plaid_item_id, access_token, status, last_synced_at)
     VALUES (?, ?, ?, 'active', ?)`
  ).run('Truist', 'item-test-001', 'access-sandbox-test', now)

  const itemId = item.lastInsertRowid

  const checking = db.prepare(
    `INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, subtype, mask, is_manual, starting_balance, current_balance, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 1)`
  ).run(itemId, 'acc-checking-001', 'Truist Checking', 'depository', 'checking', '4823', 4250.00)

  db.prepare(
    `INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, subtype, mask, is_manual, starting_balance, current_balance, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 1)`
  ).run(itemId, 'acc-savings-001', 'Truist Savings', 'depository', 'savings', '7291', 8500.00)

  const checkingId = checking.lastInsertRowid
  const today = new Date()

  const dateStr = (daysAgo: number): string => {
    const d = new Date(today)
    d.setDate(d.getDate() - daysAgo)
    return d.toISOString().slice(0, 10)
  }

  const insertTx = db.prepare(
    `INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount, is_cleared, is_manual)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  )

  const txData: Array<[string, string, number, number]> = [
    [dateStr(0),  'Publix',       -84.32,   0],
    [dateStr(1),  'Shell',        -52.40,   1],
    [dateStr(2),  'Netflix',      -22.99,   1],
    [dateStr(3),  'Chick-fil-A',  -18.45,   1],
    [dateStr(5),  'Amazon',       -64.99,   1],
    [dateStr(7),  'Payroll',     3200.00,   1],
    [dateStr(8),  'Duke Energy',  -145.00,  1],
    [dateStr(10), 'Walgreens',    -28.50,   1],
    [dateStr(12), 'Target',       -103.22,  1],
    [dateStr(14), 'Payroll',     3200.00,   1],
  ]

  txData.forEach(([date, payee, amount, cleared], i) => {
    insertTx.run(checkingId, `plaid-tx-test-${String(i + 1).padStart(3, '0')}`, date, payee, amount, cleared)
  })

  const firstOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().slice(0, 10)
  const twoWeeksOut = new Date(today)
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14)
  const twoWeeksOutStr = twoWeeksOut.toISOString().slice(0, 10)

  db.prepare(
    `INSERT INTO scheduled_transactions (account_id, payee, amount, frequency, frequency_day1, next_due_date, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run(checkingId, 'Rent', -1800.00, 'monthly', 1, firstOfNextMonth)

  db.prepare(
    `INSERT INTO scheduled_transactions (account_id, payee, amount, frequency, next_due_date, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).run(checkingId, 'Payroll', 3200.00, 'every two weeks', twoWeeksOutStr)
}

export function migrateSchema(db: Database.Database): void {
  const cols = db.prepare('PRAGMA table_info(transactions)').all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'check_number')) {
    db.exec('ALTER TABLE transactions ADD COLUMN check_number TEXT')
  }
}
