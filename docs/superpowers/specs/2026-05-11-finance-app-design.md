# Finance App — Design Spec

**Date:** 2026-05-11  
**Status:** Approved  
**Repo:** https://github.com/markwmccall/finance-app

---

## Overview

A local personal finance app replacing Quicken Classic for Windows for household use. Primary user is Laurie (non-technical). Mark maintains the app. The app runs as a web server on a Raspberry Pi Zero 2 W on the home network; any browser in the house (Mac, Windows PC, phone) can access it.

No cloud deployment. No authentication. No mobile app. Read-only bank sync — no payment initiation.

---

## Architecture

```
Home Network
├── Clients (any browser) ──────────────── http://raspberrypi.local:3000
│
└── Raspberry Pi Zero 2 W (always on)
    ├── Node.js 20 LTS + Express  (API server, TypeScript)
    ├── React + Vite               (frontend, served as static files, TypeScript)
    ├── SQLite via better-sqlite3  (database, on SD card)
    └── plaid-node SDK             (outbound to Plaid API)
         ├── Truist (checking + savings)
         ├── American Express (3 cards, 1 login)
         └── Ally (savings)
```

**TypeScript throughout** — shared types between API and frontend.  
**Plaid products:** Transactions, Auth, Balance.  
**Plaid plan:** Free Trial (personal use, up to 10 Items).

---

## Screens

Five views, navigated via a top nav bar.

### 1. Dashboard (default landing page)

Four thumbnail widgets arranged in a 2×2 grid. Each widget shows live data and is clickable to open the full view.

| Widget | Contents |
|---|---|
| Register | Current checking balance + last 3 transactions |
| Calendar | Mini month grid, color-coded by balance health, warning if any day goes negative |
| Upcoming | Next 14 days of scheduled transactions (bills in red, income in green) |
| Accounts | All account balances, net worth total, last synced timestamp |

**Sync Now** button on the dashboard header — the only way to trigger a Plaid sync. No automatic background sync.

### 2. Register

Transaction list, newest first, with running balance.

- Columns: Date, Payee, Amount, Balance
- Account filter dropdown (All Accounts or a specific account)
- Cleared/uncleared indicator per transaction
- Manual transaction entry (for cash, checks, or corrections)
- Transactions from all connected accounts; filter to one account as needed

### 3. Calendar

Month grid. Each day is a sizeable box. Navigation arrows for prev/next month.

**Day box contents:**
- Day number
- Transactions listed (payee + amount, truncated if needed)
  - Past days: real synced transactions (solid styling)
  - Future days: scheduled transactions (dashed/lighter styling)
- End-of-day projected balance pinned to bottom of each box
  - Green: healthy
  - Yellow: getting low (threshold TBD during implementation)
  - Red: projected overdraft

**Today:** highlighted with a distinct border.

**Below the calendar — per-account bar charts:**

One bar chart strip per connected account, stacked vertically, bars aligned to the same day columns as the calendar above.

- Each chart has its own independent y-axis scale (prevents large-balance accounts from dwarfing small-balance ones)
- Past bars: solid, actual balance
- Future bars: lighter fill with dashed top, projected balance
- Today: highlighted bar with purple outline
- Hover any bar: tooltip shows exact balance
- Account type determines display semantics (from Plaid `type` field):
  - `depository` / `investment`: taller bar = more money (asset)
  - `credit` / `loan`: taller bar = more debt (liability), labeled clearly

**Account type is always derived from the Plaid `type` field — never hardcoded per institution.**

### 4. Scheduled Transactions

CRUD list of recurring bills and income. Laurie actively maintains this — it is the engine that feeds the calendar forecast.

Fields per entry:
- Payee name
- Amount (positive = income, negative = bill)
- Account
- Frequency (see below)
- Next due date
- End date (optional)

**Supported frequencies** (matching Quicken Classic for Windows):

| Frequency | Description |
|---|---|
| Only once | Single future transaction |
| Weekly | Every 7 days |
| Every two weeks | Every 14 days (bi-weekly) |
| Every four weeks | Every 28 days (distinct from bi-weekly) |
| Twice a month | Two fixed days per month (e.g. 1st and 15th) |
| Monthly | Specific day of month |
| Quarterly | Every 3 months |
| Twice a year | Every 6 months |
| Yearly | Once per year |

### 5. Accounts

Plaid connection management. Set-and-forget after initial setup.

- List of connected accounts with institution name, account name, type, and current balance
- Connection status (connected / needs re-auth)
- **Re-auth flow:** when a Plaid token goes stale, a warning banner appears on the Dashboard and Accounts screen with a "Reconnect" button. Clicking opens Plaid Link in update mode. No silent failures.
- Add new institution via Plaid Link
- Set starting balance manually (used as the forecast anchor before the first sync)

---

## Data Model

Four tables. SQLite via `better-sqlite3`.

### `plaid_items`
One row per bank login (Item in Plaid terminology).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| institution_name | TEXT | e.g. "Truist", "American Express" |
| plaid_item_id | TEXT | From Plaid |
| access_token | TEXT | Stored locally, never logged |
| status | TEXT | `active` or `needs_reauth` |
| cursor | TEXT | Plaid `/transactions/sync` pagination cursor; NULL before first sync |
| last_synced_at | DATETIME | |

### `accounts`
One row per bank account.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| plaid_item_id | INTEGER FK | → plaid_items |
| plaid_account_id | TEXT | From Plaid |
| name | TEXT | e.g. "Truist Checking" |
| type | TEXT | From Plaid: `depository`, `credit`, `loan`, `investment` |
| subtype | TEXT | From Plaid: `checking`, `savings`, `credit card`, etc. |
| current_balance | REAL | Refreshed on each sync; used as forecast anchor |
| is_active | INTEGER | 1 = shown, 0 = hidden |

### `transactions`
One row per transaction.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| account_id | INTEGER FK | → accounts |
| plaid_transaction_id | TEXT | NULL for manual entries |
| date | TEXT | ISO 8601 (YYYY-MM-DD) |
| payee | TEXT | |
| amount | REAL | Negative = money out, positive = money in |
| is_cleared | INTEGER | 0 or 1 |
| is_manual | INTEGER | 0 or 1 |

Deduplication: `plaid_transaction_id` is unique — re-syncing never creates duplicates.

### `scheduled_transactions`
One row per recurring bill or income entry.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| account_id | INTEGER FK | → accounts |
| payee | TEXT | |
| amount | REAL | Negative = bill, positive = income |
| frequency | TEXT | See frequency table above |
| frequency_day1 | INTEGER | Day of month for `monthly`; first day for `twice a month`; NULL for all interval-based frequencies |
| frequency_day2 | INTEGER | Second day for `twice a month` only; NULL otherwise |
| next_due_date | TEXT | ISO 8601; updated after each occurrence |
| end_date | TEXT | ISO 8601; NULL = indefinite |
| is_active | INTEGER | 1 = active, 0 = paused |

---

## Balance Forecasting Engine

Pure calculation — no extra database table.

**Algorithm:**
1. For each account, start from `accounts.current_balance` as of today
2. Walk forward day by day for 90 days
3. For each day, apply any `scheduled_transactions` due on that date
4. Return projected end-of-day balance per account per day

**Output** is consumed by:
- Calendar day boxes (end-of-day balance label + color)
- Bar chart strips (bar height)
- Dashboard calendar widget (color-coded mini grid + warning banner)
- Upcoming widget (next 14 days of scheduled transactions)

Forecast recalculates on every page load — no caching needed at this scale.

---

## Plaid Integration

- **Plaid Link** (drop-in widget): used for initial connection and re-auth (update mode)
- **`/transactions/sync`**: incremental transaction sync, handles deduplication via cursor
- **`/accounts/get`**: fetches current balances on sync
- **Access tokens** stored in `plaid_items.access_token` — never logged, never committed to git, database file is gitignored

**Sync flow (triggered manually via "Sync Now"):**
1. For each active `plaid_item`, call `/accounts/get` → update `accounts.current_balance`
2. Call `/transactions/sync` with stored cursor → upsert new/modified transactions, delete removed
3. Store updated cursor on `plaid_item`
4. If Plaid returns `ITEM_LOGIN_REQUIRED` error → set `plaid_items.status = 'needs_reauth'`, show warning banner

**Ally savings buckets:** not exposed by Plaid. Total account balance only. Laurie has an existing workaround (same limitation as Quicken).

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Plaid token expired | Set status to `needs_reauth`, show warning banner on Dashboard + Accounts |
| Plaid API timeout | Show sync error toast, leave existing data intact |
| Sync partial failure (one item fails) | Continue syncing other items, report which institution failed |
| Database write failure | Surface error in UI, do not silently discard data |

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript (frontend + backend) |
| Frontend framework | React 18 |
| Frontend build | Vite |
| Styling | Tailwind CSS |
| Backend framework | Express |
| Database | SQLite via better-sqlite3 |
| Plaid SDK | plaid-node |
| Package manager | npm |
| Repo | GitHub (private), branch → PR → merge workflow |

---

## Out of Scope

- Automatic background sync (manual only)
- Historical data import from Quicken
- Ally savings bucket tracking
- Mobile app
- Cloud deployment or remote access outside home network
- Multi-user support or authentication
- Budgeting, spending categories, or reports
- Investment account tracking
- Bill payment or any write operations to bank accounts
- Loan tracking

---

## Build Order

1. Project scaffold — monorepo structure, Express + React + Vite + TypeScript + SQLite wired up, running locally
2. Plaid integration — Link widget, connect an account, store token, fetch transactions and balances
3. Database schema — create all four tables, seed with test data
4. Register view — display synced transactions with running balance, account filter
5. Scheduled transactions CRUD — add/edit/delete recurring entries with all frequency types
6. Balance forecasting engine — 90-day projection from current balance + scheduled transactions
7. Calendar view — month grid with transactions, projected balances, color coding
8. Bar charts — per-account strips below calendar, independent scale, hover tooltips
9. Dashboard — four thumbnail widgets wired to live data
10. Accounts view — Plaid connection list, re-auth flow, starting balance editor
11. Pi Zero 2 W deployment — production setup, serve static files from Express
