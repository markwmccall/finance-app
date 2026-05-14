import { Router } from 'express'
import { Products, CountryCode } from 'plaid'
import { getPlaidClient } from '../plaid-client'
import { getDb } from '../db'
import { matchTransaction } from '../matching'

export const plaidRouter = Router()

// POST /api/plaid/link-token
// Body: {} for initial connection, { item_id: number } for re-auth update mode
plaidRouter.post('/link-token', async (req, res) => {
  try {
    const { item_id } = req.body as { item_id?: number }
    const plaid = getPlaidClient()

    if (item_id != null) {
      // Update mode: look up access_token for re-auth
      const item = getDb()
        .prepare('SELECT access_token FROM plaid_items WHERE id = ?')
        .get(item_id) as { access_token: string } | undefined
      if (!item) {
        res.status(404).json({ error: 'Item not found' })
        return
      }
      const response = await plaid.linkTokenCreate({
        user: { client_user_id: 'local-user' },
        client_name: process.env.VITE_APP_NAME ?? 'Finance',
        access_token: item.access_token,
        country_codes: [CountryCode.Us],
        language: 'en',
      })
      res.json({ link_token: response.data.link_token })
      return
    }

    // Initial connection
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: 'local-user' },
      client_name: process.env.VITE_APP_NAME ?? 'Finance',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    })
    res.json({ link_token: response.data.link_token })
  } catch (err) {
    const errData = (err as { response?: { data?: { error_code?: string; error_message?: string; request_id?: string } } }).response?.data
    console.error('link-token error:', errData?.error_code, errData?.error_message, errData?.request_id)
    res.status(500).json({ error: 'Failed to create link token' })
  }
})

// POST /api/plaid/exchange-token
// Body: { public_token: string, institution_name: string }
plaidRouter.post('/exchange-token', async (req, res) => {
  const { public_token, institution_name } = req.body as {
    public_token?: string
    institution_name?: string
  }
  if (!public_token) {
    res.status(400).json({ error: 'public_token is required' })
    return
  }

  try {
    const plaid = getPlaidClient()

    const exchangeRes = await plaid.itemPublicTokenExchange({ public_token })
    const { access_token, item_id: plaid_item_id } = exchangeRes.data

    const accountsRes = await plaid.accountsGet({ access_token })
    const plaidAccounts = accountsRes.data.accounts

    const db = getDb()

    const upsertItem = db.prepare(`
      INSERT INTO plaid_items (institution_name, plaid_item_id, access_token, status)
      VALUES (@institution_name, @plaid_item_id, @access_token, 'active')
      ON CONFLICT(plaid_item_id) DO UPDATE SET
        access_token = excluded.access_token,
        status = 'active'
    `)

    const upsertAccount = db.prepare(`
      INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, subtype, mask, current_balance)
      VALUES (@plaid_item_id, @plaid_account_id, @name, @type, @subtype, @mask, @current_balance)
      ON CONFLICT(plaid_account_id) DO UPDATE SET
        name = excluded.name,
        current_balance = excluded.current_balance,
        mask = excluded.mask,
        plaid_item_id = excluded.plaid_item_id
    `)

    const result = db.transaction(() => {
      upsertItem.run({ institution_name: institution_name ?? 'Unknown', plaid_item_id, access_token })
      const item = db.prepare('SELECT id FROM plaid_items WHERE plaid_item_id = ?').get(plaid_item_id) as { id: number }
      for (const acct of plaidAccounts) {
        upsertAccount.run({
          plaid_item_id: item.id,
          plaid_account_id: acct.account_id,
          name: acct.name,
          type: acct.type,
          subtype: acct.subtype ?? null,
          mask: acct.mask ?? null,
          current_balance: acct.balances.current ?? 0,
        })
      }
      return item
    })()

    const savedAccounts = db
      .prepare('SELECT id, name, type, subtype, mask, current_balance FROM accounts WHERE plaid_item_id = ?')
      .all(result.id) as Array<{ id: number; name: string; type: string; subtype: string | null; mask: string | null; current_balance: number }>

    res.json({ item_id: result.id, accounts: savedAccounts })
  } catch (err) {
    const errData = (err as { response?: { data?: { error_code?: string; error_message?: string; request_id?: string } } }).response?.data
    console.error('exchange-token error:', errData?.error_code, errData?.error_message, errData?.request_id)
    res.status(500).json({ error: 'Failed to exchange token' })
  }
})

// POST /api/plaid/sync
// Streams per-institution progress via SSE. Runs all institutions in parallel.
plaidRouter.post('/sync', async (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const emit = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  const db = getDb()
  const items = db.prepare(
    'SELECT id, plaid_item_id, access_token, cursor, status FROM plaid_items'
  ).all() as Array<{ id: number; plaid_item_id: string; access_token: string; cursor: string | null; status: string }>

  type PlaidTx = {
    transaction_id: string; account_id: string; date: string
    name: string; merchant_name?: string | null; check_number?: string | null
    amount: number; pending: boolean
  }
  type RemovedTx = { transaction_id: string }

  const syncItem = async (item: typeof items[number]) => {
    try {
      const plaid = getPlaidClient()

      emit({ item_id: item.id, state: 'fetching_balances' })
      const accountsRes = await plaid.accountsGet({ access_token: item.access_token })
      const plaidAccounts = accountsRes.data.accounts

      const added: PlaidTx[] = []
      const modified: PlaidTx[] = []
      const removed: RemovedTx[] = []
      let cursor = item.cursor ?? undefined
      let hasMore = true
      let page = 0

      while (hasMore) {
        page++
        emit({ item_id: item.id, state: 'fetching_transactions', page })
        const syncRes = await plaid.transactionsSync({ access_token: item.access_token, cursor })
        const pageData = syncRes.data
        added.push(...(pageData.added as PlaidTx[]))
        modified.push(...(pageData.modified as PlaidTx[]))
        removed.push(...(pageData.removed as RemovedTx[]))
        hasMore = pageData.has_more
        cursor = pageData.next_cursor
      }

      emit({ item_id: item.id, state: 'processing' })

      const accountRows = db
        .prepare('SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id = ?')
        .all(item.id) as Array<{ id: number; plaid_account_id: string }>
      const accountIdMap = new Map(accountRows.map(r => [r.plaid_account_id, r.id]))

      const insertQueue = db.prepare(`
        INSERT OR IGNORE INTO sync_review_queue
          (account_id, plaid_transaction_id, plaid_date, plaid_payee, plaid_amount, plaid_check_number,
           match_transaction_id, match_reason, match_confidence, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const softDelete = db.prepare('UPDATE transactions SET is_removed = 1 WHERE plaid_transaction_id = ?')
      const updateBalance = db.prepare('UPDATE accounts SET current_balance = ? WHERE plaid_account_id = ?')
      const updateItem = db.prepare(
        "UPDATE plaid_items SET cursor = ?, last_synced_at = datetime('now') WHERE id = ?"
      )
      const resetStatus = db.prepare("UPDATE plaid_items SET status = 'active' WHERE id = ?")

      let countAdded = 0
      let countNeedsReview = 0
      let countAutoMatched = 0

      db.transaction(() => {
        for (const tx of [...added, ...modified]) {
          const accountId = accountIdMap.get(tx.account_id)
          if (accountId == null) continue

          const candidates = db.prepare(`
            SELECT id, date, payee, amount, check_number
            FROM transactions
            WHERE account_id = ? AND is_manual = 1 AND plaid_transaction_id IS NULL AND is_removed = 0
          `).all(accountId) as Array<{ id: number; date: string; payee: string; amount: number; check_number: string | null }>

          const plaidAmount = -(tx.amount)
          const match = matchTransaction(
            { date: tx.date, payee: tx.merchant_name ?? tx.name, amount: plaidAmount, check_number: tx.check_number ?? null },
            candidates
          )

          let status: string
          if (match?.reason === 'check_number') {
            status = 'auto_matched'; countAutoMatched++
          } else if (match?.reason === 'amount_date_payee') {
            status = 'needs_review'; countNeedsReview++
          } else {
            status = 'new'; countAdded++
          }

          insertQueue.run(
            accountId, tx.transaction_id, tx.date,
            tx.merchant_name ?? tx.name, plaidAmount, tx.check_number ?? null,
            match?.transaction_id ?? null, match?.reason ?? null, match?.confidence ?? null,
            status
          )
        }
        for (const rt of removed) softDelete.run(rt.transaction_id)
        for (const acct of plaidAccounts) updateBalance.run(acct.balances.current ?? 0, acct.account_id)
        resetStatus.run(item.id)
        updateItem.run(cursor ?? null, item.id)
      })()

      emit({ item_id: item.id, state: 'done', added: countAdded, needs_review: countNeedsReview, auto_matched: countAutoMatched })
    } catch (err: unknown) {
      const plaidErr = err as { response?: { data?: { error_code?: string; error_message?: string; request_id?: string } } }
      if (plaidErr.response?.data?.error_code === 'ITEM_LOGIN_REQUIRED') {
        db.prepare("UPDATE plaid_items SET status = 'needs_reauth' WHERE id = ?").run(item.id)
        emit({ item_id: item.id, state: 'needs_reauth' })
        return
      }
      const errData = plaidErr.response?.data
      emit({
        item_id: item.id,
        state: 'error',
        error_code: errData?.error_code ?? 'UNKNOWN',
        error_message: errData?.error_message ?? 'An unexpected error occurred.',
        request_id: errData?.request_id ?? null,
      })
    }
  }

  await Promise.allSettled(items.map(syncItem))
  emit({ type: 'complete' })
  res.end()
})

// GET /api/plaid/status
// Returns all connected plaid_items with account count and last sync time
plaidRouter.get('/status', (_req, res) => {
  const db = getDb()
  const items = db.prepare(`
    SELECT
      pi.id,
      pi.institution_name,
      pi.status,
      pi.last_synced_at,
      COUNT(a.id) AS account_count
    FROM plaid_items pi
    LEFT JOIN accounts a ON a.plaid_item_id = pi.id AND a.is_active = 1
    GROUP BY pi.id
    ORDER BY pi.institution_name
  `).all()
  res.json({ items })
})
