import { Router } from 'express'
import { getDb } from '../db'
import { plaidRouter } from './plaid'

export const router = Router()

router.get('/health', (_req, res) => {
  const db = getDb()
  const result = db.prepare("SELECT 'ok' AS status").get() as { status: string }
  res.json(result)
})

router.use('/plaid', plaidRouter)
