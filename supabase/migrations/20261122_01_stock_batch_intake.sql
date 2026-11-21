-- ============================================================================================================================
-- 22 Nov 2026 - Stock Inventory > Upload CSV: one server step that checks every row again and saves the whole file at once.
--
-- Before: after the page's own checks, rows were saved from the browser in groups of 250 (new serials) and ONE REQUEST PER
-- UNIT for HQ stock moved to a branch (1,000 units = 1,000 requests). The window said "Registered" before the server had
-- answered; a group refused half-way left the file half saved; a serial added by someone else meanwhile was skipped silently.
--
-- Now:
--   stock_batch_stage(p)   the page sends the unit records it built, in parts of up to 2,000 rows (stock_batch_staging);
--   stock_batch_commit(p)  ONE transaction: every row is checked again on the server, then ALL rows are saved - or, if any
--                          row has a problem, NOTHING is saved and the problems come back with their CSV row numbers.
--   Admin HQ / Super Admin only. At most 10,000 rows per file.
-- Server checks (each names the CSV row and column):
--   serial 3-40 letters/digits/-/_, not twice in the file; a new serial must not exist yet; a unit moved from HQ stock must
--   still be in HQ stock and unchanged since the page loaded it; type POS Terminal / Sound Box; known lifecycle stage; branch
--   exists; Under Configuring / Installed need a merchant name and a MID; MID 15 digits, POS starts with 2, Sound Box with 6;
--   TID 4-16 characters, not twice in the file, not on another configuring/installed unit; battery serial not twice in the
--   file and not on another unit (placeholders such as N/A, or a value already shared by 10+ units, are not checked);
--   stock-in date is a real YYYY-MM-DD date.
-- The MID rule is the same rule as the page and the Merchant Visit app (unchanged). Every saved unit keeps the history line
-- the page wrote; one Audit Trail entry per file. Safe to run twice.
-- ============================================================================================================================

create table if not exists public.stock_batch_staging (
  batch_id uuid not null, row_no integer not null, op text not null, row_version bigint, device jsonb not null,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  primary key (batch_id, row_no)
);
alter table public.stock_batch_staging enable row level security;      -- no policy: only the two functions below use it
revoke all on public.stock_batch_staging from public, anon, authenticated;

create or replace function app.stock_stage_label(s text) returns text language sql immutable set search_path = '' as $$
  select case s when 'HQ_STOCK' then 'HQ Stock' when 'BRANCH_RESERVE' then 'Branch Reserve' when 'CONFIGURING' then 'Under Configuring'
                when 'COMPLETE' then 'Installed' when 'FAULTY' then 'Faulty' when 'LOST' then 'Lost' else coalesce(s, '') end
$$;

create or replace function public.stock_batch_stage(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid := (p->>'batch_id')::uuid; v_rows jsonb := coalesce(p->'rows', '[]'::jsonb); n int;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can upload stock.' using errcode = '42501'; end if;
  if v_batch is null then raise exception 'batch_id is required' using errcode = '22023'; end if;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) > 2000 then
    raise exception 'Send at most 2,000 rows at a time.' using errcode = '22023';
  end if;
  delete from public.stock_batch_staging where created_at < now() - interval '1 day';   -- leftovers of closed windows
  insert into public.stock_batch_staging (batch_id, row_no, op, row_version, device)
  select v_batch, (r->>'row_no')::int, case when r->>'op' = 'move' then 'move' else 'create' end,
         nullif(r->>'row_version', '')::bigint, coalesce(r->'device', '{}'::jsonb)
    from jsonb_array_elements(v_rows) r
  on conflict (batch_id, row_no) do update set op = excluded.op, row_version = excluded.row_version, device = excluded.device;
  get diagnostics n = row_count;
  return jsonb_build_object('staged', n);
end $$;
revoke all on function public.stock_batch_stage(jsonb) from public, anon;
grant execute on function public.stock_batch_stage(jsonb) to authenticated;

create or replace function public.stock_batch_commit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid := (p->>'batch_id')::uuid; v_total int := (p->>'total')::int;
  me public.staff_profiles; v_n int; v_err jsonb; v_err_n int; v_created int := 0; v_moved int := 0; v_versions jsonb;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can upload stock.' using errcode = '42501'; end if;
  select * into me from public.staff_profiles where user_id = auth.uid();

  drop table if exists pg_temp._sb;
  create temp table _sb on commit drop as
  select s.row_no, s.op, s.row_version, s.device,
         upper(btrim(coalesce(s.device->>'serial', ''))) as serial,
         btrim(coalesce(s.device->>'type', '')) as type,
         btrim(coalesce(s.device->>'stage', '')) as stage,
         btrim(coalesce(s.device->>'branch_id', '')) as branch_id,
         btrim(coalesce(s.device->>'merchant_name', '')) as merchant,
         btrim(coalesce(s.device->>'mid', '')) as mid,
         btrim(coalesce(s.device->>'tid', '')) as tid,
         upper(btrim(coalesce(s.device->>'battery_serial', ''))) as battery,
         btrim(coalesce(s.device->>'stock_in_date', '')) as stock_in
    from public.stock_batch_staging s where s.batch_id = v_batch;
  delete from public.stock_batch_staging where batch_id = v_batch;
  select count(*) into v_n from _sb;
  if v_n = 0 or v_n <> coalesce(v_total, -1) then
    raise exception 'The file did not arrive complete (% of % rows). Nothing was saved - please press Confirm again.', v_n, coalesce(v_total, 0) using errcode = '22023';
  end if;
  if v_n > 10000 then
    raise exception 'At most 10,000 rows per file (this one has %). Nothing was saved - please split the file.', v_n using errcode = '22023';
  end if;
  create index on _sb (serial); analyze _sb;

  -- every problem, with its CSV row and column (set-based: a few index lookups for the whole file) ----------------------
  with r as (select * from _sb),
  dev as (select d.serial, d.stage, d.branch_name, d.row_version from public.devices d where d.serial in (select serial from r)),
  tid_used as (select distinct on (d.tid) d.tid, d.serial, d.stage, d.merchant_name from public.devices d
                where d.tid in (select tid from r where tid <> '') and d.stage in ('CONFIGURING', 'COMPLETE') order by d.tid, d.serial),
  bat_shared as (select upper(battery_serial) b from public.devices where coalesce(battery_serial, '') <> '' group by 1 having count(*) >= 10),
  rb as (select * from r where battery <> '' and battery not in ('N/A', 'NA', '-', '--', 'NONE', 'NULL', '0', 'NO')
                               and battery not in (select b from bat_shared)),
  bat_used as (select distinct on (upper(d.battery_serial)) upper(d.battery_serial) b, d.serial from public.devices d
                where upper(d.battery_serial) in (select battery from rb) order by upper(d.battery_serial), d.serial),
  e as (
    select row_no, 'Serial_SN' col, 'Serial "' || serial || '" is not valid (3-40 letters, digits, - or _).' msg from r where serial !~ '^[A-Z0-9_-]{3,40}$'
    union all
    select row_no, 'Serial_SN', 'Serial "' || serial || '" is twice in the file (first at row ' || first_row || ').'
      from (select row_no, serial, min(row_no) over (partition by serial) first_row from r) x where row_no <> first_row
    union all
    select r.row_no, 'Serial_SN', 'Serial "' || r.serial || '" is already in the inventory (' || app.stock_stage_label(dev.stage) || coalesce(' at ' || dev.branch_name, '') || ').'
      from r join dev on dev.serial = r.serial where r.op = 'create'
    union all
    select r.row_no, 'Serial_SN', case
             when dev.serial is null then 'Serial "' || r.serial || '" is not in the inventory.'
             when dev.stage <> 'HQ_STOCK' then 'Serial "' || r.serial || '" is no longer in HQ stock (now ' || app.stock_stage_label(dev.stage) || coalesce(' at ' || dev.branch_name, '') || ').'
             else 'Serial "' || r.serial || '" was changed by someone else just now - reload the page and upload again.' end
      from r left join dev on dev.serial = r.serial
     where r.op = 'move' and (dev.serial is null or dev.stage <> 'HQ_STOCK' or dev.row_version is distinct from r.row_version)
    union all
    select row_no, 'Product_Type', 'Product type "' || type || '" is not POS Terminal or Sound Box.' from r where type not in ('POS Terminal', 'Sound Box')
    union all
    select row_no, 'Lifecycle_Stage', 'Lifecycle stage "' || stage || '" is not known.' from r where stage not in ('HQ_STOCK', 'BRANCH_RESERVE', 'CONFIGURING', 'COMPLETE', 'FAULTY', 'LOST')
    union all
    select row_no, 'Branch_Code', 'Branch code "' || branch_id || '" does not exist.' from r where not exists (select 1 from public.branches b where b.id = r.branch_id)
    union all
    select row_no, 'Merchant_Name', 'Merchant name is required for ' || case stage when 'CONFIGURING' then 'Under Configuring' else 'Installed' end || '.'
      from r where stage in ('CONFIGURING', 'COMPLETE') and merchant = ''
    union all
    select row_no, 'MID', case when mid = '' then '15-digit MID is required for ' || case stage when 'CONFIGURING' then 'Under Configuring' else 'Installed' end || '.'
                               when mid !~ '^\d{15}$' then 'MID "' || mid || '" must be exactly 15 digits.'
                               else 'MID "' || mid || '" must start with ' || case when type = 'Sound Box' then '6 (Sound Box).' else '2 (POS Terminal).' end end
      from r where (stage in ('CONFIGURING', 'COMPLETE') or mid <> '')
       and (mid !~ '^\d{15}$' or (type = 'POS Terminal' and left(mid, 1) <> '2') or (type = 'Sound Box' and left(mid, 1) <> '6'))
    union all
    select row_no, 'TID', 'TID "' || tid || '" is not valid (4-16 letters or digits).' from r where tid <> '' and tid !~ '^[A-Za-z0-9_-]{4,16}$'
    union all
    select row_no, 'TID', 'TID "' || tid || '" is twice in the file (first at row ' || first_row || ').'
      from (select row_no, tid, min(row_no) over (partition by tid) first_row from r where tid <> '') x where row_no <> first_row
    union all
    select r.row_no, 'TID', 'TID "' || r.tid || '" is already used by ' || u.serial || ' (' || app.stock_stage_label(u.stage) || coalesce(', ' || nullif(u.merchant_name, ''), '') || ').'
      from r join tid_used u on u.tid = r.tid and u.serial <> r.serial
    union all
    select row_no, 'Battery_Serial', 'Battery serial "' || battery || '" is twice in the file (first at row ' || first_row || ').'
      from (select row_no, battery, min(row_no) over (partition by battery) first_row from rb) x where row_no <> first_row
    union all
    select rb.row_no, 'Battery_Serial', 'Battery serial "' || rb.battery || '" is already on unit ' || u.serial || '.'
      from rb join bat_used u on u.b = rb.battery and u.serial <> rb.serial
    union all
    select row_no, 'Stock_In_Date', 'Stock-in date "' || stock_in || '" must be a real date YYYY-MM-DD.' from r
     where stock_in <> '' and (stock_in !~ '^\d{4}-\d{2}-\d{2}$' or not pg_catalog.pg_input_is_valid(stock_in, 'date'))
  )
  select coalesce(jsonb_agg(jsonb_build_object('row', row_no, 'column', col, 'message', msg) order by row_no, col) filter (where rn <= 500), '[]'::jsonb), count(*)
    into v_err, v_err_n
    from (select e.*, row_number() over (order by row_no, col) rn from e) z;

  if v_err_n > 0 then
    return jsonb_build_object('ok', false, 'error_count', v_err_n, 'errors', v_err);   -- NOTHING saved
  end if;

  -- every row is right: save them all ----------------------------------------------------------------------------------
  insert into public.devices (serial, type, model, stage, branch_id, branch_name, stock_in_date, deployed_date, battery_installed_date,
    battery_serial, redeploy_count, staff, merchant_name, merchant_phone, location, address, mid, tid, note, history, archived,
    custom_fields, return_reason, deployment_status, stock_status, hours_in_stage, integrity_hash)
  select r.serial, x.type, x.model, x.stage, x.branch_id, b.name, coalesce(x.stock_in_date, (current_date)::text), x.deployed_date,
         x.battery_installed_date, nullif(btrim(coalesce(x.battery_serial, '')), ''), coalesce(x.redeploy_count, 0), x.staff, x.merchant_name, x.merchant_phone,
         x.location, x.address, nullif(r.mid, ''), x.tid, x.note, coalesce(x.history, '[]'::jsonb), false,
         coalesce(x.custom_fields, '{}'::jsonb), x.return_reason, x.deployment_status, x.stock_status, coalesce(x.hours_in_stage, 0), x.integrity_hash
    from _sb r cross join lateral jsonb_populate_record(null::public.devices, r.device) x
    join public.branches b on b.id = r.branch_id
   where r.op = 'create';
  get diagnostics v_created = row_count;

  update public.devices d set
    type = x.type, model = x.model, stage = x.stage, branch_id = x.branch_id, branch_name = b.name,
    stock_in_date = coalesce(x.stock_in_date, d.stock_in_date), deployed_date = x.deployed_date,
    battery_installed_date = x.battery_installed_date, battery_serial = nullif(btrim(coalesce(x.battery_serial, '')), ''), redeploy_count = coalesce(x.redeploy_count, 0),
    staff = x.staff, merchant_name = x.merchant_name, merchant_phone = x.merchant_phone, location = x.location, address = x.address,
    mid = nullif(r.mid, ''), tid = x.tid, note = x.note, history = coalesce(x.history, '[]'::jsonb),
    custom_fields = coalesce(x.custom_fields, '{}'::jsonb), return_reason = x.return_reason, deployment_status = x.deployment_status,
    stock_status = x.stock_status, hours_in_stage = coalesce(x.hours_in_stage, 0)          -- row_version untouched: the guard adds 1
  from _sb r cross join lateral jsonb_populate_record(null::public.devices, r.device) x
  join public.branches b on b.id = r.branch_id
  where r.op = 'move' and d.serial = r.serial and d.stage = 'HQ_STOCK' and d.row_version = r.row_version;
  get diagnostics v_moved = row_count;
  if v_moved <> (select count(*) from _sb where op = 'move') then
    raise exception 'Some units were changed by someone else while saving. Nothing was saved - please reload and upload again.' using errcode = '40001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('serial', d.serial, 'row_version', d.row_version)), '[]'::jsonb) into v_versions
    from public.devices d where d.serial in (select serial from _sb);

  insert into public.audit_logs (title, detail, branch_id, action, target, actor_id, actor_emp, actor_name, role, status)
  values ('Batch Stock Operation',
          concat_ws('; ', case when v_moved > 0 then 'Allocated ' || v_moved || ' unit(s) from HQ Stock to Branch Reserve' end,
                          case when v_created > 0 then 'Registered ' || v_created || ' new serial(s)' end)
            || ' - CSV upload of ' || v_n || ' row(s), every row checked on the server',
          coalesce(me.branch_id, '100'), 'BATCH_STOCK', v_batch::text, me.user_id, me.emp_id, me.name, me.role, 'Success');

  return jsonb_build_object('ok', true, 'created', v_created, 'moved', v_moved, 'versions', v_versions);
end $$;
revoke all on function public.stock_batch_commit(jsonb) from public, anon;
grant execute on function public.stock_batch_commit(jsonb) to authenticated;

notify pgrst, 'reload schema';
