import { Router } from 'express'
import { getDb } from '../db'

export const accountsRouter = Router()

accountsRouter.get('/', (_req, res) => {
  const db = getDb()
  const accounts = db.prepare(`
    SELECT id, plaid_item_id, name, type, subtype, mask, is_manual,
           starting_balance, current_balance, is_active
    FROM accounts
    WHERE is_active = 1
    ORDER BY name
  `).all()
  res.json(accounts)
})
