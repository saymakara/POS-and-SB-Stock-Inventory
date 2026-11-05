# In-Store Management Portal

Stock control and merchant deployment management for ABA Bank Merchant Support: POS Terminals, Sound Boxes and KHQR,
with review of the field work sent from the Merchant Visit app.

[![Deploy to GitHub Pages](https://github.com/saymakara/POS-and-SB-Stock-Inventory/actions/workflows/deploy.yml/badge.svg)](https://github.com/saymakara/POS-and-SB-Stock-Inventory/actions/workflows/deploy.yml)

> Internal application. Access requires a staff account; every rule is enforced by the database.

---

## Features

| Area | What it does |
|---|---|
| **Stock Inventory** | Each device through its life cycle: Admin HQ stock → branch reserve → configuring → installed at a merchant → returned / terminated, or lost. Full unit history. One page per product (POS Terminal, Sound Box) with its units and materials. |
| **Materials & Merchant Kit** | SIM cards (by number), batteries (by serial), adaptors, stands and docks per location; the kit each merchant holds; Lost items; the monthly branch count. |
| **Merchant Deployment & History** | Merchant profiles (MID, TID, contact, address), installations, replacements and terminations, with past merchants kept in Merchant History. |
| **Stock Requests** | Branch replenishment and returns: request, dispatch with serial numbers, reject with a reason, receipt confirmation (also from the Merchant Visit app). |
| **Phone App Review** | Records from the Merchant Visit app: POS Terminal and Sound Box (approve / reject updates the stock), KHQR, Merchant Visit and Credit Card. Super Admin can select several records and delete them permanently. |
| **KPI Performance** | Points per staff and branch from the field work, against daily / weekly / monthly / quarterly targets. Point rules are set in Settings. |
| **Audit Trail** | Every change and decision, with the user, branch and time; CSV export. |

## Technology

- **Front end:** React 19, TypeScript, Vite, Tailwind CSS, Recharts, Motion
- **Back end:** Supabase (PostgreSQL with row-level security, database functions, realtime)
- **Hosting:** GitHub Pages, published by GitHub Actions on every push to `main`

## Project structure

```
src/                   React application (components, services, utilities)
supabase/migrations/   Database changes, in date order (each states when it was applied)
supabase/tests/        Self-tests to run in the Supabase SQL Editor (they roll themselves back)
tests/e2e/             End-to-end browser tests against a stand-in of the Supabase API
scripts/dev-server.ts  Local development server
docs/                  Operations runbook and changelog
public/                Icons, web manifest and service worker
```

## Local development

Requirements: Node.js 20 or later.

```bash
npm install
cp .env.example .env.local      # then fill in the Supabase URL and publishable key
npm run dev                     # http://localhost:3000
```

Other commands:

```bash
npm run typecheck               # TypeScript check (the deploy stops if it fails)
npm run build                   # production bundle in dist/
```

## Tests

The end-to-end tests run the built portal against a stand-in of the Supabase API, so they never touch live data.
Playwright must be installed.

```bash
VITE_SUPABASE_URL=https://mrrzfmtaqjdwhwznznie.supabase.co VITE_SUPABASE_ANON_KEY=test npm run build
node tests/e2e/serve-dist.cjs &         # serves dist/ on http://127.0.0.1:8500
node tests/e2e/smoke_all_tabs.js        # every tab opens without errors
node tests/e2e/inv_e2e.js               # sign-in, dispatch, phone review, saving
node tests/e2e/delete_e2e.js            # multiple select and permanent delete
node tests/e2e/visit_e2e.js             # Merchant Visit page and POS maintenance / return review
node tests/e2e/materials_e2e.js         # materials, SIM register, kits, monthly count, requests with materials
node tests/e2e/stress.js                # 20,000 units, 1,500 requests, 3,000 phone records
```

## Deployment

1. Apply any new file in `supabase/migrations/` in the Supabase SQL Editor **first**.
2. Merge into `main`. GitHub Actions type-checks, builds and publishes to GitHub Pages in about 2 minutes.

Rollback and backup steps: [`docs/RUNBOOK.md`](docs/RUNBOOK.md). Change history: [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

## Security

- **The database decides, not the browser.** Row-level security and checked database functions enforce every rule:
  branch staff see and change only their own branch; Admin HQ actions run in server functions; only a Super Admin can
  delete permanently.
- **Keys.** Only the Supabase publishable key is used in the browser. The service key is never in this repository or in
  the website.
- **First password.** A new account can read nothing until its first password is changed.
- **Browser.** Content Security Policy (this site, Supabase and Google Fonts only); CSV exports neutralise spreadsheet
  formulas; nothing of a signed-out user is left in the browser.

## License

Proprietary — ABA Bank internal use. All rights reserved.
