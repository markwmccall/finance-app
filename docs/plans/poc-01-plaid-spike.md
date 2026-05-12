# Plaid Spike (POC 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the Plaid integration end-to-end — Link widget, token exchange, transaction sync, and balance fetch — before building the full app around it.

**Architecture:** Minimal Express server exposes five `/api/*` endpoints. A Vite + React client opens Plaid Link, exchanges the public token, then fetches and displays accounts and transactions in a plain unstyled list. Access token is persisted to `token.json` (gitignored) so the server survives restarts during development. No SQLite, no design system — this is throwaway code.

**Tech Stack:** Node.js 20 + Express + TypeScript (server), React 18 + Vite + TypeScript (client), plaid Node.js SDK, react-plaid-link, Jest + ts-jest + Supertest (server tests), dotenv

---

## File Map

```
poc/plaid/
├── server/
│   ├── index.ts            # Express app — middleware, mounts router, exports app for tests
│   ├── plaid-client.ts     # PlaidApi instance initialized from env vars
│   ├── token-store.ts      # Read/write access token to token.json
│   ├── routes.ts           # All /api/* route handlers
│   ├── token-store.test.ts # Token store unit tests
│   └── routes.test.ts      # Route integration tests (Plaid mocked)
├── client/
│   ├── index.html
│   ├── vite.config.ts      # Proxies /api/* to localhost:3001
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       └── App.tsx         # All UI — connect button, accounts list, transactions list
├── .env.example
├── jest.config.ts
├── package.json
└── tsconfig.json           # Server TypeScript (CommonJS)
```

`token.json` — created at runtime, gitignored, not in file map.

---

## Task 1: Initialize the POC project

**Files:**
- Create: `poc/plaid/package.json`
- Create: `poc/plaid/tsconfig.json`
- Create: `poc/plaid/jest.config.ts`
- Create: `poc/plaid/.env.example`
- Modify: `.gitignore` (root)

- [ ] **Step 1: Create the directory**

```bash
mkdir -p poc/plaid/server poc/plaid/client/src
```

- [ ] **Step 2: Write `poc/plaid/package.json`**

```json
{
  "name": "finance-plaid-poc",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "server": "tsx watch server/index.ts",
    "client": "vite client",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "plaid": "^24.0.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/supertest": "^6.0.2",
    "@vitejs/plugin-react": "^4.3.0",
    "jest": "^29.7.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-plaid-link": "^3.5.2",
    "supertest": "^7.0.0",
    "ts-jest": "^29.1.4",
    "tsx": "^4.15.5",
    "typescript": "^5.4.5",
    "vite": "^5.3.1"
  }
}
```

- [ ] **Step 3: Write `poc/plaid/tsconfig.json`** (server only — client has its own)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["server/**/*"],
  "exclude": ["node_modules", "dist", "client"]
}
```

- [ ] **Step 4: Write `poc/plaid/jest.config.ts`**

```typescript
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/server/**/*.test.ts'],
}

export default config
```

- [ ] **Step 5: Write `poc/plaid/.env.example`**

```
PLAID_CLIENT_ID=your_client_id_here
PLAID_SECRET=your_sandbox_secret_here
PLAID_ENV=sandbox
PORT=3001
VITE_APP_NAME=Finance POC
```

- [ ] **Step 6: Copy `.env.example` to `.env` and fill in real Plaid sandbox credentials**

Get `PLAID_CLIENT_ID` and `PLAID_SECRET` from https://dashboard.plaid.com → Team Settings → Keys → Sandbox secret.

```bash
cp poc/plaid/.env.example poc/plaid/.env
# Edit poc/plaid/.env with your real credentials
```

- [ ] **Step 7: Add entries to root `.gitignore`**

Add these lines to the root `.gitignore`:

```
poc/plaid/token.json
poc/plaid/node_modules/
poc/plaid/dist/
```

- [ ] **Step 8: Install dependencies**

```bash
cd poc/plaid && npm install
```

Expected: `node_modules/` created, no errors. Ignore any peer dependency warnings.

- [ ] **Step 9: Commit**

```bash
git add poc/plaid/package.json poc/plaid/tsconfig.json poc/plaid/jest.config.ts poc/plaid/.env.example .gitignore
git commit -m "feat(poc): initialize Plaid spike project structure"
```

---

## Task 2: Token store

**Files:**
- Create: `poc/plaid/server/token-store.ts`
- Create: `poc/plaid/server/token-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// poc/plaid/server/token-store.test.ts
import fs from 'fs'
import { TOKEN_FILE, saveAccessToken, loadAccessToken } from './token-store'

afterEach(() => {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE)
})

test('loadAccessToken returns null when file does not exist', () => {
  expect(loadAccessToken()).toBeNull()
})

test('saveAccessToken writes token, loadAccessToken reads it back', () => {
  saveAccessToken('access-sandbox-test123')
  expect(loadAccessToken()).toBe('access-sandbox-test123')
})

test('loadAccessToken returns null when file is malformed', () => {
  fs.writeFileSync(TOKEN_FILE, 'not valid json', 'utf-8')
  expect(loadAccessToken()).toBeNull()
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd poc/plaid && npm test -- --testPathPattern=token-store
```

Expected: 3 failures — `Cannot find module './token-store'`

- [ ] **Step 3: Write `poc/plaid/server/token-store.ts`**

```typescript
import fs from 'fs'
import path from 'path'

export const TOKEN_FILE = path.join(__dirname, '..', 'token.json')

export function saveAccessToken(token: string): void {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: token }), 'utf-8')
}

export function loadAccessToken(): string | null {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf-8')
    const data = JSON.parse(raw) as { access_token?: string }
    return data.access_token ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd poc/plaid && npm test -- --testPathPattern=token-store
```

Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 5: Commit**

```bash
git add poc/plaid/server/token-store.ts poc/plaid/server/token-store.test.ts
git commit -m "feat(poc): add token store (read/write access token to token.json)"
```

---

## Task 3: Plaid client

**Files:**
- Create: `poc/plaid/server/plaid-client.ts`

No unit test for this module — it is a thin configuration wrapper around the Plaid SDK and is mocked in all route tests.

- [ ] **Step 1: Write `poc/plaid/server/plaid-client.ts`**

```typescript
import 'dotenv/config'
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
})

export const plaidClient = new PlaidApi(configuration)
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd poc/plaid && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add poc/plaid/server/plaid-client.ts
git commit -m "feat(poc): add Plaid client (PlaidApi instance from env config)"
```

---

## Task 4: Express server + create-link-token route

**Files:**
- Create: `poc/plaid/server/index.ts`
- Create: `poc/plaid/server/routes.ts`
- Create: `poc/plaid/server/routes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// poc/plaid/server/routes.test.ts
import fs from 'fs'
import request from 'supertest'
import { app } from './index'
import { plaidClient } from './plaid-client'
import { TOKEN_FILE, saveAccessToken, loadAccessToken } from './token-store'

jest.mock('./plaid-client', () => ({
  plaidClient: {
    linkTokenCreate: jest.fn(),
    itemPublicTokenExchange: jest.fn(),
    accountsGet: jest.fn(),
    transactionsSync: jest.fn(),
  },
}))

const mockPlaid = plaidClient as jest.Mocked<typeof plaidClient>

afterEach(() => {
  jest.clearAllMocks()
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE)
})

describe('POST /api/create-link-token', () => {
  test('returns link_token from Plaid', async () => {
    mockPlaid.linkTokenCreate.mockResolvedValueOnce({
      data: { link_token: 'link-sandbox-abc123' },
    } as any)

    const res = await request(app).post('/api/create-link-token')

    expect(res.status).toBe(200)
    expect(res.body.link_token).toBe('link-sandbox-abc123')
  })

  test('returns 500 when Plaid throws', async () => {
    mockPlaid.linkTokenCreate.mockRejectedValueOnce(new Error('Plaid error'))

    const res = await request(app).post('/api/create-link-token')

    expect(res.status).toBe(500)
    expect(res.body.error).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd poc/plaid && npm test -- --testPathPattern=routes
```

Expected: failure — `Cannot find module './index'`

- [ ] **Step 3: Write `poc/plaid/server/index.ts`**

```typescript
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { router } from './routes'

const app = express()

app.use(cors())
app.use(express.json())
app.use('/api', router)

if (require.main === module) {
  const PORT = process.env.PORT ?? 3001
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}

export { app }
```

- [ ] **Step 4: Write `poc/plaid/server/routes.ts`** — create-link-token only

```typescript
import { Router } from 'express'
import { Products, CountryCode } from 'plaid'
import { plaidClient } from './plaid-client'
import { saveAccessToken, loadAccessToken } from './token-store'

export const router = Router()

router.post('/create-link-token', async (_req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'poc-user' },
      client_name: process.env.VITE_APP_NAME ?? 'Finance POC',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    })
    res.json({ link_token: response.data.link_token })
  } catch {
    res.status(500).json({ error: 'Failed to create link token' })
  }
})
```

- [ ] **Step 5: Run test — verify it passes**

```bash
cd poc/plaid && npm test -- --testPathPattern=routes
```

Expected: `Tests: 2 passed` (only the create-link-token describe block runs so far)

- [ ] **Step 6: Commit**

```bash
git add poc/plaid/server/index.ts poc/plaid/server/routes.ts poc/plaid/server/routes.test.ts
git commit -m "feat(poc): add Express server and create-link-token route"
```

---

## Task 5: Exchange token route

**Files:**
- Modify: `poc/plaid/server/routes.ts`
- Modify: `poc/plaid/server/routes.test.ts`

- [ ] **Step 1: Add the failing test** (append to `routes.test.ts` describe blocks)

```typescript
describe('POST /api/exchange-token', () => {
  test('exchanges public token, saves access token, returns success', async () => {
    mockPlaid.itemPublicTokenExchange.mockResolvedValueOnce({
      data: { access_token: 'access-sandbox-xyz789', item_id: 'item-abc' },
    } as any)

    const res = await request(app)
      .post('/api/exchange-token')
      .send({ public_token: 'public-sandbox-abc' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(loadAccessToken()).toBe('access-sandbox-xyz789')
  })

  test('returns 500 when Plaid throws', async () => {
    mockPlaid.itemPublicTokenExchange.mockRejectedValueOnce(new Error('bad token'))

    const res = await request(app)
      .post('/api/exchange-token')
      .send({ public_token: 'public-sandbox-bad' })

    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
cd poc/plaid && npm test -- --testPathPattern=routes
```

Expected: 2 new failures — `404 Not Found` for `/api/exchange-token`

- [ ] **Step 3: Add exchange-token route to `poc/plaid/server/routes.ts`**

Append after the `create-link-token` handler:

```typescript
router.post('/exchange-token', async (req, res) => {
  const { public_token } = req.body as { public_token: string }
  try {
    const response = await plaidClient.itemPublicTokenExchange({ public_token })
    saveAccessToken(response.data.access_token)
    res.json({ success: true })
  } catch {
    res.status(500).json({ error: 'Failed to exchange token' })
  }
})
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
cd poc/plaid && npm test -- --testPathPattern=routes
```

Expected: `Tests: 4 passed`

- [ ] **Step 5: Commit**

```bash
git add poc/plaid/server/routes.ts poc/plaid/server/routes.test.ts
git commit -m "feat(poc): add exchange-token route"
```

---

## Task 6: Status route

**Files:**
- Modify: `poc/plaid/server/routes.ts`
- Modify: `poc/plaid/server/routes.test.ts`

- [ ] **Step 1: Add the failing tests**

```typescript
describe('GET /api/status', () => {
  test('returns connected: false when no token file exists', async () => {
    const res = await request(app).get('/api/status')
    expect(res.status).toBe(200)
    expect(res.body.connected).toBe(false)
  })

  test('returns connected: true when token file exists', async () => {
    saveAccessToken('any-token')
    const res = await request(app).get('/api/status')
    expect(res.body.connected).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
cd poc/plaid && npm test -- --testPathPattern=routes
```

Expected: 2 new failures — `404 Not Found`

- [ ] **Step 3: Add status route to `poc/plaid/server/routes.ts`**

```typescript
router.get('/status', (_req, res) => {
  res.json({ connected: loadAccessToken() !== null })
})
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
cd poc/plaid && npm test -- --testPathPattern=routes
```

Expected: `Tests: 6 passed`

- [ ] **Step 5: Commit**

```bash
git add poc/plaid/server/routes.ts poc/plaid/server/routes.test.ts
git commit -m "feat(poc): add status route"
```

---

## Task 7: Accounts route

**Files:**
- Modify: `poc/plaid/server/routes.ts`
- Modify: `poc/plaid/server/routes.test.ts`

- [ ] **Step 1: Add the failing tests**

```typescript
describe('GET /api/accounts', () => {
  test('returns 401 when no access token', async () => {
    const res = await request(app).get('/api/accounts')
    expect(res.status).toBe(401)
  })

  test('returns mapped accounts array', async () => {
    saveAccessToken('access-sandbox-test')
    mockPlaid.accountsGet.mockResolvedValueOnce({
      data: {
        accounts: [
          {
            account_id: 'acc-1',
            name: 'Truist Checking',
            type: 'depository',
            subtype: 'checking',
            mask: '4823',
            balances: { current: 4200.0, available: 4100.0 },
          },
        ],
      },
    } as any)

    const res = await request(app).get('/api/accounts')

    expect(res.status).toBe(200)
    expect(res.body.accounts).toHaveLength(1)
    expect(res.body.accounts[0]).toEqual({
      account_id: 'acc-1',
      name: 'Truist Checking',
      type: 'depository',
      subtype: 'checking',
      mask: '4823',
      balances: { current: 4200.0, available: 4100.0 },
    })
  })

  test('returns 500 when Plaid throws', async () => {
    saveAccessToken('access-sandbox-test')
    mockPlaid.accountsGet.mockRejectedValueOnce(new Error('Plaid down'))

    const res = await request(app).get('/api/accounts')
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
cd poc/plaid && npm test -- --testPathPattern=routes
```

Expected: 3 new failures

- [ ] **Step 3: Add accounts route to `poc/plaid/server/routes.ts`**

```typescript
router.get('/accounts', async (_req, res) => {
  const accessToken = loadAccessToken()
  if (!accessToken) return void res.status(401).json({ error: 'Not connected' })

  try {
    const response = await plaidClient.accountsGet({ access_token: accessToken })
    const accounts = response.data.accounts.map(a => ({
      account_id: a.account_id,
      name: a.name,
      type: a.type,
      subtype: a.subtype ?? null,
      mask: a.mask ?? null,
      balances: {
        current: a.balances.current ?? null,
        available: a.balances.available ?? null,
      },
    }))
    res.json({ accounts })
  } catch {
    res.status(500).json({ error: 'Failed to fetch accounts' })
  }
})
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
cd poc/plaid && npm test -- --testPathPattern=routes
```

Expected: `Tests: 9 passed`

- [ ] **Step 5: Commit**

```bash
git add poc/plaid/server/routes.ts poc/plaid/server/routes.test.ts
git commit -m "feat(poc): add accounts route"
```

---

## Task 8: Transactions route

**Files:**
- Modify: `poc/plaid/server/routes.ts`
- Modify: `poc/plaid/server/routes.test.ts`

- [ ] **Step 1: Add the failing tests**

```typescript
describe('GET /api/transactions', () => {
  test('returns 401 when no access token', async () => {
    const res = await request(app).get('/api/transactions')
    expect(res.status).toBe(401)
  })

  test('returns mapped transactions from sync added array', async () => {
    saveAccessToken('access-sandbox-test')
    mockPlaid.transactionsSync.mockResolvedValueOnce({
      data: {
        added: [
          {
            transaction_id: 'tx-1',
            date: '2026-05-10',
            name: 'Publix',
            amount: 84.32,
            account_id: 'acc-1',
          },
          {
            transaction_id: 'tx-2',
            date: '2026-05-09',
            name: 'Payroll',
            amount: -2400.0,
            account_id: 'acc-1',
          },
        ],
        modified: [],
        removed: [],
        next_cursor: 'cursor-abc',
        has_more: false,
      },
    } as any)

    const res = await request(app).get('/api/transactions')

    expect(res.status).toBe(200)
    expect(res.body.transactions).toHaveLength(2)
    expect(res.body.transactions[0]).toEqual({
      transaction_id: 'tx-1',
      date: '2026-05-10',
      name: 'Publix',
      amount: 84.32,
      account_id: 'acc-1',
    })
  })

  test('returns 500 when Plaid throws', async () => {
    saveAccessToken('access-sandbox-test')
    mockPlaid.transactionsSync.mockRejectedValueOnce(new Error('Plaid down'))

    const res = await request(app).get('/api/transactions')
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
cd poc/plaid && npm test -- --testPathPattern=routes
```

Expected: 3 new failures

- [ ] **Step 3: Add transactions route to `poc/plaid/server/routes.ts`**

```typescript
router.get('/transactions', async (_req, res) => {
  const accessToken = loadAccessToken()
  if (!accessToken) return void res.status(401).json({ error: 'Not connected' })

  try {
    const response = await plaidClient.transactionsSync({ access_token: accessToken })
    const transactions = response.data.added.map(t => ({
      transaction_id: t.transaction_id,
      date: t.date,
      name: t.name,
      amount: t.amount,
      account_id: t.account_id,
    }))
    res.json({ transactions })
  } catch {
    res.status(500).json({ error: 'Failed to fetch transactions' })
  }
})
```

- [ ] **Step 4: Run all tests — verify everything passes**

```bash
cd poc/plaid && npm test
```

Expected: `Test Suites: 2 passed, 2 total` / `Tests: 12 passed, 12 total`

- [ ] **Step 5: Commit**

```bash
git add poc/plaid/server/routes.ts poc/plaid/server/routes.test.ts
git commit -m "feat(poc): add transactions route"
```

---

## Task 9: React client scaffold

**Files:**
- Create: `poc/plaid/client/index.html`
- Create: `poc/plaid/client/vite.config.ts`
- Create: `poc/plaid/client/tsconfig.json`
- Create: `poc/plaid/client/src/main.tsx`
- Create: `poc/plaid/client/src/App.tsx`

- [ ] **Step 1: Write `poc/plaid/client/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Finance POC</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `poc/plaid/client/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
```

- [ ] **Step 3: Write `poc/plaid/client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `poc/plaid/client/src/main.tsx`**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 5: Write `poc/plaid/client/src/App.tsx`** — skeleton only

```typescript
function App() {
  return <div><h1>Finance POC — Plaid Spike</h1><p>Loading...</p></div>
}

export default App
```

- [ ] **Step 6: Verify client starts**

In one terminal:
```bash
cd poc/plaid && npm run server
```
Expected: `Server running on http://localhost:3001`

In another terminal:
```bash
cd poc/plaid && npm run client
```
Expected: Vite starts on http://localhost:5173. Open it — you should see "Finance POC — Plaid Spike" and "Loading..."

- [ ] **Step 7: Commit**

```bash
git add poc/plaid/client/
git commit -m "feat(poc): add React/Vite client scaffold"
```

---

## Task 10: Plaid Link — connect button and token exchange

**Files:**
- Modify: `poc/plaid/client/src/App.tsx`

- [ ] **Step 1: Replace `poc/plaid/client/src/App.tsx`** with the full connect flow

```typescript
import { useState, useEffect, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'

interface Account {
  account_id: string
  name: string
  type: string
  subtype: string | null
  mask: string | null
  balances: { current: number | null; available: number | null }
}

interface Transaction {
  transaction_id: string
  date: string
  name: string
  amount: number
  account_id: string
}

function App() {
  const [connected, setConnected] = useState(false)
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const [acctRes, txRes] = await Promise.all([
      fetch('/api/accounts'),
      fetch('/api/transactions'),
    ])
    const { accounts } = (await acctRes.json()) as { accounts: Account[] }
    const { transactions } = (await txRes.json()) as { transactions: Transaction[] }
    setAccounts(accounts)
    setTransactions(transactions)
  }, [])

  useEffect(() => {
    async function init() {
      const statusRes = await fetch('/api/status')
      const { connected } = (await statusRes.json()) as { connected: boolean }
      setConnected(connected)

      if (connected) {
        await fetchData()
      } else {
        const linkRes = await fetch('/api/create-link-token', { method: 'POST' })
        const { link_token } = (await linkRes.json()) as { link_token: string }
        setLinkToken(link_token)
      }
      setLoading(false)
    }
    init().catch((err: Error) => { setError(err.message); setLoading(false) })
  }, [fetchData])

  const { open, ready } = usePlaidLink({
    token: linkToken ?? '',
    onSuccess: async (publicToken) => {
      await fetch('/api/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token: publicToken }),
      })
      setConnected(true)
      await fetchData()
    },
    onExit: (err) => {
      if (err) console.error('Plaid Link exit with error:', err)
    },
  })

  if (loading) return <div><h1>Finance POC — Plaid Spike</h1><p>Loading...</p></div>
  if (error) return <div><h1>Finance POC — Plaid Spike</h1><p style={{ color: 'red' }}>Error: {error}</p></div>

  if (!connected) {
    return (
      <div>
        <h1>Finance POC — Plaid Spike</h1>
        <button onClick={() => open()} disabled={!ready}>
          Connect a Bank Account
        </button>
      </div>
    )
  }

  return (
    <div>
      <h1>Finance POC — Plaid Spike</h1>

      <h2>Accounts ({accounts.length})</h2>
      <ul>
        {accounts.map(a => (
          <li key={a.account_id}>
            <strong>{a.name}</strong> (···{a.mask ?? 'N/A'}) — {a.type}/{a.subtype} —
            Current: ${a.balances.current?.toFixed(2) ?? 'N/A'} |
            Available: ${a.balances.available?.toFixed(2) ?? 'N/A'}
          </li>
        ))}
      </ul>

      <h2>Transactions ({transactions.length})</h2>
      <ul>
        {transactions.map(t => (
          <li key={t.transaction_id}>
            {t.date} | {t.name} | ${t.amount.toFixed(2)}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App
```

- [ ] **Step 2: Commit**

```bash
git add poc/plaid/client/src/App.tsx
git commit -m "feat(poc): add Plaid Link connect flow and data display"
```

---

## Task 11: End-to-end sandbox validation

This task has no code — it is the manual validation that the POC achieves its goal.

**Plaid sandbox test credentials:** When Plaid Link opens in sandbox mode, use these credentials to simulate a successful bank connection:
- Institution: search for any (e.g. "Chase" — all return sandbox data)
- Username: `user_good`
- Password: `pass_good`

- [ ] **Step 1: Start the server**

```bash
cd poc/plaid && npm run server
```

Expected: `Server running on http://localhost:3001`

- [ ] **Step 2: Start the client**

In a second terminal:
```bash
cd poc/plaid && npm run client
```

Expected: Vite running on http://localhost:5173

- [ ] **Step 3: Open http://localhost:5173 in a browser**

Expected: page loads showing "Finance POC — Plaid Spike" and a "Connect a Bank Account" button.

- [ ] **Step 4: Click "Connect a Bank Account"**

Expected: Plaid Link modal opens. If it doesn't open or shows an error, check that `PLAID_CLIENT_ID` and `PLAID_SECRET` in `poc/plaid/.env` match your Plaid sandbox credentials.

- [ ] **Step 5: Complete the Plaid Link flow using sandbox credentials**

Search for any institution. Enter `user_good` / `pass_good`. Select an account and click Continue.

Expected: Modal closes, page updates to show accounts and transactions.

- [ ] **Step 6: Verify accounts display**

Expected: At least one account listed with name, masked number, type, and a non-null balance.

- [ ] **Step 7: Verify transactions display**

Expected: At least one transaction listed with date, payee name, and amount. Sandbox data includes realistic test transactions.

- [ ] **Step 8: Restart the server and verify token persistence**

Stop the server (Ctrl+C). Run `npm run server` again. Reload http://localhost:5173.

Expected: Page loads directly to the accounts/transactions view — no "Connect" button. The `token.json` file preserved the access token across the restart.

- [ ] **Step 9: Confirm `token.json` is gitignored**

```bash
git status
```

Expected: `token.json` does NOT appear in the output. If it does, verify the root `.gitignore` has `poc/plaid/token.json`.

- [ ] **Step 10: Final commit**

```bash
git add poc/plaid/
git commit -m "feat(poc): complete Plaid spike — integration validated end to end"
```

---

## POC Complete

**What was validated:**
- Plaid Link widget opens and completes the OAuth-style flow
- Public token exchanges successfully for an access token
- `/accounts/get` returns real account names, types, masks, and balances
- `/transactions/sync` returns real transaction data (date, payee, amount)
- Access token survives server restarts

**What was intentionally skipped:** SQLite, design system, error recovery, responsive layout — all deferred to Phase 1.

**Next step:** Phase 1 implementation plan — `docs/plans/phase-01-core-app.md`
