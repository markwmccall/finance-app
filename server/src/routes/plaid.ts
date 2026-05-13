import { Router } from 'express'
import { Products, CountryCode } from 'plaid'
import { getPlaidClient } from '../plaid-client'
import { getDb } from '../db'

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
// Syncs all active plaid_items. Returns per-item results.
plaidRouter.post('/sync', async (_req, res) => {
  const db = getDb()
  const items = db.prepare(
    'SELECT id, plaid_item_id, access_token, cursor, status FROM plaid_items'
  ).all() as Array<{ id: number; plaid_item_id: string; access_token: string; cursor: string | null; status: string }>

  const results: Array<{ id: number; status: string; added?: number; modified?: number; removed?: number }> = []

  for (const item of items) {
    try {
      const plaid = getPlaidClient()

      // Step 1: Get current account balances
      const accountsRes = await plaid.accountsGet({ access_token: item.access_token })
      const plaidAccounts = accountsRes.data.accounts

      // Step 2: Cursor loop — accumulate all pages
      type PlaidTx = { transaction_id: string; account_id: string; date: string; name: string; merchant_name?: string | null; amount: number; pending: boolean }
      type RemovedTx = { transaction_id: string }
      const added: PlaidTx[] = []
      const modified: PlaidTx[] = []
      const removed: RemovedTx[] = []
      let cursor = item.cursor ?? undefined
      let hasMore = true

      while (hasMore) {
        const syncRes = await plaid.transactionsSync({
          access_token: item.access_token,
          cursor,
        })
        const page = syncRes.data
        added.push(...(page.added as PlaidTx[]))
        modified.push(...(page.modified as PlaidTx[]))
        removed.push(...(page.removed as RemovedTx[]))
        hasMore = page.has_more
        cursor = page.next_cursor
      }

      // Step 3: Build account_id lookup (plaid_account_id → local id)
      const accountRows = db
        .prepare('SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id = ?')
        .all(item.id) as Array<{ id: number; plaid_account_id: string }>
      const accountIdMap = new Map(accountRows.map((r) => [r.plaid_account_id, r.id]))

      // Step 4: Single DB transaction — all writes or nothing
      const upsertTx = db.prepare(`
        INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount, is_cleared)
        VALUES (@account_id, @plaid_transaction_id, @date, @payee, @amount, @is_cleared)
        ON CONFLICT(plaid_transaction_id) DO UPDATE SET
          date = excluded.date,
          payee = excluded.payee,
          amount = excluded.amount,
          is_cleared = excluded.is_cleared,
          is_removed = 0
      `)
      const softDelete = db.prepare(
        'UPDATE transactions SET is_removed = 1 WHERE plaid_transaction_id = ?'
      )
      const updateBalance = db.prepare(
        'UPDATE accounts SET current_balance = ? WHERE plaid_account_id = ?'
      )
      const updateItem = db.prepare(
        "UPDATE plaid_items SET cursor = ?, last_synced_at = datetime('now') WHERE id = ?"
      )
      const resetStatus = db.prepare(
        "UPDATE plaid_items SET status = 'active' WHERE id = ?"
      )

      db.transaction(() => {
        for (const tx of [...added, ...modified]) {
          const accountId = accountIdMap.get(tx.account_id)
          if (accountId == null) continue
          upsertTx.run({
            account_id: accountId,
            plaid_transaction_id: tx.transaction_id,
            date: tx.date,
            payee: tx.merchant_name ?? tx.name,
            amount: -(tx.amount),  // negate: Plaid positive=debit, we store negative=debit
            is_cleared: tx.pending ? 0 : 1,
          })
        }
        for (const rt of removed) {
          softDelete.run(rt.transaction_id)
        }
        for (const acct of plaidAccounts) {
          updateBalance.run(acct.balances.current ?? 0, acct.account_id)
        }
        resetStatus.run(item.id)
        updateItem.run(cursor ?? null, item.id)
      })()

      results.push({ id: item.id, status: 'ok', added: added.length, modified: modified.length, removed: removed.length })
    } catch (err: unknown) {
      const plaidErr = err as { response?: { data?: { error_code?: string } } }
      if (plaidErr.response?.data?.error_code === 'ITEM_LOGIN_REQUIRED') {
        db.prepare("UPDATE plaid_items SET status = 'needs_reauth' WHERE id = ?").run(item.id)
        results.push({ id: item.id, status: 'needs_reauth' })
        continue
      }
      const errData = (plaidErr as { response?: { data?: { error_code?: string; error_message?: string; request_id?: string } } }).response?.data
      console.error(`sync error for item ${item.id}:`, errData?.error_code, errData?.error_message, errData?.request_id)
      results.push({ id: item.id, status: 'error' })
    }
  }

  res.json({ results })
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
