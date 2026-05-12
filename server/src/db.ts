import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

let instance: Database.Database | null = null

export function createDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'data', 'finance.db')
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  }
  instance = new Database(resolvedPath)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')
  return instance
}

export function getDb(): Database.Database {
  if (!instance) throw new Error('Database not initialized. Call createDb() first.')
  return instance
}

export function closeDb(): void {
  if (instance) {
    instance.close()
    instance = null
  }
}
