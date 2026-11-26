-- (26 Nov 2026) Fast "contains" search on the two largest searchable tables
--
-- The KHQR search box and the Stock Inventory search look for text anywhere in a value (merchant name, record ID,
-- staff, serial, MID...). A normal (B-tree) index cannot help with "contains", so every search read the whole table:
-- live averages were ~360 ms (KHQR, 28,000 entries) and ~720 ms (devices, 27,000 units) per search.
-- A trigram (GIN) index - pg_trgm, already installed - answers these in a few milliseconds for searches of 3 or more
-- characters. Each search reads several columns joined by OR, so every one of those columns is in the index
-- (one index per table covers them all).
--
-- Size: about 10 MB for both (database 89 MB of the free plan's 500 MB). Writes stay fast (the tables are small).
-- Nothing else changes: same results, same access rules. Safe to run more than once.
-- Each index takes a second or two to build; KHQR entries arriving meanwhile wait that long.

create extension if not exists pg_trgm with schema extensions;

-- KHQR entries: merchant_name, merchant_name_kh, record_id, staff_name, staff_id (text search) and mid (digits search)
create index if not exists qr_inst_search_trgm_idx on public.qr_installations using gin (
  merchant_name extensions.gin_trgm_ops,
  merchant_name_kh extensions.gin_trgm_ops,
  record_id extensions.gin_trgm_ops,
  staff_name extensions.gin_trgm_ops,
  staff_id extensions.gin_trgm_ops,
  mid extensions.gin_trgm_ops
);

-- Devices (Stock Inventory search): serial, mid, tid, merchant_name, model, battery_serial, branch_id, staff
create index if not exists devices_search_trgm_idx on public.devices using gin (
  serial extensions.gin_trgm_ops,
  mid extensions.gin_trgm_ops,
  tid extensions.gin_trgm_ops,
  merchant_name extensions.gin_trgm_ops,
  model extensions.gin_trgm_ops,
  battery_serial extensions.gin_trgm_ops,
  branch_id extensions.gin_trgm_ops,
  staff extensions.gin_trgm_ops
);

analyze public.qr_installations;
analyze public.devices;
