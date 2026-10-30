# Operations runbook — POS and Sound Box Stock Inventory (dashboard)

Owner: Makara, Merchant Support (ABA Bank). Internal use. Last reviewed 29 Oct 2026.

## 1. Before every release
1. `npm run typecheck` must show no errors (the GitHub deploy also runs it and stops if it fails).
2. `npm run build`, then the end-to-end tests described in `CLAUDE.md`.
3. Run any new SQL in the Supabase SQL editor FIRST, then push the code that needs it.

## 2. Roll back a bad release (about 5 minutes)
1. GitHub → repository → Actions: note the last green run.
2. On your PC: `git log --oneline -5`, then `git revert <bad-commit-id>` and `git push`.
3. GitHub Actions publishes the reverted version in 1–3 minutes. Do not force-push.
4. If the problem is in the database, restore from the latest export (section 3) — Supabase Free has no automatic backup.

## 3. Backups (Supabase Free plan has none)
- Weekly (suggested: Monday): in the dashboard use Export Data for devices, requisitions, merchant history and audit log.
- Save the files on ABA-approved storage, not on a personal drive. Keep at least the last 8 weekly sets.
- Compliance: the exports contain merchant data; confirm the retention period and storage location with Compliance / IT Security.
- The project pauses after 7 days without activity; daily use prevents this.

## 4. Database change log (changes run by hand are not all in Supabase's migration list)
| Date | File | Note |
|---|---|---|
| 29 Oct 2026 | 20261029_03_rls_initplan_and_fk_indexes | Access checks evaluated once per query; 2 new indexes. Applied. |
| 29 Oct 2026 | 20261029_05_branch_on_hq_return_and_return_guard | Units returned to HQ stock from the phone app now move to Head Office; a stock return where no unit moved is no longer marked Received. Applied. |
| 29 Oct 2026 | 20261029_06_drop_redundant_indexes_and_anon_grant | Four duplicate indexes dropped; anonymous role can no longer run get_device_stage_counts. Applied. |
| 29 Oct 2026 | 20261029_04_revoke_anon_on_backup_table | Anonymous role no longer has any access to historical_merchants_backup_20261022. Applied. |
| 29 Oct 2026 | 07_speed_indexes_counts_realtime (run in SQL Editor) | Faster dashboard stage counts; two unused devices indexes dropped; audit_logs no longer streamed through Realtime. Applied. |
| 30 Oct 2026 | 20261030_08_qr_wrong_scan_kind | KHQR failed attempts get a kind: SUBMIT_BLOCKED (as before) or WRONG_SCAN (recorded at scan time). Existing numbers unchanged; wrong scans counted separately. Applied. |
| 30 Oct 2026 | 20261030_09_qr_shared_mids | New list qr_shared_mids (one MID entered by 2+ staff on the same day) and 'shared_mids' in qr_summary; index on (mid, submitted_at). Applied. |
| 30 Oct 2026 | Move to Singapore (supabase-move\move.bat + 01/02 after-restore migrations) | Database moved from Sydney (mrrzfmtaqjdwhwznznie) to Singapore (lfuqypmtcmrzwpuwyhye). All rows, staff sign-ins, functions, rules, Realtime, KHQR schedule copied and checked equal; table and function rights set exactly as Sydney (new projects open them to the anonymous role by default). Sydney kept, unchanged, as fallback. |

## 5. Secrets
- Only the public (anon/publishable) Supabase key is used in the website. Never put a secret key or the Telegram bot token in any `VITE_` variable: those are copied into the public JavaScript.
- Never upload a `dist` folder built on a PC. The website is built only by GitHub Actions.
- If a bot token or key is ever exposed, regenerate it at once (BotFather / Supabase settings).

## 6. How the stock is loaded (speed)
- First visit on a browser: the whole stock (~27,600 units) is read in pages and saved in the browser (IndexedDB).
- Every later reload (page reload, live feed reconnecting, back to the tab after 5 minutes, network back): only the units changed on the server since the saved copy are read and merged. The merged unit count must equal the server's count, otherwise the whole stock is read again.
- A full read is also done: after a refused save, when the saved copy is older than 12 hours, when more than 3,000 units changed, and after a sign-in by another person on the same browser.
- To switch the changed-only reload off (always read everything): set `DELTA_SYNC_ENABLED = false` at the top of `src/App.tsx` (below the imports) and push.
- The saved copy is updated 1.5 seconds after the last change and only the changed units are written.

## Database location (30 Oct 2026)
- Live: Singapore, project lfuqypmtcmrzwpuwyhye, https://lfuqypmtcmrzwpuwyhye.supabase.co (ap-southeast-1).
- Dashboard: address and publishable key in .github/workflows/deploy.yml (no GitHub secrets are used).
- Phone app: Script Properties INV_SUPABASE_URL / INV_SUPABASE_KEY (secret key 'apps_script'). The property list is read-only in the editor (more than 50 properties): change them with a one-off function, then delete it.
- Rollback: put the Sydney address/key back in both places. Sydney (mrrzfmtaqjdwhwznznie) has the data up to the move only.
- Plan: pause Sydney after one week without problems; delete it one month later.
