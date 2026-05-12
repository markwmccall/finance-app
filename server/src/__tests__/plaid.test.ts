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
