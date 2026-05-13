import { Router } from 'express'
import { getDb } from '../db'

export const categoriesRouter = Router()

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
