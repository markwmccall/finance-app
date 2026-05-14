import { Router } from 'express'
import { getDb } from '../db'

export const syncRouter = Router()

// GET /api/sync/queue
syncRouter.get('/queue', (_req, res) => {
  const db = getDb()

  type QueueRow = {
    id: number; account_id: number; account_name: string
    plaid_transaction_id: string; plaid_date: string; plaid_payee: string
    plaid_amount: number; plaid_check_number: string | null
    match_transaction_id: number | null; match_reason: string | null
    match_confidence: number | null; status: string
    match_payee: string | null; match_date: string | null
  }

  const rows = db.prepare(`
    SELECT
      q.id, q.account_id, a.name AS account_name,
      q.plaid_transaction_id, q.plaid_date, q.plaid_payee,
      q.plaid_amount, q.plaid_check_number,
      q.match_transaction_id, q.match_reason, q.match_confidence, q.status,
      t.payee AS match_payee, t.date AS match_date
    FROM sync_review_queue q
    JOIN accounts a ON a.id = q.account_id
    LEFT JOIN transactions t ON t.id = q.match_transaction_id
    ORDER BY q.account_id, q.id
  `).all() as QueueRow[]

  const accountMap = new Map<number, {
    account_id: number; account_name: string
    auto_matched: QueueRow[]; needs_review: QueueRow[]; new: QueueRow[]
  }>()

  for (const row of rows) {
    if (!accountMap.has(row.account_id)) {
      accountMap.set(row.account_id, {
        account_id: row.account_id, account_name: row.account_name,
        auto_matched: [], needs_review: [], new: [],
      })
    }
    const entry = accountMap.get(row.account_id)!
    if (row.status === 'auto_matched') entry.auto_matched.push(row)
    else if (row.status === 'needs_review') entry.needs_review.push(row)
    else if (row.status === 'new') entry.new.push(row)
  }

  res.json({ accounts: Array.from(accountMap.values()), total_pending: rows.length })
})

// POST /api/sync/queue/accept-all
// Defined before /:id/* so Express does not match 'accept-all' as an id param
syncRouter.post('/queue/accept-all', (req, res) => {
  const { account_id } = req.body as { account_id?: number }
  const db = getDb()

  type AcceptRow = {
    id: number; account_id: number; plaid_transaction_id: string
    plaid_date: string; plaid_payee: string; plaid_amount: number
    plaid_check_number: string | null; match_transaction_id: number | null; status: string
  }

  const toAccept = db.prepare(`
    SELECT q.id, q.account_id, q.plaid_transaction_id, q.plaid_date, q.plaid_payee,
           q.plaid_amount, q.plaid_check_number, q.match_transaction_id, q.status
    FROM sync_review_queue q
    WHERE q.status = 'auto_matched'
    ${account_id != null ? 'AND q.account_id = ?' : ''}
  `).all(...(account_id != null ? [account_id] : [])) as AcceptRow[]

  const mergeStmt = db.prepare(`
    UPDATE transactions SET plaid_transaction_id = ?, is_cleared = 1 WHERE id = ?
  `)
  const insertStmt = db.prepare(`
    INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount, check_number, is_cleared, is_manual, is_removed)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)
  `)
  const deleteStmt = db.prepare('DELETE FROM sync_review_queue WHERE id = ?')

  db.transaction(() => {
    for (const row of toAccept) {
      if (row.status === 'auto_matched' && row.match_transaction_id != null) {
        mergeStmt.run(row.plaid_transaction_id, row.match_transaction_id)
      } else {
        insertStmt.run(
          row.account_id, row.plaid_transaction_id, row.plaid_date,
          row.plaid_payee, row.plaid_amount, row.plaid_check_number ?? null
        )
      }
      deleteStmt.run(row.id)
    }
  })()

  res.json({ accepted: toAccept.length })
})

// POST /api/sync/queue/:id/accept
syncRouter.post('/queue/:id/accept', (req, res) => {
  const id = Number(req.params.id)
  const { force_new } = req.body as { force_new?: boolean }
  const db = getDb()

  type AcceptRow = {
    id: number; account_id: number; plaid_transaction_id: string
    plaid_date: string; plaid_payee: string; plaid_amount: number
    plaid_check_number: string | null; match_transaction_id: number | null; status: string
  }

  const row = db.prepare(`
    SELECT id, account_id, plaid_transaction_id, plaid_date, plaid_payee,
           plaid_amount, plaid_check_number, match_transaction_id, status
    FROM sync_review_queue WHERE id = ?
  `).get(id) as AcceptRow | undefined

  if (!row) { res.status(404).json({ error: 'Queue row not found' }); return }

  db.transaction(() => {
    if (!force_new && row.status !== 'new' && row.match_transaction_id != null) {
      db.prepare(
        'UPDATE transactions SET plaid_transaction_id = ?, is_cleared = 1 WHERE id = ?'
      ).run(row.plaid_transaction_id, row.match_transaction_id)
    } else {
      db.prepare(`
        INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount, check_number, is_cleared, is_manual, is_removed)
        VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)
      `).run(
        row.account_id, row.plaid_transaction_id, row.plaid_date,
        row.plaid_payee, row.plaid_amount, row.plaid_check_number ?? null
      )
    }
    db.prepare('DELETE FROM sync_review_queue WHERE id = ?').run(id)
  })()

  res.json({ ok: true })
})

// POST /api/sync/queue/:id/reject
syncRouter.post('/queue/:id/reject', (req, res) => {
  const id = Number(req.params.id)
  const db = getDb()
  const info = db.prepare('DELETE FROM sync_review_queue WHERE id = ?').run(id)
  if (info.changes === 0) { res.status(404).json({ error: 'Queue row not found' }); return }
  res.json({ ok: true })
})

// POST /api/sync/queue/:id/undo-match
syncRouter.post('/queue/:id/undo-match', (req, res) => {
  const id = Number(req.params.id)
  const db = getDb()
  const info = db.prepare(
    "UPDATE sync_review_queue SET status = 'needs_review' WHERE id = ?"
  ).run(id)
  if (info.changes === 0) { res.status(404).json({ error: 'Queue row not found' }); return }
  res.json({ ok: true })
})

// POST /api/sync/queue/:id/merge-with
syncRouter.post('/queue/:id/merge-with', (req, res) => {
  const id = Number(req.params.id)
  const { transaction_id } = req.body as { transaction_id: number }
  const db = getDb()

  const row = db.prepare('SELECT id, plaid_transaction_id FROM sync_review_queue WHERE id = ?').get(id) as {
    id: number; plaid_transaction_id: string
  } | undefined
  if (!row) { res.status(404).json({ error: 'Queue row not found' }); return }

  const target = db.prepare(
    'SELECT id, plaid_transaction_id, is_removed FROM transactions WHERE id = ?'
  ).get(transaction_id) as { id: number; plaid_transaction_id: string | null; is_removed: number } | undefined

  if (!target || target.is_removed || target.plaid_transaction_id != null) {
    res.status(400).json({ error: 'Invalid merge target' })
    return
  }

  db.transaction(() => {
    db.prepare(
      'UPDATE transactions SET plaid_transaction_id = ?, is_cleared = 1 WHERE id = ?'
    ).run(row.plaid_transaction_id, transaction_id)
    db.prepare('DELETE FROM sync_review_queue WHERE id = ?').run(id)
  })()

  res.json({ ok: true })
})
