# Changelog — In-Store Management Portal

Notable changes, newest first. Database changes are in `supabase/migrations/` (each file says when it was applied).

## 11 Nov 2026 — Credit Card: Well Received and Follow Up

- Phone App Review → Credit Card, on an entry waiting for review (Admin HQ):
  **Well Received** acknowledges the onboarding and marks it **Waiting documents** (Head Office waits for the staff member
  to bring the documents); **Follow Up** sends a reminder and counts it (at most one every 10 minutes per entry).
  The bot replies under the staff member's post in the staff group (Merchant Visit 3.99+). Confirm / Reject are unchanged;
  confirming a waiting entry marks its documents received.
- New filter tab **Waiting documents**; the Waiting review card shows how many wait for documents; the CSV export adds
  Documents, Well Received At, Follow-ups, Last Follow-up.
- Database: `supabase/migrations/20261111_01_cc_documents.sql` (new function `cc_docs`, Admin HQ only; four new columns on
  `cc_entries`; `cc_review`, `cc_list`, `cc_counts`, `cc_outbox_take` updated). Additive; safe to run again. An older phone
  app never receives the document notices, so it cannot post them as a decision.
- Test: `tests/e2e/cc_docs_e2e.js` (stand-in API).

## 10 Nov 2026 — Merchant Visit Request: each staff member sees only their own requests

- `mv_req_list` takes the staff ID and returns only that staff member's requests (Merchant Visit 3.97). Without it
  (older app) it still lists the branch.
- `mv_req_edit` and `mv_req_confirm` refuse another staff member's request (`OTHER_STAFF`). Admin HQ can still mark any
  request as received in Stock Requests.
- New helper `app.mv_req_is_own(staff, staff_id)`: matches the "NAME (STAFF_ID)" stored by `mv_req_submit`.
- Apply: run `supabase/migrations/20261110_01_mv_request_own.sql` in the SQL Editor (safe to run again). No table change.

## 8 Nov 2026 — Merchant Visit Request: correct a waiting stock request

- New database function `mv_req_edit` (service key only, used by the Merchant Visit app 3.95): branch staff can change the
  POS / Sound Box quantities, materials and note of their branch's stock request while it is still **Waiting for Admin HQ**.
  Same rules as a new request. Dispatched / rejected requests, returns and other branches' requests cannot be changed.
  Every change is written to the audit log with the old and new numbers.
- Apply: run `supabase/migrations/20261108_02_mv_request_edit.sql` in the SQL Editor (safe to run again). No table change.

## 8 Nov 2026 — "POS Active Maintenance" is now "POS Operational Support"
Merchant Visit 3.86 renames the request. In the portal: the POS Terminal review page shows the new name, and
`20261108_01_pos_operational_support_label.sql` (run in the SQL Editor; safe to run again) renames the KPI rule. The kind
stays `POS_MAINT`, so records, KPI points and history are unchanged; a rule name an admin edited is kept.

## 7 Nov 2026 — Merchant Visit Request: POS / Sound Box materials
Database only (`20261107_02_mv_request_materials.sql`, run in the SQL Editor; self-test `supabase/tests/mv_request_materials_selftest.sql`).
- `mv_req_submit` takes the materials a branch asks for from the Merchant Visit app (`materials {CODE: qty}`: active catalogue
  items only, 1–100 each). A request may be units only, materials only, or both; a call without materials works as before.
- `mv_req_list` returns each request's materials and what was dispatched, plus the catalogue the app offers.
- Nothing else changes: Stock Requests already shows requested materials, Dispatch sends them and Confirm Receipt moves them
  into the branch reserve. Both functions stay service-key only.

## 7 Nov 2026 — Phone App Review: Edit details (Admin / Super Admin)
Database: migration `20261107_01_phone_record_edit.sql` (to apply in the SQL Editor); self-test
`supabase/tests/phone_edit_selftest.sql` (27 checks, rolls itself back). Needs Merchant Visit 3.81 for the Google Sheet.
- **Edit details** in every Phone App Review page (POS Terminal, Sound Box, KHQR, Merchant Visit, Credit Card): open a record,
  tap *Edit details*, correct any field, save. Only the fields that changed are sent; an optional reason goes to the Audit Trail
  with old → new for each field.
- **Approved POS Terminal / Sound Box records:** serial numbers, MID, TID and batteries are shown locked (they already changed
  the stock); every other field can be corrected. To change a locked field: reject and redo the entry, or fix the unit in Stock Inventory.
- **POS Terminal / Sound Box:** Terminal Name, MID, TID and serials belong to the one device; Outlet Name, Remarks, location,
  returned items, checks and feedback belong to the whole entry (all its devices). **Merchant Visit:** every answer (Tag, Activity
  Type, …). **Credit Card:** customer fields and each supplementary card (corrected, not added or removed). **KHQR:** merchant,
  MID, type, place.
- **Google Sheet:** each change is queued (`phone_record_edits`); Merchant Visit 3.81 writes it into the same row(s) of its
  Sheet within 5 minutes and reports back. The edit window lists earlier changes with *Waiting for the Google Sheet / In the
  Google Sheet / Not written (why)*. KHQR entries are portal only.
- Only an active Admin or Super Admin can edit (checked in the database); branch users see no Edit.
- Tests: new browser check `tests/e2e/edit_e2e.js` (16 checks); type check, static guards (the edit queue is database-function
  only), build and the 8 other browser suites passed.

## 7 Nov 2026 — Smooth Units / Push Configuring / Material switching
No change to the database or to what each view shows.
- **POS Terminal and Sound Box pages:** switching between Units, Push Configuring and Material no longer flickers.
  Before, the old view faded out and was removed (the page collapsed and jumped), then the new view was built from scratch
  and its own Units / Push / Material switch appeared again. Now each view is built the first time it is opened and kept;
  the chosen view fades in at once, the highlight glides from the previous tab, and the page keeps its scroll position
  (a short view such as Material no longer pulls the page up). Opening a view again is instant.
- **Every screen that loads on first use** (Branch Codes, Stock Requests, Push Configuring, …): once its code has been fetched
  in the background, it is drawn at once - no more one-frame loading placeholder the first time it opens.
- Tests: new browser check `tests/e2e/view_switch_e2e.js` (65 checks, every animation frame: one view on screen, switch
  always visible, no page jump, highlight glides, views reopen without rebuilding, POS Terminal and Sound Box); type check,
  static guards, build and all 9 browser suites passed.

## 7 Nov 2026 — Refactor: less code, safety rules on every deployment
No change to what users see or to the database.
- **Removed unused code (~1,600 lines):** 5 files never used (SetupAlert, ScanField, KpiDetailBreakdown, useProgressive,
  useFlip) and 25 functions nothing called (old paged fetchers, unused CSV / MID helpers, IndexedDB loaders, …).
- **App.tsx split:** the shell setup (lazy page registry, storage keys, tab lists, saved session, helpers) moved unchanged
  to `src/app/appSetup.tsx`; App.tsx is 260 lines shorter and only the App component remains.
- **Sign-in screen:** the dashboard code now starts downloading only once the sign-in field is on screen (it could race
  the sign-in screen on slow phones; the smoke test that caught it now passes every run).
- **Safety rules, checked on every deployment** (`tests/static_guards.cjs`, `npm run check`, GitHub deploy step): no direct
  writes to tables that only checked database functions may change (materials, kits, phone records, staff); direct
  writes only in the service layer; no database call whose error is never read. The error logger now reads its own
  save result.
- Tests: type check, static guards, build, 8 browser suites (smoke 16, materials 38, inventory 54, KHQR 26, delta 13,
  delete 33, visits 15, session lock 9) — all passed.

## 6 Nov 2026 — Manage SIM checked by the database; Lost Materials back
Database: migration `20261106_01_sim_card_manage.sql` (to apply in the SQL Editor); self-test
`supabase/tests/sim_manage_selftest.sql` (16 checks, rolls itself back).
- **Manage SIM never reports "saved" when nothing was saved.** The panel no longer tries a direct table write when the
  database refuses; the reason is shown in plain words (e.g. "SIM … is lost. Recover it in Lost Materials first.").
- **Manage SIM follows the stock rules:** SIM numbers are matched the portal's way (012 345 678 = 012345678); a SIM put in a
  unit at a merchant goes into that merchant's kit (the SIM it replaces goes back to the branch reserve); Branch Reserve /
  HQ Stock takes it out of the kit; Lost needs a remark and opens a Lost item; Written off only for a lost or faulty SIM;
  new SIMs for stock go through Stock In. Every change is in the movements ledger and the Audit Trail.
- **Lost Materials** list is back on POS Terminal → Material, Sound Box → Material and SIM Card, shown only when something
  was reported lost: Recovered, Write off (reason), Blocked with carrier (SIM).
- **Battery** can be recorded for a Sound Box as well as a POS Terminal.
- **SIM status counts** are exact for any number of SIMs (the previous single read stopped at 1,000).
- After a Manage SIM save, the unit keeps its stage, branch and merchant; only its SIM number is updated.

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
