-- 03 Nov 2026 · Remove the one-off backup table historical_merchants_backup_20261022.
--
-- Why: a leftover copy (6 rows) taken during the 22 Oct 2026 merchant-history clean-up. Nothing in the app, no view and
-- no foreign key used it, and it kept merchant phone numbers outside the live table. Approved by the POS Terminal
-- Merchant Support Manager on 03 Nov 2026 (performance & security audit, recommendation 4).
-- The rows were exported before the drop and are NOT stored in this public repository (they contain merchant contact data).
-- The live table public.historical_merchants is untouched.

drop table if exists public.historical_merchants_backup_20261022;
