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
    console.error('link-token error:', err)
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
    console.error('exchange-token error:', err)
    res.status(500).json({ error: 'Failed to exchange token' })
  }
})
