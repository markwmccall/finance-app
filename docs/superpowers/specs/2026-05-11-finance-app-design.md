# Finance App — Design Spec

**Date:** 2026-05-12 (updated from 2026-05-11)
**Status:** Approved
**Repo:** https://github.com/markwmccall/finance-app

---

## Overview

A local personal finance app replacing Quicken Classic for Windows for household use. Primary user is Laurie (non-technical). Mark maintains the app. The app runs as a web server on a Raspberry Pi Zero 2 W on the home network; any browser in the house (Mac, Windows PC, phone) can access it at `http://raspberrypi.local:3000`.

Remote access from outside the home network is supported via Tailscale — a private encrypted mesh VPN. No public IP address is required. Phones can access the full app from anywhere using the same stable Tailscale IP.

No cloud deployment. No authentication beyond Tailscale. No mobile app. Read-only bank sync — no payment initiation.

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

Remote Access (via Tailscale)
├── Phone (Mark)  ──┐
└── Phone (Laurie) ─┴──► Tailscale encrypted tunnel ──► Pi (100.x.x.x:3000)
                         (split tunnel — normal internet traffic unaffected)
```

**TypeScript throughout** — shared types between API and frontend.
**Plaid products:** Transactions, Balance. (Auth is explicitly excluded — full account and routing numbers are never fetched or stored.)
**Plaid plan:** Free Trial (personal use, up to 10 Items).

---

## Remote Access

**Mechanism:** Tailscale (free personal tier — up to 3 users, 100 devices).

**Setup (one-time):**
- Mark installs Tailscale on both phones and authenticates to the same account
- Mark runs the Tailscale installer on the Pi (`curl -fsSL https://tailscale.com/install.sh | sh`) and authenticates
- The Pi receives a stable Tailscale IP in the `100.x.x.x` range — this never changes

**Access URL:** `http://100.x.x.x:3000` — bookmark it once, works whether home or away. When home, traffic goes phone → home router → Pi (Tailscale idle). When away, traffic goes phone → encrypted Tailscale tunnel → Pi. Normal internet traffic (apps, browsing, streaming) is unaffected in both cases — Tailscale is a split tunnel.

**Security model:** The Pi has no public IP and no open ports on the internet. Only devices on the Tailscale network can reach it. Tailscale IS the access control layer — no login screen is needed.

**Free tier covers this household:** 2 users (Mark + Laurie) + 1 device (Pi) = 3 total. Within the free plan limits.

---

## Mobile & PWA

The app is designed responsive-first. All five views work on phones. Tailwind CSS breakpoints (`sm: 640px`) divide phone from desktop layouts.

**PWA configuration (added in Step 1 — scaffold):**
- `manifest.json` served dynamically by Express (reads `VITE_APP_NAME` env var)
  - `display: standalone` — full-screen, no browser chrome
  - `start_url: /` — opens to Dashboard
  - Icons at 192×192 and 512×512
- `index.html` meta tags: `viewport`, `theme-color`, `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`
- No service worker — offline support is not useful when the app requires live data from the Pi

**App name:** Configured via `VITE_APP_NAME` in `.env`. Flows to: browser `<title>`, nav bar, PWA manifest, iOS home screen label. Change one line to rename the app everywhere.

**Install:** iOS — Share → Add to Home Screen. Android — browser menu or automatic install banner. One-time setup per phone.

---

## Navigation

**Desktop:** Horizontal top nav bar with app name/logo on the left and five view links: Dashboard · Register · Calendar · Scheduled · Accounts.

**Mobile:** Bottom tab bar with icons and short labels (thumb-accessible). Five tabs: Home · Register · Calendar · Scheduled · Accounts.

---

## Screens

Five views, navigated via the nav bar.

### 1. Dashboard (default landing page)

Four thumbnail widgets in a 2×2 grid. Each widget shows live data and is clickable to open the full view. Grid stays 2×2 on mobile — widgets are compact enough to fit.

| Widget | Contents |
|---|---|
| Register | Balance + last 3 transactions for a user-configured account; gear icon on the widget selects which account to display; defaults to the first active account |
| Calendar | Mini month grid, color-coded by balance health, warning if any day goes negative |
| Upcoming | Next 14 days of scheduled transactions (bills in red, income in green) |
| Accounts | All account balances, net worth total, last synced timestamp |

**Sync Now** button on the dashboard header — the only way to trigger a Plaid sync.

### 2. Register

Transaction list, newest first, with running balance.

**Desktop columns:** Date · Payee · Category · Amount · Balance · Cleared
**Mobile layout:** One card per transaction. Each card shows payee (bold), date + balance (secondary), amount (right-aligned, colored), and a tap target to toggle cleared status. Tap the card body to expand and edit splits.

- Account filter dropdown (All Accounts or a specific account)
- Category filter dropdown (All Categories, a specific category, or a parent category — shows all children)
- Cleared/uncleared indicator per transaction — tappable
- Manual transaction entry (for cash, checks, or corrections)
- Category column shows category name for single-category transactions, "Split →" for multi-category
- Gear icon near the category filter opens category management (see Categories section)

### 3. Calendar

Month grid. Each day is a sizeable box. Navigation arrows for prev/next month.

**Desktop — day box contents:**
- Day number
- Transactions listed (payee + amount, truncated if needed)
  - Past days: real synced transactions (solid styling)
  - Future days: scheduled transactions (dashed/lighter styling)
- End-of-day projected balance pinned to bottom of each box
  - Green: healthy; Yellow: getting low (threshold TBD during implementation); Red: projected overdraft

**Mobile — compact grid:**
- Day cells are color-coded only (green / yellow / red — same thresholds as desktop) with a dot indicator if transactions exist
- Tapping a day opens a detail panel below the grid showing that day's transactions and projected balance
- Same color semantics as desktop

**Today:** highlighted with a distinct border on both layouts.

**Below the calendar — per-account bar charts:**

One bar chart strip per connected account, stacked vertically, bars aligned to day columns.

- Each chart has its own independent y-axis scale
- Past bars: solid, actual balance; future bars: lighter fill with dashed top, projected
- Today: highlighted bar with purple outline; hover tooltip shows exact balance
- Mobile: bar chart strips scroll horizontally
- Account type from Plaid `type` field determines display semantics — never hardcoded per institution

### 4. Scheduled Transactions

CRUD list of recurring bills and income.

**Desktop:** Table layout. **Mobile:** Card per entry.

Fields per entry: Payee · Amount · Account · Frequency · Next due date · End date (optional)

**Supported frequencies:**

| Frequency | Description |
|---|---|
| Only once | Single future transaction |
| Weekly | Every 7 days |
| Every two weeks | Every 14 days |
| Every four weeks | Every 28 days |
| Twice a month | Two fixed days per month (e.g. 1st and 15th) |
| Monthly | Specific day of month |
| Quarterly | Every 3 months |
| Twice a year | Every 6 months |
| Yearly | Once per year |

### 5. Accounts

Plaid connection management.

**Plaid-connected accounts:**
- List of connected accounts with institution name, account name, type, current balance, and masked number
- Connection status (connected / needs re-auth)
- **Re-auth flow:** warning banner on Dashboard and Accounts when a token goes stale; "Reconnect" button opens Plaid Link in update mode
- Add new institution via Plaid Link
- Set starting balance (forecast anchor before first sync)

**Manual accounts:**
- Add a manual account: name, type, subtype, starting balance, optional last-4 identifier
- Edit name, type, subtype, starting balance at any time
- Delete a manual account (and optionally its transactions)
- Manual accounts display alongside Plaid accounts with a "Manual" badge
- No sync indicator — balance stays current automatically as transactions are added/edited/deleted
- All transactions on manual accounts are entered via the existing manual transaction entry UI in the Register

---

## Data Model

Six tables. SQLite via `better-sqlite3`.

### `plaid_items`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| institution_name | TEXT | e.g. "Truist" |
| plaid_item_id | TEXT | From Plaid |
| access_token | TEXT | Never logged |
| status | TEXT | `active` or `needs_reauth` |
| cursor | TEXT | `/transactions/sync` cursor; NULL before first sync |
| last_synced_at | DATETIME | |

### `accounts`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| plaid_item_id | INTEGER FK | → plaid_items; NULL for manual accounts |
| plaid_account_id | TEXT | From Plaid; NULL for manual accounts |
| name | TEXT | e.g. "Truist Checking", "Cash Wallet" |
| type | TEXT | `depository`, `credit`, `loan`, `investment`, `manual` |
| subtype | TEXT | `checking`, `savings`, `credit card`, `cash`, `other`, etc. |
| mask | TEXT | Last 4 digits (Plaid-sourced or manually entered); NULL if not applicable |
| is_manual | INTEGER | 1 = manually managed, 0 = Plaid-connected |
| starting_balance | REAL | Opening balance for manual accounts; forecast anchor for Plaid accounts before first sync |
| current_balance | REAL | For Plaid accounts: refreshed on each sync. For manual accounts: maintained by the app whenever transactions are added, edited, or deleted (starting_balance + sum of all transactions) |
| is_active | INTEGER | 1 = shown, 0 = hidden |

### `transactions`

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

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| account_id | INTEGER FK | → accounts |
| payee | TEXT | |
| amount | REAL | Negative = bill, positive = income |
| frequency | TEXT | See frequency table |
| frequency_day1 | INTEGER | Day of month for `monthly`; first day for `twice a month`; NULL otherwise |
| frequency_day2 | INTEGER | Second day for `twice a month` only; NULL otherwise |
| next_due_date | TEXT | ISO 8601 |
| end_date | TEXT | ISO 8601; NULL = indefinite |
| is_active | INTEGER | 1 = active, 0 = paused |

### `categories`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | e.g. "Groceries", "Food" |
| parent_id | INTEGER FK | → categories; NULL for top-level |
| is_system | INTEGER | 1 for "Uncategorized" — cannot be deleted or renamed |
| is_active | INTEGER | 0 = hidden from pickers, preserved on existing splits |
| sort_order | INTEGER | User-defined display order |

Maximum one level of hierarchy (parent → child). Only leaf categories (no children) are assignable to transactions. Hierarchy exists for future reporting rollups.

**Preset categories (seeded on first run):**

Parents: Food, Transport, Home, Health, Personal, Entertainment, Income
Children: Food → Groceries, Food → Dining Out; Transport → Gas, Transport → Parking; Home → Utilities, Home → Household; Health → Healthcare, Health → Pharmacy; Personal → Clothing, Personal → Personal Care; Entertainment → Subscriptions, Entertainment → Travel; Income → Payroll, Income → Other Income

System (non-editable): Uncategorized

### `transaction_splits`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| transaction_id | INTEGER FK | → transactions |
| category_id | INTEGER FK | → categories |
| amount | REAL | Negative = expense, positive = income |

Every transaction has at least one split row. Split amounts for a transaction must sum exactly to `transactions.amount`. "Uncategorized" is used to account for any unassigned remainder.

---

## Categories

**Management:** Gear icon near the category filter in the Register view. Opens a panel with add, rename, reorder, and deactivate controls. "Uncategorized" appears at the bottom, grayed, not editable. If a Settings tab is added in the future, category management is also accessible there.

**Category picker (used in transaction split entry):**
- Searchable typeahead combobox
- Typing any substring matches against the full display path: "Food · Groceries"
- Typing "food" shows all children of Food; typing "groc" shows "Food · Groceries" directly
- Mobile: opens as a bottom sheet with search input at top

**Split entry UI:**
- Per-transaction: expandable section showing category line items (category picker + amount field per row)
- Running "remaining" counter starts at transaction total, decrements as splits are assigned
- "Auto-fill remainder to Uncategorized" button for convenience
- Cannot save until remaining = $0.00
- Single-category transactions: one split row at the full amount (no UI expansion needed unless editing)

---

## Balance Forecasting Engine

Pure calculation — no extra database table.

**Algorithm:**
1. For each account, start from `accounts.current_balance` as of today
2. Walk forward day by day for 90 days
3. For each day, apply any `scheduled_transactions` due on that date
4. Return projected end-of-day balance per account per day

Forecast recalculates on every page load. Output consumed by: Calendar day boxes, bar chart strips, Dashboard calendar widget, Upcoming widget.

---

## Plaid Integration

- **Plaid Link:** initial connection and re-auth (update mode)
- **`/transactions/sync`:** incremental sync with cursor-based deduplication
- **`/accounts/get`:** fetches current balances and masked account numbers (last 4 digits) on sync — full account and routing numbers are never requested

**Sync flow (manual via "Sync Now"):**
1. For each active `plaid_item`, call `/accounts/get` → update `accounts.current_balance`
2. Call `/transactions/sync` with cursor → upsert new/modified, soft-delete removed
3. Store updated cursor
4. If `ITEM_LOGIN_REQUIRED` → set status to `needs_reauth`, show warning banner

**Atomicity — each institution sync is a single SQLite transaction:**
The Plaid API call (step 2) happens outside the transaction — it's a network call. Once the response is received, a single database transaction writes all transaction upserts, soft deletes, balance updates, and the cursor update together. Either everything commits or everything rolls back. The cursor is never updated separately from the data it represents.

If a sync rolls back (power loss, crash, any error), the cursor stays at its previous value. The next sync sends the old cursor to Plaid, which re-delivers the same data. Because `plaid_transaction_id` is unique and upserts are idempotent, re-processing the same transactions is always safe.

**SQLite WAL mode** (`PRAGMA journal_mode=WAL`) is enabled on startup — more resilient to corruption on power loss than SQLite's default journal mode.

**Ally savings buckets:** not exposed by Plaid. Total balance only.

---

## Security

**Data stored on the Pi:**
- Transaction history, balances, payees — sensitive but read-only historical data
- Plaid access tokens (in `plaid_items.access_token`) — most sensitive; allow API access to bank account data
- Masked account numbers (last 4 digits only) — safe to store, never full account or routing numbers
- `.env` file — contains Plaid credentials; gitignored, never committed

**Encryption at rest:** Full-disk encryption on an always-on Pi that boots unattended is impractical — it requires a passphrase at every reboot. Risk is accepted given the low-probability threat model (opportunistic hardware theft, not targeted data extraction).

**If the Pi is stolen — response procedure (takes 5 minutes):**
1. Go to the Plaid dashboard → revoke all access tokens for all connected institutions
2. Go to the Tailscale admin console → remove the Pi device from the network

This kills bank API access and remote connectivity immediately.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Plaid token expired | Set `needs_reauth`, show warning banner on Dashboard + Accounts |
| Plaid API timeout | Show sync error toast, leave existing data intact |
| Sync partial failure | Continue other items, report which institution failed |
| Database write failure | Surface error in UI, do not silently discard |

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript (frontend + backend) |
| Frontend framework | React 18 |
| Frontend build | Vite |
| Styling | Tailwind CSS (responsive breakpoints throughout) |
| Backend framework | Express |
| Database | SQLite via better-sqlite3 |
| Plaid SDK | plaid-node |
| Remote access | Tailscale (free personal tier) |
| Package manager | npm |
| Repo | GitHub (private), branch → PR → merge workflow |

---

## Out of Scope

- Automatic background sync (manual only)
- Historical data import from Quicken
- Ally savings bucket tracking
- Mobile app
- Cloud deployment or remote access outside Tailscale
- Multi-user support or password authentication
- Budgeting, spending category reports (future — data model supports it)
- Investment account tracking
- Bill payment or any write operations to bank accounts
- Loan tracking
- Offline support

---

## Prerequisites Before Coding

- [ ] Plaid developer account — sign up at https://dashboard.plaid.com/signup (select "Personal use")
- [ ] Plaid `client_id` and `secret` → go in `.env`, never committed to git
- [ ] Pi Zero 2 W — Node.js 20 LTS install deferred to final build step
- [ ] `.env` file at project root (gitignored) — template provided during scaffold step
- [ ] Tailscale account — sign up at https://tailscale.com (free personal plan)
- [ ] `VITE_APP_NAME` in `.env` — defaults to "Finance", change anytime to rename the app

---

## Build Order

Implementation is broken into a POC and four phases. Each phase has its own implementation plan in `docs/plans/`.

### POC 1 — Plaid Spike
Validate the Plaid integration before building around it. Minimal Express + React app — no design, no SQLite. Wire up Plaid Link, connect one real account, fetch transactions, display in a plain list. Goal: prove the integration works end to end.

### Phase 1 — Core App
1. Project scaffold — monorepo structure, Express + React + Vite + TypeScript + SQLite wired up, running locally; includes PWA manifest + meta tags and `VITE_APP_NAME` config
2. Database schema — all six tables, seed categories with preset list, seed with test data
3. Plaid integration — production-quality Link widget, connect accounts, store tokens, sync transactions and balances, re-auth flow
4. Accounts view — Plaid connection list, manual account management, starting balance editor
5. Register view — synced transactions with running balance, account filter, cleared toggle, manual transaction entry

### Phase 2 — Forecasting & Calendar
6. Scheduled transactions CRUD — add/edit/delete recurring entries with all frequency types
7. Balance forecasting engine — 90-day projection from current balance + scheduled transactions
8. Calendar view — month grid with transactions, projected balances, color coding (desktop)
9. Bar charts — per-account strips below calendar, independent scale, hover tooltips

### Phase 3 — Categories, Dashboard & Backup
10. Categories and splits — category management, split entry UI, category filter in Register
11. Dashboard — four thumbnail widgets wired to live data, configurable Register widget
12. Backup and rollback — daily database backups, restore UI, sync preview before apply

### Phase 4 — Mobile, PWA & Deployment
13. Responsive design — all views adapted for mobile, bottom tab bar navigation
14. PWA — manifest, icons, home screen install
15. Deployment — Pi Zero 2 W production setup (or alternative hardware), serve static files from Express, Tailscale install + configuration
