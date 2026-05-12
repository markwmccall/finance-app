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
