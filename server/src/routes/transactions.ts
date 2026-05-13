import { Router, Request, Response } from 'express'
import { getDb } from '../db'

export const transactionsRouter = Router()

interface AccountRow {
  id: number
  current_balance: number
}

interface TxRow {
  id: number
  account_id: number
  account_name: string
  plaid_transaction_id: string | null
  date: string
  payee: string
  amount: number
  check_number: string | null
  is_cleared: number
  is_manual: number
}

interface SplitRow {
  id: number
  transaction_id: number
  category_id: number
  category_name: string
  parent_category_name: string | null
  amount: number
}

interface TxWithBalance extends TxRow {
  splits: Omit<SplitRow, 'transaction_id'>[]
  running_balance: number
}

transactionsRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const accountId = req.query.account_id !== undefined ? Number(req.query.account_id) : null
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null
    const limit = Math.max(1, Math.min(200, req.query.limit ? Number(req.query.limit) : 50))
    const offset = Math.max(0, req.query.offset ? Number(req.query.offset) : 0)

    let accountIds: number[]
    if (accountId) {
      accountIds = [accountId]
    } else {
      accountIds = (
        db.prepare('SELECT id FROM accounts WHERE is_active = 1').all() as { id: number }[]
      ).map(a => a.id)
    }

    if (accountIds.length === 0) {
      res.json({ transactions: [], total: 0 })
      return
    }

    // Expand parent category to its children for filtering
    let categoryIds: number[] | null = null
    if (categoryId) {
      const cat = db.prepare('SELECT id, parent_id, is_system FROM categories WHERE id = ?').get(categoryId) as {
        id: number
        parent_id: number | null
        is_system: number
      } | undefined
      if (!cat) {
        res.json({ transactions: [], total: 0 })
        return
      }
      if (cat.parent_id === null && !cat.is_system) {
        const children = db.prepare('SELECT id FROM categories WHERE parent_id = ?').all(categoryId) as { id: number }[]
        categoryIds = children.map(c => c.id)
      } else {
        categoryIds = [categoryId]
      }
    }

    const accountPlaceholders = accountIds.map(() => '?').join(',')

    const accounts = db.prepare(
      `SELECT id, current_balance FROM accounts WHERE id IN (${accountPlaceholders})`
    ).all(...accountIds) as AccountRow[]
    const accountBalanceMap = new Map(accounts.map(a => [a.id, a.current_balance]))

    const txRows = db.prepare(`
      SELECT t.id, t.account_id, a.name as account_name,
             t.plaid_transaction_id, t.date, t.payee, t.amount,
             t.check_number, t.is_cleared, t.is_manual
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.is_removed = 0
        AND t.account_id IN (${accountPlaceholders})
      ORDER BY t.date DESC, t.id DESC
    `).all(...accountIds) as TxRow[]

    const txIds = txRows.map(t => t.id)
    const splitsByTxId = new Map<number, Omit<SplitRow, 'transaction_id'>[]>()
    if (txIds.length > 0) {
      const splitPlaceholders = txIds.map(() => '?').join(',')
      const splitRows = db.prepare(`
        SELECT ts.id, ts.transaction_id, ts.category_id, ts.amount,
               c.name as category_name,
               pc.name as parent_category_name
        FROM transaction_splits ts
        JOIN categories c ON c.id = ts.category_id
        LEFT JOIN categories pc ON pc.id = c.parent_id
        WHERE ts.transaction_id IN (${splitPlaceholders})
      `).all(...txIds) as SplitRow[]

      for (const split of splitRows) {
        const { transaction_id, ...splitData } = split
        if (!splitsByTxId.has(transaction_id)) splitsByTxId.set(transaction_id, [])
        splitsByTxId.get(transaction_id)!.push(splitData)
      }
    }

    // Compute running balances per account (newest-first order)
    // balance[0] = account.current_balance; balance[i] = balance[i-1] - txRows[i-1].amount
    const runningBalances = new Map<number, number>()
    const balanceState = new Map(accountBalanceMap)
    for (const tx of txRows) {
      runningBalances.set(tx.id, balanceState.get(tx.account_id) ?? 0)
      balanceState.set(tx.account_id, (balanceState.get(tx.account_id) ?? 0) - tx.amount)
    }

    let allTxs: TxWithBalance[] = txRows.map(tx => ({
      ...tx,
      splits: splitsByTxId.get(tx.id) ?? [],
      running_balance: runningBalances.get(tx.id) ?? 0,
    }))

    if (categoryIds !== null) {
      const catSet = new Set(categoryIds)
      allTxs = allTxs.filter(tx => tx.splits.some(s => catSet.has(s.category_id)))
    }

    const total = allTxs.length
    const paginated = allTxs.slice(offset, offset + limit)

    res.json({ transactions: paginated, total })
  } catch (err) {
    console.error('GET /api/transactions error:', err)
    res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})

interface SplitInput {
  category_id: number
  amount: number
}

transactionsRouter.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const { account_id, date, payee, amount, splits, check_number } = req.body as {
      account_id: number
      date: string
      payee: string
      amount: number
      splits: SplitInput[]
      check_number?: string | null
    }

    if (account_id === undefined || account_id === null || !date || !payee || amount === undefined || amount === null) {
      res.status(400).json({ error: 'account_id, date, payee, and amount are required' })
      return
    }

    if (!splits || splits.length === 0) {
      res.status(400).json({ error: 'At least one split is required' })
      return
    }

    const splitSum = splits.reduce((s: number, sp: SplitInput) => s + sp.amount, 0)
    if (Math.abs(splitSum - amount) > 0.001) {
      res.status(400).json({ error: 'Split amounts must sum to transaction amount' })
      return
    }

    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id)
    if (!account) {
      res.status(400).json({ error: 'Account not found' })
      return
    }

    const validCatIds = new Set(
      (db.prepare('SELECT id FROM categories WHERE is_active = 1').all() as { id: number }[]).map(c => c.id)
    )
    const invalidCat = splits.find((s: SplitInput) => !validCatIds.has(s.category_id))
    if (invalidCat) {
      res.status(400).json({ error: `Category id ${invalidCat.category_id} not found` })
      return
    }

    const insertTx = db.prepare(
      'INSERT INTO transactions (account_id, date, payee, amount, check_number, is_cleared, is_manual) VALUES (?, ?, ?, ?, ?, 0, 1)'
    )
    const insertSplit = db.prepare(
      'INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)'
    )
    const updateBalance = db.prepare(
      'UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?'
    )

    const txId = db.transaction(() => {
      const result = insertTx.run(account_id, date, payee, amount, check_number?.trim() || null)
      const id = result.lastInsertRowid as number
      for (const split of splits) {
        insertSplit.run(id, split.category_id, split.amount)
      }
      updateBalance.run(amount, account_id)
      return id
    })()

    res.status(201).json({ id: txId })
  } catch (err) {
    console.error('POST /api/transactions error:', err)
    res.status(500).json({ error: 'Failed to create transaction' })
  }
})

transactionsRouter.patch('/:id/cleared', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const id = Number(req.params.id)
    const tx = db.prepare(
      'SELECT id, is_cleared FROM transactions WHERE id = ? AND is_removed = 0'
    ).get(id) as { id: number; is_cleared: number } | undefined
    if (!tx) {
      res.status(404).json({ error: 'Transaction not found' })
      return
    }
    const newCleared = tx.is_cleared === 0 ? 1 : 0
    db.prepare('UPDATE transactions SET is_cleared = ? WHERE id = ?').run(newCleared, id)
    res.json({ id, is_cleared: newCleared })
  } catch (err) {
    console.error('PATCH /api/transactions/:id/cleared error:', err)
    res.status(500).json({ error: 'Failed to update transaction' })
  }
})

transactionsRouter.put('/:id/splits', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const id = Number(req.params.id)
    const { splits } = req.body as { splits: SplitInput[] }

    const tx = db.prepare(
      'SELECT id, amount FROM transactions WHERE id = ? AND is_removed = 0'
    ).get(id) as { id: number; amount: number } | undefined
    if (!tx) {
      res.status(404).json({ error: 'Transaction not found' })
      return
    }

    if (!splits || splits.length === 0) {
      res.status(400).json({ error: 'At least one split is required' })
      return
    }

    const splitSum = splits.reduce((s: number, sp: SplitInput) => s + sp.amount, 0)
    if (Math.abs(splitSum - tx.amount) > 0.001) {
      res.status(400).json({ error: 'Split amounts must sum to transaction amount' })
      return
    }

    const validCatIds = new Set(
      (db.prepare('SELECT id FROM categories WHERE is_active = 1').all() as { id: number }[]).map(c => c.id)
    )
    const invalidCat = splits.find((s: SplitInput) => !validCatIds.has(s.category_id))
    if (invalidCat) {
      res.status(400).json({ error: `Category id ${invalidCat.category_id} not found` })
      return
    }

    db.transaction(() => {
      db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(id)
      const insertSplit = db.prepare(
        'INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)'
      )
      for (const split of splits) {
        insertSplit.run(id, split.category_id, split.amount)
      }
    })()

    res.json({ id })
  } catch (err) {
    console.error('PUT /api/transactions/:id/splits error:', err)
    res.status(500).json({ error: 'Failed to update splits' })
  }
})
