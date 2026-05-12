import os from 'os'
import path from 'path'
import fs from 'fs'
import { createDb, getDb, closeDb } from '../db'

afterEach(() => {
  closeDb()
})

test('createDb returns a Database instance with WAL mode', () => {
  // WAL mode requires a file-based database; :memory: always returns "memory"
  const tmpPath = path.join(os.tmpdir(), `wal-test-${Date.now()}.db`)
  try {
    const db = createDb(tmpPath)
    const row = db.pragma('journal_mode', { simple: true })
    expect(row).toBe('wal')
  } finally {
    closeDb()
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpPath + ext) } catch { /* ignore */ }
    }
  }
})

test('getDb throws before initDb is called', () => {
  expect(() => getDb()).toThrow('Database not initialized')
})

test('initDb sets the singleton; getDb returns the same instance', () => {
  const db = createDb(':memory:')
  const same = getDb()
  expect(same).toBe(db)
})

test('closeDb resets the singleton so getDb throws again', () => {
  createDb(':memory:')
  closeDb()
  expect(() => getDb()).toThrow('Database not initialized')
})
