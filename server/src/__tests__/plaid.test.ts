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

  function parseSseEvents(text: string): Array<Record<string, unknown>> {
    return text
      .split('\n')
      .filter(l => l.startsWith('data: '))
      .map(l => JSON.parse(l.slice(6)))
  }

  test('responds with text/event-stream content-type', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cursor-1' },
    })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
  })

  test('parks added transactions in sync_review_queue, not transactions table', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{
          transaction_id: 'tx-1', account_id: 'acct-aaa', date: '2026-05-01',
          name: 'Coffee', merchant_name: null, check_number: null, amount: 5.00, pending: false,
        }],
        modified: [], removed: [], has_more: false, next_cursor: 'cursor-1',
      },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    const db = getDb()
    const txCount = (db.prepare(
      'SELECT COUNT(*) as n FROM transactions WHERE plaid_transaction_id IS NOT NULL AND is_manual = 0'
    ).get() as { n: number }).n
    expect(txCount).toBe(0)

    const queueCount = (db.prepare('SELECT COUNT(*) as n FROM sync_review_queue').get() as { n: number }).n
    expect(queueCount).toBe(1)
  })

  test('emits done event with correct counts', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-1', account_id: 'acct-aaa', date: '2026-05-01', name: 'Coffee', merchant_name: null, check_number: null, amount: 5.00, pending: false }],
        modified: [], removed: [], has_more: false, next_cursor: 'cursor-1',
      },
    })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    const events = parseSseEvents(res.text)
    const doneEvent = events.find(e => e.state === 'done') as { item_id: number; added: number } | undefined
    expect(doneEvent).toBeDefined()
    expect(doneEvent?.item_id).toBe(10)
    expect(doneEvent?.added).toBe(1)
  })

  test('emits complete event at end', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 500 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cursor-z' },
    })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    const events = parseSseEvents(res.text)
    expect(events.find(e => e.type === 'complete')).toBeDefined()
  })

  test('runs cursor loop until has_more is false', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-1', account_id: 'acct-aaa', date: '2026-05-01', name: 'Coffee', merchant_name: null, check_number: null, amount: 5.00, pending: false }],
        modified: [], removed: [], has_more: true, next_cursor: 'cursor-page-2',
      },
    })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{ transaction_id: 'tx-2', account_id: 'acct-aaa', date: '2026-05-02', name: 'Salary', merchant_name: null, check_number: null, amount: -2000.00, pending: false }],
        modified: [], removed: [], has_more: false, next_cursor: 'cursor-page-3',
      },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    expect(mockTransactionsSync).toHaveBeenCalledTimes(2)
    expect(mockTransactionsSync.mock.calls[1][0].cursor).toBe('cursor-page-2')

    const queueCount = (getDb().prepare('SELECT COUNT(*) as n FROM sync_review_queue').get() as { n: number }).n
    expect(queueCount).toBe(2)
  })

  test('soft-deletes removed transactions from the transactions table', async () => {
    seedItem(getDb())
    getDb().prepare(
      "INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount) VALUES (20, 'tx-old', '2026-04-01', 'Old Merchant', -10)"
    ).run()

    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 600 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [{ transaction_id: 'tx-old' }], has_more: false, next_cursor: 'cursor-x' },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    const tx = getDb().prepare("SELECT is_removed FROM transactions WHERE plaid_transaction_id = 'tx-old'").get() as { is_removed: number } | undefined
    expect(tx?.is_removed).toBe(1)
  })

  test('updates account balance and cursor', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 999.99 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cursor-final' },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    const account = getDb().prepare('SELECT current_balance FROM accounts WHERE id = 20').get() as { current_balance: number }
    expect(account.current_balance).toBeCloseTo(999.99)

    const item = getDb().prepare('SELECT cursor, last_synced_at FROM plaid_items WHERE id = 10').get() as { cursor: string; last_synced_at: string }
    expect(item.cursor).toBe('cursor-final')
    expect(item.last_synced_at).not.toBeNull()
  })

  test('emits needs_reauth event and sets item status on ITEM_LOGIN_REQUIRED', async () => {
    seedItem(getDb())
    mockAccountsGet.mockRejectedValueOnce({ response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } } })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    const events = parseSseEvents(res.text)
    const reauthEvent = events.find(e => e.state === 'needs_reauth')
    expect(reauthEvent).toBeDefined()
    expect(reauthEvent?.item_id).toBe(10)

    const item = getDb().prepare('SELECT status FROM plaid_items WHERE id = 10').get() as { status: string }
    expect(item.status).toBe('needs_reauth')
  })

  test('emits error event with error_code, error_message, and request_id', async () => {
    seedItem(getDb())
    mockAccountsGet.mockRejectedValueOnce({
      response: {
        data: { error_code: 'RATE_LIMIT_EXCEEDED', error_message: 'Too many requests.', request_id: 'req-abc-123' },
      },
    })

    const res = await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')
    const events = parseSseEvents(res.text)
    const errorEvent = events.find(e => e.state === 'error') as { error_code: string; error_message: string; request_id: string } | undefined
    expect(errorEvent?.error_code).toBe('RATE_LIMIT_EXCEEDED')
    expect(errorEvent?.error_message).toBe('Too many requests.')
    expect(errorEvent?.request_id).toBe('req-abc-123')
  })

  test('check_number on Plaid transaction is stored in queue row', async () => {
    seedItem(getDb())
    mockAccountsGet.mockResolvedValue({ data: { accounts: [{ account_id: 'acct-aaa', balances: { current: 500 } }] } })
    mockTransactionsSync.mockResolvedValueOnce({
      data: {
        added: [{
          transaction_id: 'tx-check', account_id: 'acct-aaa', date: '2026-05-01',
          name: 'Electric Company', merchant_name: null, check_number: '1247', amount: 145.00, pending: false,
        }],
        modified: [], removed: [], has_more: false, next_cursor: 'cursor-x',
      },
    })

    await request(app).post('/api/plaid/sync').set('Accept', 'text/event-stream')

    const qRow = getDb().prepare(
      "SELECT plaid_check_number FROM sync_review_queue WHERE plaid_transaction_id = 'tx-check'"
    ).get() as { plaid_check_number: string | null } | undefined
    expect(qRow?.plaid_check_number).toBe('1247')
  })
})

describe('GET /api/plaid/status', () => {
  test('returns empty array when no items connected', async () => {
    const res = await request(app).get('/api/plaid/status')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  test('returns items with account_count and last_synced_at', async () => {
    const db = getDb()
    db.prepare(`
      INSERT INTO plaid_items (id, institution_name, plaid_item_id, access_token, status, last_synced_at)
      VALUES (50, 'Truist', 'item-truist', 'access-truist', 'active', '2026-05-10 12:00:00')
    `).run()
    db.prepare(`
      INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, current_balance, is_active)
      VALUES (50, 'acct-t1', 'Checking', 'depository', 1200, 1),
             (50, 'acct-t2', 'Savings', 'depository', 3000, 1)
    `).run()

    const res = await request(app).get('/api/plaid/status')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    const item = res.body.items[0]
    expect(item.institution_name).toBe('Truist')
    expect(item.status).toBe('active')
    expect(item.account_count).toBe(2)
    expect(item.last_synced_at).toBe('2026-05-10 12:00:00')
    expect(item.access_token).toBeUndefined()
  })

  test('returns needs_reauth status correctly', async () => {
    const db = getDb()
    db.prepare(`
      INSERT INTO plaid_items (id, institution_name, plaid_item_id, access_token, status)
      VALUES (51, 'Ally', 'item-ally', 'access-ally', 'needs_reauth')
    `).run()

    const res = await request(app).get('/api/plaid/status')
    expect(res.body.items[0].status).toBe('needs_reauth')
  })
})
