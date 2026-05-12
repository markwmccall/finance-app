# Phase 1a — Scaffold & Database Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full monorepo — Express server + React/Vite/Tailwind client + SQLite database — all wired together and running locally, with all six database tables created and seeded with categories and test data.

**Architecture:** npm workspaces with `server/` and `client/` packages. The Express server handles API routes (`/api/*`) and serves the PWA manifest dynamically. In development, Vite serves the frontend and proxies API calls to the Express server. In production, Express serves the built Vite output as static files. SQLite via `better-sqlite3` with WAL mode. The DB is initialized (tables + seeds) at server startup.

**Tech Stack:** Node.js 24, TypeScript 5, Express 4, React 18, Vite 5, Tailwind CSS 3, React Router 6, better-sqlite3, Jest 29 + ts-jest, concurrently

---

## File Map

```
finance-app/
├── package.json               # root workspace: workspaces: [server, client], dev script via concurrently
├── tsconfig.base.json         # shared TS options: strict, esModuleInterop, skipLibCheck
├── .env.example               # template: VITE_APP_NAME, PORT, DB_PATH, PLAID_*
├── .gitignore                 # existing — add data/ entry
├── data/                      # created at runtime by server; gitignored (*.db rule already covers it)
├── server/
│   ├── package.json           # deps: express, cors, dotenv, better-sqlite3, plaid; dev: tsx, typescript, jest, ts-jest, supertest, @types/*
│   ├── tsconfig.json          # extends ../tsconfig.base.json; module: CommonJS; rootDir: src
│   ├── jest.config.js         # ts-jest preset, testEnvironment: node (js not ts — avoids ts-node requirement)
│   └── src/
│       ├── index.ts           # Express entry: cors, json, /manifest.json route, /api router, static files in prod, startup init
│       ├── db.ts              # createDb(path?), getDb(), closeDb() — singleton with WAL mode
│       ├── schema.ts          # createTables(db), seedCategories(db), seedTestData(db)
│       ├── routes/
│       │   └── index.ts       # mounts all routers; GET /health returns DB ping
│       └── __tests__/
│           ├── db.test.ts     # createDb(':memory:'), WAL mode verification
│           └── schema.test.ts # createTables creates all 6 tables; seedCategories correct counts; seedTestData correct counts
├── client/
│   ├── package.json           # deps: react, react-dom, react-router-dom; dev: vite, @vitejs/plugin-react, tailwindcss, postcss, autoprefixer, typescript, @types/react, @types/react-dom
│   ├── tsconfig.json          # extends ../tsconfig.base.json; module: ESNext; moduleResolution: bundler; jsx: react-jsx; noEmit: true
│   ├── vite.config.ts         # react plugin; port 5173; proxy /api and /manifest.json to localhost:3001
│   ├── tailwind.config.js     # content: index.html + src/**/*.{ts,tsx}
│   ├── postcss.config.js      # tailwindcss + autoprefixer
│   ├── index.html             # PWA meta tags; %VITE_APP_NAME% title; /manifest.json link; /icon-192.png apple-touch-icon
│   └── src/
│       ├── vite-env.d.ts      # ImportMetaEnv: VITE_APP_NAME
│       ├── index.css          # @tailwind base/components/utilities
│       ├── main.tsx           # createRoot with StrictMode
│       └── App.tsx            # BrowserRouter + Nav + 5 placeholder views
```

---

## Task 1: Root workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "finance-app",
  "version": "0.0.1",
  "private": true,
  "workspaces": ["server", "client"],
  "scripts": {
    "dev": "concurrently -n server,client -c cyan,green \"npm run dev -w server\" \"npm run dev -w client\"",
    "test": "npm run test -w server"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Write `.env.example`**

```
VITE_APP_NAME=Finance
PORT=3001
DB_PATH=data/finance.db
PLAID_CLIENT_ID=your_client_id_here
PLAID_SECRET=your_sandbox_secret_here
PLAID_ENV=sandbox
```

- [ ] **Step 4: Add `data/` to `.gitignore`**

Open `.gitignore` and add this line (the `*.db` rule already covers database files, but the directory entry makes the ignore intent explicit):

```
data/
```

- [ ] **Step 5: Install root dependencies**

```bash
npm install
```

Expected: `node_modules/` created at the root with `concurrently`. No errors.

- [ ] **Step 6: Copy `.env.example` to `.env` and fill in Plaid credentials**

```bash
cp .env.example .env
```

Edit `.env`: set `PLAID_CLIENT_ID` and `PLAID_SECRET` from your Plaid sandbox dashboard. The `.env` file is gitignored — never commit it.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json .env.example .gitignore
git commit -m "feat: initialize monorepo workspace (server + client)"
```

---

## Task 2: Server scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/jest.config.js`
- Create: `server/src/routes/index.ts`
- Create: `server/src/index.ts`

- [ ] **Step 1: Write `server/package.json`**

```json
{
  "name": "finance-app-server",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {
    "better-sqlite3": "^9.6.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "plaid": "^24.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^24.0.0",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.1.4",
    "tsx": "^4.15.5",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Write `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `server/jest.config.js`**

Use `.js` (not `.ts`) — `ts-jest` cannot parse a TypeScript config file without `ts-node` installed.

```javascript
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.ts'],
}
module.exports = config
```

- [ ] **Step 4: Write `server/src/routes/index.ts`**

```typescript
import { Router } from 'express'
import { getDb } from '../db'

export const router = Router()

router.get('/health', (_req, res) => {
  const db = getDb()
  const result = db.prepare("SELECT 'ok' AS status").get() as { status: string }
  res.json(result)
})
```

- [ ] **Step 5: Write `server/src/index.ts`**

```typescript
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { router } from './routes'

const app = express()

app.use(cors())
app.use(express.json())

app.get('/manifest.json', (_req, res) => {
  res.json({
    name: process.env.VITE_APP_NAME ?? 'Finance',
    short_name: process.env.VITE_APP_NAME ?? 'Finance',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#6366f1',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  })
})

app.use('/api', router)

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

if (require.main === module) {
  const PORT = process.env.PORT ?? 3001
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}

export { app }
```

Note: DB initialization (Task 4) will be added to the `require.main` block later.

- [ ] **Step 6: Install server dependencies**

```bash
npm install -w server
```

Expected: `server/node_modules/` created. No errors. Ignore any peer dependency warnings.

- [ ] **Step 7: Commit**

TypeScript compilation is verified at the end of Task 4, once `db.ts` exists.

```bash
git add server/package.json server/tsconfig.json server/jest.config.js server/src/
git commit -m "feat: add server package scaffold (Express + TypeScript)"
```

---

## Task 3: Client scaffold

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/vite.config.ts`
- Create: `client/tailwind.config.js`
- Create: `client/postcss.config.js`
- Create: `client/index.html`
- Create: `client/src/vite-env.d.ts`
- Create: `client/src/index.css`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`

- [ ] **Step 1: Write `client/package.json`**

```json
{
  "name": "finance-app-client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-plaid-link": "^3.5.2",
    "react-router-dom": "^6.23.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5",
    "vite": "^5.3.1"
  }
}
```

- [ ] **Step 2: Write `client/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `client/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/manifest.json': 'http://localhost:3001',
    },
  },
})
```

- [ ] **Step 4: Write `client/tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 5: Write `client/postcss.config.js`**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 6: Write `client/index.html`**

Vite replaces `%VITE_APP_NAME%` at build time from the `.env` file.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
    <meta name="theme-color" content="#6366f1" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="%VITE_APP_NAME%" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <link rel="manifest" href="/manifest.json" />
    <title>%VITE_APP_NAME%</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `client/src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 8: Write `client/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 9: Write `client/src/main.tsx`**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 10: Write `client/src/App.tsx`**

```typescript
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'

function Dashboard() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Dashboard</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Register() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Register</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Calendar() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Calendar</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Scheduled() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Scheduled</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Accounts() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Accounts</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/register', label: 'Register', end: false },
  { to: '/calendar', label: 'Calendar', end: false },
  { to: '/scheduled', label: 'Scheduled', end: false },
  { to: '/accounts', label: 'Accounts', end: false },
]

function Nav() {
  return (
    <nav className="bg-indigo-600 text-white px-4 py-3 flex items-center gap-6 shadow">
      <span className="font-semibold text-lg mr-2">
        {import.meta.env.VITE_APP_NAME}
      </span>
      {navItems.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            isActive ? 'font-semibold underline underline-offset-4' : 'opacity-75 hover:opacity-100 transition-opacity'
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/register" element={<Register />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/scheduled" element={<Scheduled />} />
            <Route path="/accounts" element={<Accounts />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
```

- [ ] **Step 11: Install client dependencies**

```bash
npm install -w client
```

Expected: `client/node_modules/` created. No errors.

- [ ] **Step 12: Verify TypeScript compiles for the client**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add client/
git commit -m "feat: add client package scaffold (React + Vite + Tailwind)"
```

---

## Task 4: Database module

**Files:**
- Create: `server/src/db.ts`
- Create: `server/src/__tests__/db.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/__tests__/db.test.ts
import { createDb, getDb, closeDb } from '../db'

afterEach(() => {
  closeDb()
})

test('createDb returns a Database instance with WAL mode', () => {
  const db = createDb(':memory:')
  const row = db.pragma('journal_mode', { simple: true })
  expect(row).toBe('wal')
})

test('getDb throws before initDb is called', () => {
  expect(() => getDb()).toThrow('Database not initialized')
})

test('initDb sets the singleton; getDb returns the same instance', () => {
  const db = createDb(':memory:')
  const same = getDb()
  expect(same).toBe(db)
})

test('closeDb resets the singleton so getDb throws again', () => {
  createDb(':memory:')
  closeDb()
  expect(() => getDb()).toThrow('Database not initialized')
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd server && npm test -- --testPathPattern=db
```

Expected: 4 failures — `Cannot find module '../db'`

- [ ] **Step 3: Write `server/src/db.ts`**

```typescript
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

let instance: Database.Database | null = null

export function createDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'data', 'finance.db')
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  }
  instance = new Database(resolvedPath)
  instance.pragma('journal_mode = WAL')
  return instance
}

export function getDb(): Database.Database {
  if (!instance) throw new Error('Database not initialized. Call createDb() first.')
  return instance
}

export function closeDb(): void {
  if (instance) {
    instance.close()
    instance = null
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd server && npm test -- --testPathPattern=db
```

Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 5: Verify TypeScript compiles (server only)**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/db.ts server/src/__tests__/db.test.ts
git commit -m "feat(server): add SQLite database module with WAL mode"
```

---

## Task 5: Database schema

**Files:**
- Create: `server/src/schema.ts`
- Create: `server/src/__tests__/schema.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/__tests__/schema.test.ts
import { createDb, getDb, closeDb } from '../db'
import { createTables } from '../schema'

beforeEach(() => {
  createDb(':memory:')
  createTables(getDb())
})

afterEach(() => {
  closeDb()
})

test('createTables creates plaid_items table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plaid_items'").get()
  expect(row).toBeDefined()
})

test('createTables creates accounts table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get()
  expect(row).toBeDefined()
})

test('createTables creates transactions table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'").get()
  expect(row).toBeDefined()
})

test('createTables creates scheduled_transactions table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_transactions'").get()
  expect(row).toBeDefined()
})

test('createTables creates categories table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'").get()
  expect(row).toBeDefined()
})

test('createTables creates transaction_splits table', () => {
  const db = getDb()
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transaction_splits'").get()
  expect(row).toBeDefined()
})

test('transactions table has is_removed column', () => {
  const db = getDb()
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>
  expect(cols.map(c => c.name)).toContain('is_removed')
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd server && npm test -- --testPathPattern=schema
```

Expected: 7 failures — `Cannot find module '../schema'`

- [ ] **Step 3: Write `server/src/schema.ts`** — `createTables` only for now

```typescript
import type Database from 'better-sqlite3'

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plaid_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      institution_name TEXT    NOT NULL,
      plaid_item_id    TEXT    NOT NULL UNIQUE,
      access_token     TEXT    NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'active',
      cursor           TEXT,
      last_synced_at   DATETIME
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      plaid_item_id     INTEGER REFERENCES plaid_items(id),
      plaid_account_id  TEXT    UNIQUE,
      name              TEXT    NOT NULL,
      type              TEXT    NOT NULL,
      subtype           TEXT,
      mask              TEXT,
      is_manual         INTEGER NOT NULL DEFAULT 0,
      starting_balance  REAL    NOT NULL DEFAULT 0,
      current_balance   REAL    NOT NULL DEFAULT 0,
      is_active         INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id            INTEGER NOT NULL REFERENCES accounts(id),
      plaid_transaction_id  TEXT    UNIQUE,
      date                  TEXT    NOT NULL,
      payee                 TEXT    NOT NULL,
      amount                REAL    NOT NULL,
      is_cleared            INTEGER NOT NULL DEFAULT 0,
      is_manual             INTEGER NOT NULL DEFAULT 0,
      is_removed            INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS scheduled_transactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      INTEGER NOT NULL REFERENCES accounts(id),
      payee           TEXT    NOT NULL,
      amount          REAL    NOT NULL,
      frequency       TEXT    NOT NULL,
      frequency_day1  INTEGER,
      frequency_day2  INTEGER,
      next_due_date   TEXT    NOT NULL,
      end_date        TEXT,
      is_active       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      parent_id  INTEGER REFERENCES categories(id),
      is_system  INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transaction_splits (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      category_id    INTEGER NOT NULL REFERENCES categories(id),
      amount         REAL    NOT NULL
    );
  `)
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd server && npm test -- --testPathPattern=schema
```

Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 5: Wire `createTables` into `server/src/index.ts` startup block**

Replace the `require.main === module` block:

```typescript
if (require.main === module) {
  const { createDb } = require('./db') as typeof import('./db')
  const { createTables } = require('./schema') as typeof import('./schema')
  const db = createDb()
  createTables(db)
  const PORT = process.env.PORT ?? 3001
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}
```

Actually, use standard imports at the top of `index.ts` instead. Replace the whole file:

```typescript
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { router } from './routes'
import { createDb } from './db'
import { createTables } from './schema'

const app = express()

app.use(cors())
app.use(express.json())

app.get('/manifest.json', (_req, res) => {
  res.json({
    name: process.env.VITE_APP_NAME ?? 'Finance',
    short_name: process.env.VITE_APP_NAME ?? 'Finance',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#6366f1',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  })
})

app.use('/api', router)

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

if (require.main === module) {
  const db = createDb()
  createTables(db)
  const PORT = process.env.PORT ?? 3001
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}

export { app }
```

- [ ] **Step 6: Verify TypeScript still compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/schema.ts server/src/__tests__/schema.test.ts server/src/index.ts
git commit -m "feat(server): add database schema (6 tables)"
```

---

## Task 6: Category seed

**Files:**
- Modify: `server/src/schema.ts`
- Modify: `server/src/__tests__/schema.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add failing tests** (append to `schema.test.ts`)

```typescript
import { createTables, seedCategories } from '../schema'

// (beforeEach and afterEach already defined above — they apply to these tests too)

test('seedCategories inserts 7 parent categories', () => {
  const db = getDb()
  seedCategories(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM categories WHERE parent_id IS NULL AND is_system = 0').get() as { n: number }).n
  expect(count).toBe(7)
})

test('seedCategories inserts 14 child categories', () => {
  const db = getDb()
  seedCategories(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM categories WHERE parent_id IS NOT NULL').get() as { n: number }).n
  expect(count).toBe(14)
})

test('seedCategories inserts 1 system category (Uncategorized)', () => {
  const db = getDb()
  seedCategories(db)
  const row = db.prepare("SELECT * FROM categories WHERE is_system = 1").get() as { name: string } | undefined
  expect(row?.name).toBe('Uncategorized')
})

test('seedCategories is idempotent — running twice does not double-insert', () => {
  const db = getDb()
  seedCategories(db)
  seedCategories(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM categories').get() as { n: number }).n
  expect(count).toBe(22) // 7 parents + 14 children + 1 system
})

test('Food · Groceries child is linked to Food parent', () => {
  const db = getDb()
  seedCategories(db)
  const parent = db.prepare("SELECT id FROM categories WHERE name = 'Food'").get() as { id: number }
  const child = db.prepare("SELECT parent_id FROM categories WHERE name = 'Groceries'").get() as { parent_id: number }
  expect(child.parent_id).toBe(parent.id)
})
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
cd server && npm test -- --testPathPattern=schema
```

Expected: 5 new failures — `seedCategories is not a function`

- [ ] **Step 3: Add `seedCategories` to `server/src/schema.ts`**

Append after `createTables`:

```typescript
export function seedCategories(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) as n FROM categories').get() as { n: number }).n
  if (count > 0) return

  const insertParent = db.prepare(
    'INSERT INTO categories (name, parent_id, is_system, is_active, sort_order) VALUES (?, NULL, 0, 1, ?)'
  )
  const insertChild = db.prepare(
    'INSERT INTO categories (name, parent_id, is_system, is_active, sort_order) VALUES (?, ?, 0, 1, ?)'
  )
  const insertSystem = db.prepare(
    'INSERT INTO categories (name, parent_id, is_system, is_active, sort_order) VALUES (?, NULL, 1, 1, 999)'
  )

  const seed = db.transaction(() => {
    const parents: Record<string, number> = {}
    const parentNames = ['Food', 'Transport', 'Home', 'Health', 'Personal', 'Entertainment', 'Income']
    parentNames.forEach((name, i) => {
      const result = insertParent.run(name, i)
      parents[name] = result.lastInsertRowid as number
    })

    const children: Array<[string, string, number]> = [
      ['Groceries',     'Food',          0],
      ['Dining Out',    'Food',          1],
      ['Gas',           'Transport',     0],
      ['Parking',       'Transport',     1],
      ['Utilities',     'Home',          0],
      ['Household',     'Home',          1],
      ['Healthcare',    'Health',        0],
      ['Pharmacy',      'Health',        1],
      ['Clothing',      'Personal',      0],
      ['Personal Care', 'Personal',      1],
      ['Subscriptions', 'Entertainment', 0],
      ['Travel',        'Entertainment', 1],
      ['Payroll',       'Income',        0],
      ['Other Income',  'Income',        1],
    ]

    children.forEach(([name, parentName, order]) => {
      insertChild.run(name, parents[parentName], order)
    })

    insertSystem.run('Uncategorized')
  })

  seed()
}
```

- [ ] **Step 4: Run all schema tests — verify they pass**

```bash
cd server && npm test -- --testPathPattern=schema
```

Expected: `Tests: 12 passed, 12 total`

- [ ] **Step 5: Wire `seedCategories` into `server/src/index.ts` startup block**

Update the `require.main === module` block in `index.ts`:

```typescript
if (require.main === module) {
  const db = createDb()
  createTables(db)
  seedCategories(db)
  const PORT = process.env.PORT ?? 3001
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}
```

Also add `seedCategories` to the import at the top of `index.ts`:

```typescript
import { createTables, seedCategories } from './schema'
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/schema.ts server/src/__tests__/schema.test.ts server/src/index.ts
git commit -m "feat(server): seed categories on startup (7 parents, 14 children, Uncategorized)"
```

---

## Task 7: Test data seed

**Files:**
- Modify: `server/src/schema.ts`
- Modify: `server/src/__tests__/schema.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add failing tests** (append to `schema.test.ts`)

```typescript
import { createTables, seedCategories, seedTestData } from '../schema'

test('seedTestData inserts 1 plaid_item', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM plaid_items').get() as { n: number }).n
  expect(count).toBe(1)
})

test('seedTestData inserts 2 accounts', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM accounts').get() as { n: number }).n
  expect(count).toBe(2)
})

test('seedTestData inserts 10 transactions all on the checking account', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM transactions').get() as { n: number }).n
  expect(count).toBe(10)
})

test('seedTestData inserts 2 scheduled transactions', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM scheduled_transactions').get() as { n: number }).n
  expect(count).toBe(2)
})

test('seedTestData is idempotent', () => {
  const db = getDb()
  seedCategories(db)
  seedTestData(db)
  seedTestData(db)
  const count = (db.prepare('SELECT COUNT(*) as n FROM accounts').get() as { n: number }).n
  expect(count).toBe(2)
})
```

- [ ] **Step 2: Run tests — verify new tests fail**

```bash
cd server && npm test -- --testPathPattern=schema
```

Expected: 5 new failures — `seedTestData is not a function`

- [ ] **Step 3: Add `seedTestData` to `server/src/schema.ts`**

Append after `seedCategories`:

```typescript
export function seedTestData(db: Database.Database): void {
  const existingAccounts = (db.prepare('SELECT COUNT(*) as n FROM accounts').get() as { n: number }).n
  if (existingAccounts > 0) return

  const now = new Date().toISOString()

  const item = db.prepare(
    `INSERT INTO plaid_items (institution_name, plaid_item_id, access_token, status, last_synced_at)
     VALUES (?, ?, ?, 'active', ?)`
  ).run('Truist', 'item-test-001', 'access-sandbox-test', now)

  const itemId = item.lastInsertRowid

  const checking = db.prepare(
    `INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, subtype, mask, is_manual, starting_balance, current_balance, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 1)`
  ).run(itemId, 'acc-checking-001', 'Truist Checking', 'depository', 'checking', '4823', 4250.00)

  db.prepare(
    `INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, subtype, mask, is_manual, starting_balance, current_balance, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 1)`
  ).run(itemId, 'acc-savings-001', 'Truist Savings', 'depository', 'savings', '7291', 8500.00)

  const checkingId = checking.lastInsertRowid
  const today = new Date()

  const dateStr = (daysAgo: number): string => {
    const d = new Date(today)
    d.setDate(d.getDate() - daysAgo)
    return d.toISOString().slice(0, 10)
  }

  const insertTx = db.prepare(
    `INSERT INTO transactions (account_id, plaid_transaction_id, date, payee, amount, is_cleared, is_manual)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  )

  const txData: Array<[string, string, number, number]> = [
    [dateStr(0),  'Publix',       -84.32,   0],
    [dateStr(1),  'Shell',        -52.40,   1],
    [dateStr(2),  'Netflix',      -22.99,   1],
    [dateStr(3),  'Chick-fil-A',  -18.45,   1],
    [dateStr(5),  'Amazon',       -64.99,   1],
    [dateStr(7),  'Payroll',     3200.00,   1],
    [dateStr(8),  'Duke Energy',  -145.00,  1],
    [dateStr(10), 'Walgreens',    -28.50,   1],
    [dateStr(12), 'Target',       -103.22,  1],
    [dateStr(14), 'Payroll',     3200.00,   1],
  ]

  txData.forEach(([date, payee, amount, cleared], i) => {
    insertTx.run(checkingId, `plaid-tx-test-${String(i + 1).padStart(3, '0')}`, date, payee, amount, cleared)
  })

  const firstOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().slice(0, 10)
  const twoWeeksOut = new Date(today)
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14)
  const twoWeeksOutStr = twoWeeksOut.toISOString().slice(0, 10)

  db.prepare(
    `INSERT INTO scheduled_transactions (account_id, payee, amount, frequency, frequency_day1, next_due_date, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run(checkingId, 'Rent', -1800.00, 'monthly', 1, firstOfNextMonth)

  db.prepare(
    `INSERT INTO scheduled_transactions (account_id, payee, amount, frequency, next_due_date, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).run(checkingId, 'Payroll', 3200.00, 'every two weeks', twoWeeksOutStr)
}
```

- [ ] **Step 4: Run all schema tests — verify they pass**

```bash
cd server && npm test -- --testPathPattern=schema
```

Expected: `Tests: 17 passed, 17 total`

- [ ] **Step 5: Wire `seedTestData` into `server/src/index.ts` startup block**

```typescript
import { createTables, seedCategories, seedTestData } from './schema'

// ...

if (require.main === module) {
  const db = createDb()
  createTables(db)
  seedCategories(db)
  seedTestData(db)
  const PORT = process.env.PORT ?? 3001
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}
```

- [ ] **Step 6: Run all server tests**

```bash
cd server && npm test
```

Expected: `Test Suites: 2 passed, 2 total` / `Tests: 21 passed, 21 total` (4 db + 17 schema)

- [ ] **Step 7: Commit**

```bash
git add server/src/schema.ts server/src/__tests__/schema.test.ts server/src/index.ts
git commit -m "feat(server): seed test data on startup (accounts, transactions, scheduled)"
```

---

## Task 8: Full-stack integration verify

**Files:**
- No new files — verifying the complete system works end to end

- [ ] **Step 1: Start the server**

In a terminal:
```bash
npm run dev -w server
```

Expected output:
```
Server running on http://localhost:3001
```

No errors. The first startup creates `data/finance.db`.

- [ ] **Step 2: Verify the health endpoint returns a DB response**

In a second terminal:
```bash
curl http://localhost:3001/api/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: Verify the manifest endpoint**

```bash
curl http://localhost:3001/manifest.json
```

Expected: JSON with `name` matching `VITE_APP_NAME` from your `.env`.

- [ ] **Step 4: Start the client**

In a third terminal:
```bash
npm run dev -w client
```

Expected: Vite running on http://localhost:5173

- [ ] **Step 5: Open http://localhost:5173 and verify**

- Page loads with the app name in the nav bar
- All 5 nav links are clickable (Dashboard, Register, Calendar, Scheduled, Accounts)
- Each view shows its heading and "Coming soon."
- Browser dev tools Network tab shows `/manifest.json` returning the correct JSON
- No console errors

- [ ] **Step 6: Alternatively, start both at once**

Stop both servers. From the project root:
```bash
npm run dev
```

Expected: `concurrently` starts both server and client together with color-coded output.

- [ ] **Step 7: Verify `data/finance.db` is gitignored**

```bash
git status
```

Expected: `data/finance.db` does NOT appear. The `*.db` rule in `.gitignore` covers it.

- [ ] **Step 8: Final commit (only if any cleanup was needed)**

If you made any fixes during verification:
```bash
git add -p  # stage only the relevant changes
git commit -m "fix: [description of what was fixed]"
```

If everything worked as-is, no commit needed.

---

## Phase 1a Complete

**What was built:**
- npm workspace monorepo with `server/` and `client/` packages
- Express server with TypeScript, cors, JSON middleware, `/manifest.json` route, `/api/health` endpoint
- React 18 + Vite + TypeScript + Tailwind CSS client with React Router navigation shell
- SQLite database with WAL mode, all 6 tables, categories seed (7 parents + 14 children + Uncategorized), test data (2 accounts, 10 transactions, 2 scheduled transactions)
- PWA meta tags in `index.html`; `VITE_APP_NAME` flows to browser title, nav bar, manifest
- 21 passing server tests

**What was intentionally skipped:** Plaid integration, Accounts view, Register view, responsive mobile layout — all deferred to subsequent plans.

**Next step:** Phase 1b — Plaid integration (`docs/plans/phase-01b-plaid.md`)
