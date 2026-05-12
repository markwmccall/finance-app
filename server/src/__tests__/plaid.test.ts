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
