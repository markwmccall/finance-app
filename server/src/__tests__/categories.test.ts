import request from 'supertest'
import { app } from '../index'
import { createDb, getDb, closeDb } from '../db'
import { createTables, seedCategories } from '../schema'

beforeEach(() => {
  createDb(':memory:')
  createTables(getDb())
  seedCategories(getDb())
})

afterEach(() => { closeDb() })

describe('GET /api/categories', () => {
  test('returns all active categories', async () => {
    const res = await request(app).get('/api/categories')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    // 7 parents + 14 children + 1 system = 22
    expect(res.body.length).toBe(22)
  })

  test('each category has id, name, parent_id, parent_name, is_system, is_active, sort_order', async () => {
    const res = await request(app).get('/api/categories')
    const groceries = res.body.find((c: { name: string }) => c.name === 'Groceries')
    expect(groceries).toMatchObject({
      id: expect.any(Number),
      name: 'Groceries',
      parent_id: expect.any(Number),
      parent_name: 'Food',
      is_system: 0,
      is_active: 1,
      sort_order: 0,
    })
  })

  test('parent categories have parent_id and parent_name as null', async () => {
    const res = await request(app).get('/api/categories')
    const food = res.body.find((c: { name: string }) => c.name === 'Food')
    expect(food.parent_id).toBeNull()
    expect(food.parent_name).toBeNull()
  })

  test('Uncategorized is included and marked is_system=1', async () => {
    const res = await request(app).get('/api/categories')
    const uncat = res.body.find((c: { name: string }) => c.name === 'Uncategorized')
    expect(uncat).toBeDefined()
    expect(uncat.is_system).toBe(1)
  })

  test('inactive categories are excluded', async () => {
    getDb().prepare("UPDATE categories SET is_active = 0 WHERE name = 'Groceries'").run()
    const res = await request(app).get('/api/categories')
    const groceries = res.body.find((c: { name: string }) => c.name === 'Groceries')
    expect(groceries).toBeUndefined()
    expect(res.body.length).toBe(21)
  })
})
