import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

let client: PlaidApi | null = null

export function getPlaidClient(): PlaidApi {
  if (client) return client
  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID ?? '',
        'PLAID-SECRET': process.env.PLAID_SECRET ?? '',
      },
    },
  })
  client = new PlaidApi(config)
  return client
}

export function _resetForTesting(): void {
  client = null
}
