# Engineering rules — In-Store Management Portal

Rules learned from real incidents (Oct–Nov 2026). Every change keeps them; the ones marked **(checked)** fail the
deployment automatically.

1. **Writes go through checked database functions.** Tables changed only by `SECURITY DEFINER` functions (materials,
   kits, phone records, staff) are never written from the browser. **(checked: `tests/static_guards.cjs`)**
2. **Direct table writes live in the service layer** (`src/services/supabaseService.ts`), nowhere else. **(checked)**
3. **Never report success that did not happen.** Every database call reads its `error`; a refusal is shown to the user in
   plain words (`cleanMaterialError`). No silent fallbacks. **(checked: bare `await supabase…` statements)**
4. **Database changes ship as a migration file + a self-test** (`supabase/tests/*_selftest.sql`, rolls itself back), tested
   on a local Postgres first. A migration is applied in production before (or together with) the code that needs it;
   the portal never assumes an unapplied function exists.
5. **Partial updates are not full updates.** A save routine that expects a whole record (e.g. `handleSaveWorkflow`) is
   given the whole record — never just the changed field.
6. **Lists that can grow have a limit** (row caps, page sizes, cache sizes). A plain `select` stops at 1,000 rows: use
   exact counts (`count: 'exact', head: true`) for totals.
7. **Before merging:** `npm run check`, `npm run build`, and the browser suites in `tests/e2e/` all pass.
