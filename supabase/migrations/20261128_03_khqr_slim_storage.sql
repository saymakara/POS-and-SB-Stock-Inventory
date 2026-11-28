-- (28 Nov 2026) KHQR: less database space per entry.
--
-- Measured on production (28 Nov 2026, 30,481 KHQR entries for November):
--   * public.qr_installations uses 33 MB: 13 MB of data and 20 MB of indexes (about 1.1 KB per entry);
--   * the search index qr_inst_search_trgm_idx alone is 7.9 MB (24 % of the table) and was used 5 times since 29 Oct.
--
-- What changes: the search index is removed. Search on the KHQR page still works the same way (merchant name, Khmer
-- name, Record ID, staff name, Staff ID; a MID still uses its own index); it reads the entries of the chosen period
-- instead. Measured without the index: 0.09-0.3 s per search.
-- Result: about 8 MB less now and about 25 % less for every new month (about 1.1 KB -> 0.85 KB per entry).
--
-- Undo (if searches ever feel slow):
--   create index qr_inst_search_trgm_idx on public.qr_installations using gin (merchant_name gin_trgm_ops,
--     merchant_name_kh gin_trgm_ops, record_id gin_trgm_ops, staff_name gin_trgm_ops, staff_id gin_trgm_ops, mid gin_trgm_ops);
-- Safe to run more than once.

drop index if exists public.qr_inst_search_trgm_idx;
