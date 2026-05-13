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

function getCategoryId(name: string): number {
  const row = getDb().prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }
  return row.id
}

describe('POST /api/categories', () => {
  test('creates a new child category', async () => {
    const foodId = getCategoryId('Food')
    const res = await request(app).post('/api/categories').send({ name: 'Bakery', parent_id: foodId })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    const cat = getDb().prepare('SELECT * FROM categories WHERE id = ?').get(res.body.id) as {
      name: string; parent_id: number
    }
    expect(cat.name).toBe('Bakery')
    expect(cat.parent_id).toBe(foodId)
  })

  test('creates a new top-level parent category', async () => {
    const res = await request(app).post('/api/categories').send({ name: 'Gifts' })
    expect(res.status).toBe(201)
    const cat = getDb().prepare(
      'SELECT parent_id FROM categories WHERE id = ?'
    ).get(res.body.id) as { parent_id: number | null }
    expect(cat.parent_id).toBeNull()
  })

  test('returns 400 for missing name', async () => {
    const res = await request(app).post('/api/categories').send({ parent_id: 1 })
    expect(res.status).toBe(400)
  })

  test('returns 400 when parent does not exist', async () => {
    const res = await request(app).post('/api/categories').send({ name: 'Ghost Child', parent_id: 9999 })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/categories/:id', () => {
  test('renames a category', async () => {
    const id = getCategoryId('Groceries')
    const res = await request(app).patch(`/api/categories/${id}`).send({ name: 'Supermarket' })
    expect(res.status).toBe(200)
    const cat = getDb().prepare(
      'SELECT name FROM categories WHERE id = ?'
    ).get(id) as { name: string }
    expect(cat.name).toBe('Supermarket')
  })

  test('returns 400 when renaming Uncategorized', async () => {
    const id = getCategoryId('Uncategorized')
    const res = await request(app).patch(`/api/categories/${id}`).send({ name: 'Something Else' })
    expect(res.status).toBe(400)
  })

  test('returns 404 for unknown category', async () => {
    const res = await request(app).patch('/api/categories/9999').send({ name: 'Ghost' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/categories/:id', () => {
  test('deactivates a leaf category', async () => {
    const id = getCategoryId('Groceries')
    const res = await request(app).delete(`/api/categories/${id}`)
    expect(res.status).toBe(200)
    const cat = getDb().prepare(
      'SELECT is_active FROM categories WHERE id = ?'
    ).get(id) as { is_active: number }
    expect(cat.is_active).toBe(0)
  })

  test('returns 400 when deleting Uncategorized', async () => {
    const id = getCategoryId('Uncategorized')
    const res = await request(app).delete(`/api/categories/${id}`)
    expect(res.status).toBe(400)
  })

  test('returns 400 when deleting a parent with active children', async () => {
    const id = getCategoryId('Food')
    const res = await request(app).delete(`/api/categories/${id}`)
    expect(res.status).toBe(400)
  })

  test('returns 404 for unknown category', async () => {
    const res = await request(app).delete('/api/categories/9999')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/categories/reorder', () => {
  test('updates sort_order for specified categories', async () => {
    const grocId = getCategoryId('Groceries')
    const diningId = getCategoryId('Dining Out')
    const res = await request(app).post('/api/categories/reorder').send({
      categories: [
        { id: grocId, sort_order: 10 },
        { id: diningId, sort_order: 20 },
      ],
    })
    expect(res.status).toBe(200)
    const groc = getDb().prepare(
      'SELECT sort_order FROM categories WHERE id = ?'
    ).get(grocId) as { sort_order: number }
    expect(groc.sort_order).toBe(10)
    const dining = getDb().prepare(
      'SELECT sort_order FROM categories WHERE id = ?'
    ).get(diningId) as { sort_order: number }
    expect(dining.sort_order).toBe(20)
  })

  test('returns 400 for empty categories array', async () => {
    const res = await request(app).post('/api/categories/reorder').send({ categories: [] })
    expect(res.status).toBe(400)
  })
})
