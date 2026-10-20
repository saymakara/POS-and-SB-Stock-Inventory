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
