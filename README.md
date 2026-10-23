# POS and Sound Box Stock Inventory

Enterprise Hardware Stock Control, Merchant Deployment Lifecycle, Multi-Officer Accountability, and Branch Reserve Management for Smart POS Terminals & Dynamic QR Sound Boxes.

[![Deploy to GitHub Pages](https://github.com/saymakara/POS-and-SB-Stock-Inventory/actions/workflows/deploy.yml/badge.svg)](https://github.com/saymakara/POS-and-SB-Stock-Inventory/actions/workflows/deploy.yml)
[![Live Site](https://img.shields.io/badge/Live-Demo-003857?style=flat&logo=github)](https://saymakara.github.io/POS-and-SB-Stock-Inventory/)

🌐 **Live Production Demo:** [https://saymakara.github.io/POS-and-SB-Stock-Inventory/](https://saymakara.github.io/POS-and-SB-Stock-Inventory/)

---

## 🚀 Key Features

- **End-to-End Hardware Lifecycle:** Track devices across all stages:
  - `Admin HQ Stock (Branch Code 100)`
  - `Branch Reserve` *(Available in-stock branch buffer)*
  - `Configuring`
  - `Merchant Deployment (Installed Live)`
  - `Terminate / Return (Merchant History)`
  - `Device Lost`
- **Multi-Officer Accountability:** Distinct tracking of **Field Installer**, **Replacement / Swap Officer**, and **Decommission & Return Officer** with automated difference alerts.
- **Merchant Deployment & 360 Registry:** Detailed Merchant Profiles (MID, TID, Contact Phone, Physical Address) with quick multi-unit hardware binding and replacement workflows.
- **Stock Requisitions & Governance:** Automated SLA turnaround tracking, branch replenishment requests, and 24-month battery degradation alerts.
- **Audit Trail & CSV Reporting:** Full chronological logging with paginated search, filterable event categories, and one-click data export.

---

## 🛠️ Technology Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS
- **Icons & Motion:** Lucide React, Motion (Framer Motion)
- **Charts:** Recharts (Deployment Velocity & Monthly Ingestion Matrices)
- **Hosting:** GitHub Pages via GitHub Actions

---

## 💻 Local Development

### Prerequisites
- Node.js (v18+)
- npm or bun

### 1. Clone the repository
```bash
git clone https://github.com/saymakara/POS-and-SB-Stock-Inventory.git
cd POS-and-SB-Stock-Inventory
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application in your browser.

### 4. Build for production
```bash
npm run build
```
Generates a static, relative production bundle in `dist/`.

---

## 📄 License
Internal banking enterprise management application. All rights reserved.

---

## 🔒 Security Model (reviewed 22 Oct 2026)

- **The database decides, not the browser.** Every rule is enforced by Supabase row-level security and database functions: Branch Staff see and change only their own branch; Admin HQ actions (dispatch, approvals, accounts) run in checked server functions; only a Super Admin can permanently delete.
- **First password.** A new account cannot read any data until its first password is changed, and the change is refused if the new password is still the Employee ID.
- **Tamper-proof history.** A unit's history can only be added to by branch users; stage moves from a branch follow the device life cycle; audit entries are stamped by the database with the real user and branch.
- **Browser.** The published site carries a Content Security Policy (only this site, Supabase and Google Fonts), CSV exports neutralise spreadsheet formulas, and nothing of a signed-out user is left in the browser.

## 🧪 Tests

Build the site, serve `dist/` on port 8500, then run with Playwright installed:

```bash
npm run build && (cd dist && python3 -m http.server 8500 &)
node tests/e2e/inv_e2e.js      # functional regression (sign-in, dispatch, phone review, saving, stale copies)
node tests/e2e/stress.js       # 20,000 units / 1,500 requests / 3,000 phone records: load, tabs, search, sort, memory
node tests/e2e/rt_stress.js    # live feed: bursts of 500 changes, late/old copies, deletes, no echo back to the server
```

The tests use a stand-in of the Supabase API, so they never touch live data.

## 23 Oct 2026 changes
- Save protection (circuit breaker, throttled reload, "new version" banner): a refused save can no longer repeat in a loop and fill the Supabase log.
- Stock Inventory: installer above branch code, lighter Merchant Name, Terminated & Returned summary card (summary only), TID filled automatically as the last 8 digits of the MID.
- Search by serial / MID / TID shows everything (inventory, Merchant History, stock requests, Phone App records, audit trail).
- 50 / 100 rows per page on every table; "Clear filters" on every tab with filters; pop-ups centred with the page behind locked.
- Stock Requests: Reject with a reason (database function `admin_reject_requisition`, migration `20261023_01_reject_requisition.sql`, already applied).
- Phone App Review: date sent above the serial; optional serial / MID verification by typing or scanning.
- Terminate in the Merchant 360 view clears every merchant field on the unit and keeps the old merchant in Merchant History.
