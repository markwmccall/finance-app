import { Router } from 'express'
import { getDb } from '../db'

export const accountsRouter = Router()

accountsRouter.get('/', (_req, res) => {
  try {
    const db = getDb()
    const accounts = db.prepare(`
      SELECT id, name, type, subtype, mask, is_manual, current_balance
      FROM accounts
      WHERE is_active = 1
      ORDER BY name
    `).all()
    res.json(accounts)
  } catch (err) {
    console.error('GET /api/accounts error:', err)
    res.status(500).json({ error: 'Failed to fetch accounts' })
  }
})
