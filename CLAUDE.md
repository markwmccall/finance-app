# Finance App — Claude Code Instructions

## Prerequisites

This project uses the **superpowers** workflow. Install it before starting any work:

```
/plugin install superpowers@superpowers-dev
```

All planning, implementation, TDD, code review, and branching follows the superpowers workflow. Do not write code without first completing the brainstorming → writing-plans → executing-plans sequence.

---

## What This Is

A local personal finance app replacing Quicken Classic for Windows for household use. Primary user is Laurie (non-technical). Mark maintains the app and is the only developer.

See the full design spec before doing anything:
[`docs/superpowers/specs/2026-05-11-finance-app-design.md`](docs/superpowers/specs/2026-05-11-finance-app-design.md)

---

## Current State

Nothing is built yet beyond this file and the design spec. The next step is producing an implementation plan via the superpowers `writing-plans` skill, then building in the order defined below.

---

## Architecture (short version)

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS
- **Backend:** Node.js 20 + Express + TypeScript
- **Database:** SQLite via `better-sqlite3`
- **Bank sync:** Plaid (`plaid-node` SDK) — manual trigger only, no background sync
- **Runs on:** Raspberry Pi Zero 2 W on the home network
- **Access:** Any browser via `http://raspberrypi.local:3000` — no auth, single household

---

## Prerequisites Before Coding

- [ ] Plaid developer account — sign up at https://dashboard.plaid.com/signup (select "Personal use")
- [ ] Plaid `client_id` and `secret` → go in `.env`, never committed to git
- [ ] Pi Zero 2 W — Node.js 20 LTS install deferred to final build step
- [ ] `.env` file at project root (gitignored) — template provided during scaffold step

---

## Build Order

Implement in this sequence — do not skip ahead:

1. Project scaffold — monorepo structure, Express + React + Vite + TypeScript + SQLite wired up, running locally
2. Plaid integration — Link widget, connect an account, store token, fetch transactions and balances
3. Database schema — all four tables, seed with test data
4. Register view — synced transactions with running balance, account filter
5. Scheduled transactions CRUD — add/edit/delete recurring entries with all frequency types
6. Balance forecasting engine — 90-day projection from current balance + scheduled transactions
7. Calendar view — month grid with transactions, projected balances, color coding
8. Bar charts — per-account strips below calendar, independent scale, hover tooltips
9. Dashboard — four thumbnail widgets wired to live data
10. Accounts view — Plaid connection list, re-auth flow, starting balance editor
11. Pi Zero 2 W deployment — production setup, serve static files from Express

---

## Branching

- **Never commit to `main` directly.** All work happens on a feature branch.
- Branch naming: `phase/01c-register`, `fix/transaction-matching`, etc.
- Workflow: create branch → implement → push → open PR → merge to main from PR.

---

## Code Style

- TypeScript throughout — no `any` unless absolutely necessary
- Do not change punctuation, whitespace, or formatting in lines you are not otherwise modifying
- Keep files focused — if a file is growing large, it is probably doing too much
- Plans live in `docs/plans/` (e.g. `docs/plans/01-project-scaffold.md`)
