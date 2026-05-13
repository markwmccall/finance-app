import { Router } from 'express'
import { getDb } from '../db'
import { plaidRouter } from './plaid'
import { accountsRouter } from './accounts'
import { categoriesRouter } from './categories'
import { transactionsRouter } from './transactions'

export const router = Router()

router.get('/health', (_req, res) => {
  const db = getDb()
  const result = db.prepare("SELECT 'ok' AS status").get() as { status: string }
  res.json(result)
})

router.use('/plaid', plaidRouter)
router.use('/accounts', accountsRouter)
router.use('/categories', categoriesRouter)
router.use('/transactions', transactionsRouter)
