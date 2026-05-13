import { getPlaidClient, _resetForTesting } from '../plaid-client'

const originalEnv = { ...process.env }

beforeEach(() => {
  _resetForTesting()
  process.env.PLAID_CLIENT_ID = 'test-client-id'
  process.env.PLAID_SECRET = 'test-secret'
  process.env.PLAID_ENV = 'sandbox'
})

afterEach(() => {
  _resetForTesting()
  // Restore original env (remove vars we added)
  for (const key of ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV']) {
    if (key in originalEnv) {
      process.env[key] = originalEnv[key]
    } else {
      delete process.env[key]
    }
  }
})

test('getPlaidClient returns a PlaidApi instance', () => {
  const client = getPlaidClient()
  expect(client).toBeDefined()
  expect(typeof client.linkTokenCreate).toBe('function')
  expect(typeof client.transactionsSync).toBe('function')
})

test('getPlaidClient returns the same instance on second call', () => {
  const a = getPlaidClient()
  const b = getPlaidClient()
  expect(a).toBe(b)
})
