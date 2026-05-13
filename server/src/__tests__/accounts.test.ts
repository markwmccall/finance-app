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

describe('GET /api/accounts', () => {
  test('returns all active accounts', async () => {
    const res = await request(app).get('/api/accounts')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(2) // seedTestData creates checking + savings
    const names = res.body.map((a: { name: string }) => a.name)
    expect(names).toContain('Truist Checking')
    expect(names).toContain('Truist Savings')
  })

  test('each account has id, name, type, subtype, current_balance, mask, is_manual', async () => {
    const res = await request(app).get('/api/accounts')
    const checking = res.body.find((a: { name: string }) => a.name === 'Truist Checking')
    expect(checking).toMatchObject({
      id: expect.any(Number),
      name: 'Truist Checking',
      type: 'depository',
      subtype: 'checking',
      current_balance: 4250,
      mask: '4823',
      is_manual: 0,
    })
  })

  test('does not return inactive accounts', async () => {
    getDb().prepare('UPDATE accounts SET is_active = 0 WHERE name = ?').run('Truist Savings')
    const res = await request(app).get('/api/accounts')
    expect(res.body.length).toBe(1)
    expect(res.body[0].name).toBe('Truist Checking')
  })
})
