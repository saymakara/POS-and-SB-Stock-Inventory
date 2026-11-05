# Changelog — In-Store Management Portal

Notable changes, newest first. Database changes are in `supabase/migrations/` (each file says when it was applied).

## 5 Nov 2026 — Merchant kit & materials (step 1: portal)
- The Monthly Count page was removed at the user's request (its database table and functions stay, unused).
Database: migration `20261105_01_materials_and_kits.sql` (applied 5 Nov 2026); self-test
`supabase/tests/materials_selftest.sql` (39 checks, rolls itself back).
- **Stock Inventory is now a group.** The heading opens all units as before; below it: **POS Terminal** and **Sound Box**
  (tabs *Units* and *Material*) and **SIM Card**. A red number shows open Lost items per page.
- **Materials per location:** Battery (by serial), POS AC Adaptor, POS Stand Holder, Charging Dock (POS), Sound Box AC Adaptor;
  Stock In, Correct (with reason), opening stock from a CSV template, Export CSV. Each page has its own **Lost** table:
  Recovered or Written off (reason); a lost SIM can be marked **Blocked with carrier**.
- **SIM Card register:** every SIM by number (096 555 0142 = 0965550142 = +855 96 555 0142), where it is and which merchant
  and unit it serves. A SIM already at a merchant cannot be given to another one. Returned SIMs are re-used.
- **Merchant 360 → Kit:** connection (4G SIM / merchant Wi-Fi) and every item the merchant holds, with who gave it and when.
  Admin HQ can record the kit of an existing merchant, issue from branch stock, replace, or take back (Returned / Lost / Faulty).
- **Stock Requests carry materials:** branches request them with POS and Sound Box; Admin HQ dispatches devices and
  materials together (all or nothing); receipt (portal or Merchant Visit app) moves them into the branch reserve.
- Branch staff see only their own branch; every change goes through a checked database function and the Audit Trail.
- Step 2 (with the next Merchant Visit app release): kits recorded at installation and return from the phone, reviewed in
  Phone App Review.

## 4 Nov 2026 — Speed and smoothness
Measured first (20,000–28,000 units, phone-speed CPU), then fixed at the cause. No change to design, features or database security.
- **Push Configuring: 50 / 100 rows per page.** Every queued unit was drawn at once (2,857 units = 108,000 page elements):
  opening the tab, and leaving it for Stock Requests, froze the browser for up to 22 s on a phone. Now under 1 s. Select all,
  branch file and push actions still cover the whole filtered list.
- **No more duplicate downloads.** The staff list was downloaded 2–3 times at sign-in (16 pages each); Credit Card list and
  counts twice per visit. Requests now share one download; the staff list comes in 1 request instead of 16.
  Sign-in: 89 → about 40 requests.
- **Dates and numbers 13–20× faster to format.** The Phnom Penh time helper built a new formatter on every call (used in
  145 places: KPI, dashboard, tables, CSV). One reused formatter; identical output.
- **Merchant Visit opens instantly on return** (no "Loading" flash), like the other review pages; memory only, cleared on sign-out.
- **First sign-in on a new browser:** the saved copy of the stock is written in steps of 250 (was 1,000) so the page stays responsive.

## 4 Nov 2026
- **Phone App Review — tick boxes aligned.** On every page the tick box sits in a fixed slot at the left of the No.
  column, so boxes form one straight column under the header box (rows 9 → 10 no longer shift), with one box style everywhere.
- **Phone App Review — permanent delete (Super Admin only).** Multiple select on POS Terminal, Sound Box, KHQR (entries,
  failed attempts, wrong scans, same MID by 2+ staff), Merchant Visit and Credit Card; delete after typing DELETE, with an
  optional reason in the Audit Trail. Approved POS / Sound Box records cannot be deleted (they changed the stock).
  Deleted Record IDs are kept so the Merchant Visit app never sends them again. Migrations `20261104_07`, `20261104_08`.
- **KPI points for the new Merchant Visit app activities.** New category *Merchant Visit*; ready-made rules (inactive,
  0 points) for POS Active / In-Active Maintenance, POS Return & Terminate and every visit activity. Migration `20261104_06`.
- **Every Merchant Visit app submission reaches the portal.** New page *Phone App Review → Merchant Visit*; POS Active
  Maintenance, POS In-Active Maintenance and POS Return & Terminate in POS review (approving a return works like a Sound Box
  return). Migrations `20261104_03`–`05`.
- **Stock Request from the Merchant Visit app** into Stock Requests, with receipt confirmation in the app. Migration `20261104_01`.
- Branch alias: "Phsar Daeum Thkov Branch" → branch 115. Migration `20261104_02`.

## 3 Nov 2026
- Performance and security audit: KPI query speed, account checks, Content Security Policy, save protection.

## 23 Oct 2026
- Save protection (circuit breaker, throttled reload, "new version" banner): a refused save can no longer repeat in a loop and fill the Supabase log.
- Stock Inventory: installer above branch code, lighter Merchant Name, Terminated & Returned summary card (summary only), TID filled automatically as the last 8 digits of the MID.
- Search by serial / MID / TID shows everything (inventory, Merchant History, stock requests, Phone App records, audit trail).
- 50 / 100 rows per page on every table; "Clear filters" on every tab with filters; pop-ups centred with the page behind locked.
- Stock Requests: Reject with a reason (database function `admin_reject_requisition`, migration `20261023_01_reject_requisition.sql`).
- Phone App Review: Date Sent column; one row per device (MID); "Entered by" shows whether the phone scanned or typed each number.
- Terminate in the Merchant 360 view clears every merchant field on the unit and keeps the old merchant in Merchant History.
