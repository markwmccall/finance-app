import { Router, Request, Response } from 'express'
import { getDb } from '../db'

export const categoriesRouter = Router()

categoriesRouter.post('/reorder', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const { categories } = req.body as { categories: Array<{ id: number; sort_order: number }> }
    if (!categories || categories.length === 0) {
      res.status(400).json({ error: 'categories array is required' })
      return
    }
    const update = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?')
    db.transaction(() => {
      for (const { id, sort_order } of categories) {
        update.run(sort_order, id)
      }
    })()
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /api/categories/reorder error:', err)
    res.status(500).json({ error: 'Failed to reorder categories' })
  }
})

categoriesRouter.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const { name, parent_id } = req.body as { name?: string; parent_id?: number }
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    if (parent_id !== undefined) {
      const parent = db.prepare('SELECT id FROM categories WHERE id = ?').get(parent_id)
      if (!parent) {
        res.status(400).json({ error: 'Parent category not found' })
        return
      }
    }
    const result = db.prepare(
      'INSERT INTO categories (name, parent_id, is_system, is_active, sort_order) VALUES (?, ?, 0, 1, 0)'
    ).run(name, parent_id ?? null)
    res.status(201).json({ id: result.lastInsertRowid })
  } catch (err) {
    console.error('POST /api/categories error:', err)
    res.status(500).json({ error: 'Failed to create category' })
  }
})

categoriesRouter.patch('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const id = Number(req.params.id)
    const cat = db.prepare(
      'SELECT id, is_system FROM categories WHERE id = ?'
    ).get(id) as { id: number; is_system: number } | undefined
    if (!cat) {
      res.status(404).json({ error: 'Category not found' })
      return
    }
    if (cat.is_system) {
      res.status(400).json({ error: 'Cannot rename system category' })
      return
    }
    const { name } = req.body as { name: string }
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id)
    res.json({ id })
  } catch (err) {
    console.error('PATCH /api/categories/:id error:', err)
    res.status(500).json({ error: 'Failed to rename category' })
  }
})

categoriesRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const id = Number(req.params.id)
    const cat = db.prepare(
      'SELECT id, is_system FROM categories WHERE id = ?'
    ).get(id) as { id: number; is_system: number } | undefined
    if (!cat) {
      res.status(404).json({ error: 'Category not found' })
      return
    }
    if (cat.is_system) {
      res.status(400).json({ error: 'Cannot deactivate system category' })
      return
    }
    const activeChildren = db.prepare(
      'SELECT COUNT(*) as n FROM categories WHERE parent_id = ? AND is_active = 1'
    ).get(id) as { n: number }
    if (activeChildren.n > 0) {
      res.status(400).json({ error: 'Cannot deactivate a category with active children' })
      return
    }
    db.prepare('UPDATE categories SET is_active = 0 WHERE id = ?').run(id)
    res.json({ id })
  } catch (err) {
    console.error('DELETE /api/categories/:id error:', err)
    res.status(500).json({ error: 'Failed to deactivate category' })
  }
})

categoriesRouter.get('/', (_req, res) => {
  try {
    const db = getDb()
    const categories = db.prepare(`
      SELECT c.id, c.name, c.parent_id, pc.name as parent_name,
             c.is_system, c.is_active, c.sort_order
      FROM categories c
      LEFT JOIN categories pc ON pc.id = c.parent_id
      WHERE c.is_active = 1
      ORDER BY COALESCE(pc.sort_order, c.sort_order), c.sort_order
    `).all()
    res.json(categories)
  } catch (err) {
    console.error('GET /api/categories error:', err)
    res.status(500).json({ error: 'Failed to fetch categories' })
  }
})
