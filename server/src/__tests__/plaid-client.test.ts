import { getPlaidClient } from '../plaid-client'

test('getPlaidClient returns a PlaidApi instance', () => {
  process.env.PLAID_CLIENT_ID = 'test-client-id'
  process.env.PLAID_SECRET = 'test-secret'
  process.env.PLAID_ENV = 'sandbox'
  const client = getPlaidClient()
  expect(client).toBeDefined()
  expect(typeof client.linkTokenCreate).toBe('function')
  expect(typeof client.transactionsSync).toBe('function')
})

test('getPlaidClient returns the same instance on second call', () => {
  process.env.PLAID_CLIENT_ID = 'test-client-id'
  process.env.PLAID_SECRET = 'test-secret'
  process.env.PLAID_ENV = 'sandbox'
  const a = getPlaidClient()
  const b = getPlaidClient()
  expect(a).toBe(b)
})
