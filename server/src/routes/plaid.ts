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
