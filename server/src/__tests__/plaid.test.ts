import request from 'supertest'
import { app } from '../index'
import { createDb, getDb, closeDb } from '../db'
import { createTables, seedTestData, seedCategories } from '../schema'
import * as plaidClientModule from '../plaid-client'

jest.mock('../plaid-client')

const mockLinkTokenCreate = jest.fn()
const mockExchangeToken = jest.fn()
const mockAccountsGet = jest.fn()
const mockTransactionsSync = jest.fn()

const mockClient = {
  linkTokenCreate: mockLinkTokenCreate,
  itemPublicTokenExchange: mockExchangeToken,
  accountsGet: mockAccountsGet,
  transactionsSync: mockTransactionsSync,
}

beforeEach(() => {
  createDb(':memory:')
  createTables(getDb())
  seedCategories(getDb())
  ;(plaidClientModule.getPlaidClient as jest.Mock).mockReturnValue(mockClient)
})

afterEach(() => {
  closeDb()
  jest.clearAllMocks()
})

describe('POST /api/plaid/link-token', () => {
  test('returns link_token for initial connection', async () => {
    mockLinkTokenCreate.mockResolvedValueOnce({
      data: { link_token: 'link-sandbox-abc123' },
    })
    const res = await request(app).post('/api/plaid/link-token').send({})
    expect(res.status).toBe(200)
    expect(res.body.link_token).toBe('link-sandbox-abc123')
    expect(mockLinkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ products: expect.arrayContaining(['transactions']) })
    )
  })

  test('returns update-mode link_token when item_id provided', async () => {
    seedTestData(getDb())
    // item id=1 is seeded by seedTestData (Truist)
    mockLinkTokenCreate.mockResolvedValueOnce({
      data: { link_token: 'link-sandbox-update-mode' },
    })
    const res = await request(app).post('/api/plaid/link-token').send({ item_id: 1 })
    expect(res.status).toBe(200)
    expect(res.body.link_token).toBe('link-sandbox-update-mode')
    // update mode: access_token present, NO products key
    const callArg = mockLinkTokenCreate.mock.calls[0][0]
    expect(callArg.access_token).toBeDefined()
    expect(callArg.products).toBeUndefined()
  })

  test('returns 404 when item_id does not exist', async () => {
    const res = await request(app).post('/api/plaid/link-token').send({ item_id: 999 })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/plaid/exchange-token', () => {
  test('exchanges public token and stores item + accounts', async () => {
    mockExchangeToken.mockResolvedValueOnce({
      data: { access_token: 'access-sandbox-xyz', item_id: 'plaid-item-abc' },
    })
    mockAccountsGet.mockResolvedValueOnce({
      data: {
        accounts: [
          {
            account_id: 'acc-001',
            name: 'Gold Standard Checking',
            type: 'depository',
            subtype: 'checking',
            mask: '1234',
            balances: { current: 1500.00 },
          },
        ],
      },
    })

    const res = await request(app)
      .post('/api/plaid/exchange-token')
      .send({ public_token: 'public-sandbox-token', institution_name: 'First National Bank' })

    expect(res.status).toBe(200)
    expect(res.body.item_id).toBeDefined()
    expect(res.body.accounts).toHaveLength(1)
    expect(res.body.accounts[0].name).toBe('Gold Standard Checking')

    // Verify DB writes
    const db = getDb()
    const item = db.prepare("SELECT * FROM plaid_items WHERE plaid_item_id = 'plaid-item-abc'").get() as any
    expect(item).toBeDefined()
    expect(item.institution_name).toBe('First National Bank')
    expect(item.access_token).toBe('access-sandbox-xyz')
    expect(item.status).toBe('active')

    const accounts = db.prepare('SELECT * FROM accounts WHERE plaid_item_id = ?').all(item.id) as any[]
    expect(accounts).toHaveLength(1)
    expect(accounts[0].plaid_account_id).toBe('acc-001')
    expect(accounts[0].current_balance).toBe(1500.00)
  })

  test('returns 400 when public_token missing', async () => {
    const res = await request(app).post('/api/plaid/exchange-token').send({})
    expect(res.status).toBe(400)
  })

  test('re-connecting same institution upserts without duplicating', async () => {
    // First connect
    mockExchangeToken.mockResolvedValueOnce({
      data: { access_token: 'access-sandbox-old', item_id: 'plaid-item-abc' },
    })
    mockAccountsGet.mockResolvedValueOnce({
      data: {
        accounts: [
          {
            account_id: 'acc-001',
            name: 'Gold Standard Checking',
            type: 'depository',
            subtype: 'checking',
            mask: '1234',
            balances: { current: 1000.00 },
          },
        ],
      },
    })
    await request(app)
      .post('/api/plaid/exchange-token')
      .send({ public_token: 'public-token-1', institution_name: 'First National Bank' })

    // Re-connect (same plaid_item_id, new access_token)
    mockExchangeToken.mockResolvedValueOnce({
      data: { access_token: 'access-sandbox-new', item_id: 'plaid-item-abc' },
    })
    mockAccountsGet.mockResolvedValueOnce({
      data: {
        accounts: [
          {
            account_id: 'acc-001',
            name: 'Gold Standard Checking',
            type: 'depository',
            subtype: 'checking',
            mask: '1234',
            balances: { current: 2000.00 },
          },
        ],
      },
    })
    await request(app)
      .post('/api/plaid/exchange-token')
      .send({ public_token: 'public-token-2', institution_name: 'First National Bank' })

    const db = getDb()
    const itemCount = (db.prepare("SELECT COUNT(*) as n FROM plaid_items WHERE plaid_item_id = 'plaid-item-abc'").get() as any).n
    expect(itemCount).toBe(1)
    const accCount = (db.prepare("SELECT COUNT(*) as n FROM accounts WHERE plaid_account_id = 'acc-001'").get() as any).n
    expect(accCount).toBe(1)
  })
})

describe('POST /api/plaid/sync', () => {
  function seedItem(db: ReturnType<typeof getDb>) {
    db.prepare(`
      INSERT INTO plaid_items (id, institution_name, plaid_item_id, access_token, status, cursor)
      VALUES (10, 'Test Bank', 'item-xxx', 'access-token-xxx', 'active', NULL)
    `).run()
    db.prepare(`
      INSERT INTO accounts (id, plaid_item_id, plaid_account_id, name, type, current_balance)
      VALUES (20, 10, 'acct-aaa', 'Checking', 'depository', 500)
    `).run()
  }

  test('runs cursor loop until has_more is false', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    // First page: has_more = true
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-1', account_id: 'acct-aaa', date: '2026-05-01', name: 'Coffee', merchant_name: null, amount: 5.00, pending: false }],
        modified: [],
        removed: [],
        has_more: true,
        next_cursor: 'cursor-page-2',
      },
    })
    // Second page: has_more = false
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-2', account_id: 'acct-aaa', date: '2026-05-02', name: 'Salary', merchant_name: null, amount: -2000.00, pending: false }],
        modified: [],
        removed: [],
        has_more: false,
        next_cursor: 'cursor-page-3',
      },
    })

    const res = await request(app).post('/api/plaid/sync').send({})
    expect(res.status).toBe(200)
    expect(mockTransactionsSync).toHaveBeenCalledTimes(2)
    // Second call must pass the cursor from the first response
    expect(mockTransactionsSync.mock.calls[1][0].cursor).toBe('cursor-page-2')

    const db = getDb()
    const txs = db.prepare('SELECT * FROM transactions WHERE account_id = 20').all() as any[]
    expect(txs).toHaveLength(2)
    // tx-1: Plaid amount 5.00 (debit) → stored as -5.00
    const coffee = txs.find((t: any) => t.plaid_transaction_id === 'tx-1')
    expect(coffee?.amount).toBeCloseTo(-5.00)
    // tx-2: Plaid amount -2000.00 (credit) → stored as +2000.00
    const salary = txs.find((t: any) => t.plaid_transaction_id === 'tx-2')
    expect(salary?.amount).toBeCloseTo(2000.00)
  })

  test('soft-deletes removed transactions', async () => {
    seedItem(getDb())
    // Seed an existing transaction to be removed
    getDb().prepare(`
      INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount)
      VALUES (20, 'tx-old', '2026-04-01', 'Old Merchant', -10)
    `).run()

    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [],
        modified: [],
        removed: [{ transaction_id: 'tx-old' }],
        has_more: false,
        next_cursor: 'cursor-x',
      },
    })

    await request(app).post('/api/plaid/sync').send({})

    const db = getDb()
    const tx = db.prepare("SELECT is_removed FROM transactions WHERE plaid_transaction_id = 'tx-old'").get() as any
    expect(tx?.is_removed).toBe(1)
  })

  test('updates account balance and cursor in a single DB transaction', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 999.99 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cursor-final' },
    })

    await request(app).post('/api/plaid/sync').send({})

    const db = getDb()
    const account = db.prepare('SELECT current_balance FROM accounts WHERE id = 20').get() as any
    expect(account.current_balance).toBeCloseTo(999.99)

    const item = db.prepare('SELECT cursor, last_synced_at FROM plaid_items WHERE id = 10').get() as any
    expect(item.cursor).toBe('cursor-final')
    expect(item.last_synced_at).not.toBeNull()
  })

  test('sets needs_reauth status on ITEM_LOGIN_REQUIRED', async () => {
    seedItem(getDb())
    const plaidError = {
      response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } },
    }
    mockAccountsGet.mockRejectedValueOnce(plaidError)

    const res = await request(app).post('/api/plaid/sync').send({})
    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe('needs_reauth')

    const db = getDb()
    const item = db.prepare('SELECT status FROM plaid_items WHERE id = 10').get() as any
    expect(item.status).toBe('needs_reauth')
  })
})
