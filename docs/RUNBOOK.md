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
| 29 Oct 2026 | 20261029_06_drop_redundant_indexes_and_anon_grant | Four duplicate indexes dropped. File ready; run it in the SQL editor (not yet applied). |
| 29 Oct 2026 | 20261029_04_revoke_anon_on_backup_table | Anonymous role no longer has any access to historical_merchants_backup_20261022. Applied. |

## 5. Secrets
- Only the public (anon/publishable) Supabase key is used in the website. Never put a secret key or the Telegram bot token in any `VITE_` variable: those are copied into the public JavaScript.
- Never upload a `dist` folder built on a PC. The website is built only by GitHub Actions.
- If a bot token or key is ever exposed, regenerate it at once (BotFather / Supabase settings).
