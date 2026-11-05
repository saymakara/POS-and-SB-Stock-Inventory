-- 05 Nov 2026 · Merchant kit & materials, step 1 (portal). Applied: not yet (apply in the SQL Editor before merging).
--
-- What a merchant receives with a device, and the branch reserve of those materials:
--   SIM Card (by number, only when the merchant uses 4G), Battery (by serial, POS), POS AC Adaptor, POS Stand Holder,
--   Charging Dock (quantities, POS) and Sound Box AC Adaptor (quantity, Sound Box).
-- Same rules as devices: branch staff see only their own branch; every change goes through the checked functions
-- below (no table accepts a direct insert, update or delete); every change is kept in material_movements and the
-- Audit Trail.
--
--   material_types      the catalogue (6 materials)
--   material_serials    every SIM and battery: where it is (HQ, in transit, branch reserve, at a merchant, lost ...)
--   material_qty        quantity per location for adaptors, stands and docks ('100' = Head Office)
--   material_movements  every movement, with who, when and why
--   device_kits         what each installed device's merchant holds: connection (SIM / Wi-Fi) and items
--   material_lost       items reported Lost: Open -> Recovered or Written off; SIMs: Blocked with carrier
--   material_counts     the monthly branch count and the differences Admin HQ approves
--   requisitions        + materials (requested) and materials_sent (dispatched); dispatch and receipt move them

-- 1. Catalogue -------------------------------------------------------------------------------------------------------
create table if not exists public.material_types (
  code        text primary key,
  name        text not null,
  device_type text not null check (device_type in ('POS', 'SB', 'BOTH')),
  tracking    text not null check (tracking in ('SERIAL', 'QTY')),
  kit_rule    text not null check (kit_rule in ('DEFAULT', 'OPTIONAL', 'CONNECTION')),
  sort        int  not null default 0,
  active      boolean not null default true
);
insert into public.material_types (code, name, device_type, tracking, kit_rule, sort) values
  ('SIM',         'SIM Card',             'BOTH', 'SERIAL', 'CONNECTION', 1),
  ('BATTERY',     'Battery',              'POS',  'SERIAL', 'DEFAULT',    2),
  ('POS_ADAPTOR', 'POS AC Adaptor',       'POS',  'QTY',    'DEFAULT',    3),
  ('STAND',       'POS Stand Holder',     'POS',  'QTY',    'OPTIONAL',   4),
  ('DOCK',        'Charging Dock',        'POS',  'QTY',    'OPTIONAL',   5),
  ('SB_ADAPTOR',  'Sound Box AC Adaptor', 'SB',   'QTY',    'DEFAULT',    6)
on conflict (code) do nothing;

-- 2. Tables ----------------------------------------------------------------------------------------------------------
create table if not exists public.material_serials (
  material_code text not null references public.material_types (code),
  serial        text not null,
  status        text not null check (status in ('HQ_STOCK', 'IN_TRANSIT', 'BRANCH_RESERVE', 'AT_MERCHANT', 'LOST', 'FAULTY', 'WRITTEN_OFF')),
  branch_id     varchar not null,                       -- where it is or was last ('100' = Head Office)
  device_serial varchar,                                -- the device it serves (AT_MERCHANT)
  mid           varchar,
  merchant_name text,
  req_id        text,                                   -- the request it travels with (IN_TRANSIT)
  blocked_with_carrier boolean not null default false,  -- SIM: the carrier has blocked it
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text,
  primary key (material_code, serial)
);
create index if not exists material_serials_branch_status on public.material_serials (branch_id, status);
create index if not exists material_serials_device on public.material_serials (device_serial) where device_serial is not null;
create index if not exists material_serials_mid on public.material_serials (mid) where mid is not null;

create table if not exists public.material_qty (
  material_code text not null references public.material_types (code),
  branch_id     varchar not null,
  qty           int not null default 0 check (qty >= 0),
  updated_at    timestamptz not null default now(),
  primary key (material_code, branch_id)
);

create table if not exists public.material_movements (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  kind          text not null,      -- STOCK_IN, OPENING, ADJUST, DISPATCH, RECEIVE, KIT_ADD, KIT_BASELINE, KIT_RETURN, LOST, FAULTY, RECOVER, WRITE_OFF, COUNT_ADJUST
  material_code text not null,
  serial        text,
  qty           int not null default 1,
  from_branch   varchar,
  to_branch     varchar,
  branch_id     varchar,            -- the branch it concerns (who may read it)
  ref           text,               -- request id, count id, lost id ...
  device_serial varchar,
  mid           varchar,
  note          text,
  actor         text
);
create index if not exists material_movements_branch_at on public.material_movements (branch_id, at desc);
create index if not exists material_movements_serial on public.material_movements (material_code, serial) where serial is not null;
create index if not exists material_movements_device on public.material_movements (device_serial) where device_serial is not null;

create table if not exists public.device_kits (
  device_serial varchar primary key,
  connection    text check (connection in ('SIM', 'WIFI')),
  items         jsonb not null default '[]'::jsonb,    -- [{code, qty, serial, given_at, given_by, note}]
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create table if not exists public.material_lost (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  material_code text not null references public.material_types (code),
  serial        text,
  qty           int not null default 1 check (qty > 0),
  branch_id     varchar not null,
  device_serial varchar,
  mid           varchar,
  merchant_name text,
  source        text,               -- Return / Replacement / Monthly count / Reported
  remark        text,
  reported_by   text,
  status        text not null default 'OPEN' check (status in ('OPEN', 'RECOVERED', 'WRITTEN_OFF')),
  blocked_with_carrier boolean not null default false,
  resolution    text,
  resolved_by   text,
  resolved_at   timestamptz
);
create index if not exists material_lost_branch_status on public.material_lost (branch_id, status);

create table if not exists public.material_counts (
  id            bigint generated always as identity primary key,
  branch_id     varchar not null,
  month         text not null check (month ~ '^\d{4}-\d{2}$'),
  lines         jsonb not null,     -- [{code, system, counted, diff, missing[], extra[], remark}]
  differences   int not null default 0,
  status        text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  submitted_by  text,
  submitted_at  timestamptz not null default now(),
  reviewed_by   text,
  reviewed_at   timestamptz,
  review_note   text
);
create unique index if not exists material_counts_one_per_month on public.material_counts (branch_id, month) where status in ('PENDING', 'APPROVED');

alter table public.requisitions add column if not exists materials jsonb not null default '{}'::jsonb;        -- {CODE: qty requested}
alter table public.requisitions add column if not exists materials_sent jsonb not null default '{}'::jsonb;   -- {qty:{CODE:n}, serials:{CODE:[...]}, received:bool}

-- 3. Who may read (writes only through the functions) ----------------------------------------------------------------
alter table public.material_types enable row level security;
alter table public.material_serials enable row level security;
alter table public.material_qty enable row level security;
alter table public.material_movements enable row level security;
alter table public.device_kits enable row level security;
alter table public.material_lost enable row level security;
alter table public.material_counts enable row level security;

drop policy if exists material_types_read on public.material_types;
create policy material_types_read on public.material_types for select using ((select app.role()) is not null);
drop policy if exists material_serials_read on public.material_serials;
create policy material_serials_read on public.material_serials for select using ((select app.is_admin()) or branch_id::text = (select app.branch()));
drop policy if exists material_qty_read on public.material_qty;
create policy material_qty_read on public.material_qty for select using ((select app.is_admin()) or branch_id::text = (select app.branch()));
drop policy if exists material_movements_read on public.material_movements;
create policy material_movements_read on public.material_movements for select
  using ((select app.is_admin()) or branch_id::text = (select app.branch()) or to_branch::text = (select app.branch()) or from_branch::text = (select app.branch()));
drop policy if exists device_kits_read on public.device_kits;
create policy device_kits_read on public.device_kits for select
  using ((select app.is_admin()) or exists (select 1 from public.devices d where d.serial = device_kits.device_serial and d.branch_id::text = (select app.branch())));
drop policy if exists material_lost_read on public.material_lost;
create policy material_lost_read on public.material_lost for select using ((select app.is_admin()) or branch_id::text = (select app.branch()));
drop policy if exists material_counts_read on public.material_counts;
create policy material_counts_read on public.material_counts for select using ((select app.is_admin()) or branch_id::text = (select app.branch()));

revoke all on public.material_types, public.material_serials, public.material_qty, public.material_movements,
              public.device_kits, public.material_lost, public.material_counts from anon, authenticated;
grant select on public.material_types, public.material_serials, public.material_qty, public.material_movements,
               public.device_kits, public.material_lost, public.material_counts to authenticated;

-- Stock on hand per location, one row per material and place: quantities, plus SIMs / batteries counted by number
-- (in transit shown apart). Reads with the caller's rights, so branch staff see only their own branch.
create or replace view public.material_balances with (security_invoker = true) as
  select q.material_code, q.branch_id, q.qty as on_hand, 0 as in_transit, 0 as at_merchant from public.material_qty q
  union all
  select s.material_code, s.branch_id,
         count(*) filter (where s.status in ('HQ_STOCK', 'BRANCH_RESERVE'))::int,
         count(*) filter (where s.status = 'IN_TRANSIT')::int,
         count(*) filter (where s.status = 'AT_MERCHANT')::int
    from public.material_serials s group by s.material_code, s.branch_id;
revoke all on public.material_balances from anon;
grant select on public.material_balances to authenticated;

-- 4. Helpers ---------------------------------------------------------------------------------------------------------
-- A SIM number in one standard form: "096 555 0142", "012 345 678". +855 / 855 become 0. Null when it is not a number.
create or replace function app.norm_sim(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d like '855%' and length(d) >= 11 then d := '0' || substr(d, 4); end if;
  if d !~ '^0\d{8,9}$' then return null; end if;
  return substr(d, 1, 3) || ' ' || substr(d, 4, 3) || ' ' || substr(d, 7);
end $$;

create or replace function app.mat_serial(p_code text, p text) returns text
language sql immutable set search_path = '' as $$
  select case when p_code = 'SIM' then app.norm_sim(p) else nullif(upper(regexp_replace(btrim(coalesce(p, '')), '\s+', '', 'g')), '') end
$$;

create or replace function app.mat_type(p_code text) returns public.material_types
language plpgsql stable security definer set search_path = '' as $$
declare t public.material_types;
begin
  select * into t from public.material_types where code = upper(btrim(coalesce(p_code, ''))) and active;
  if not found then raise exception 'INPUT: unknown material "%".', p_code using errcode = '22023'; end if;
  return t;
end $$;

create or replace function app.mat_branch(p text) returns varchar
language plpgsql stable security definer set search_path = '' as $$
declare v varchar;
begin
  if btrim(coalesce(p, '')) in ('100', 'HQ', 'Head Office') then return '100'; end if;
  v := app.resolve_branch(p);
  if v is null then raise exception 'INPUT: branch "%" is not in the portal.', p using errcode = '22023'; end if;
  return v;
end $$;

create or replace function app.mat_log(p_kind text, p_code text, p_serial text, p_qty int, p_from varchar, p_to varchar,
                                       p_branch varchar, p_ref text, p_device varchar, p_mid varchar, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into public.material_movements (kind, material_code, serial, qty, from_branch, to_branch, branch_id, ref, device_serial, mid, note, actor)
  values (p_kind, p_code, p_serial, coalesce(p_qty, 1), p_from, p_to, p_branch, p_ref, p_device, p_mid, left(p_note, 500), coalesce(app.label(), 'System'))
$$;

-- Adds (or with a negative delta takes) a quantity at a location. Refuses to go below zero.
create or replace function app.mat_qty_move(p_code text, p_branch varchar, p_delta int) returns int
language plpgsql security definer set search_path = '' as $$
declare v int; t public.material_types := app.mat_type(p_code);
begin
  if p_delta = 0 then select qty into v from public.material_qty where material_code = t.code and branch_id = p_branch; return coalesce(v, 0); end if;
  if p_delta < 0 then
    update public.material_qty set qty = qty + p_delta, updated_at = now()
     where material_code = t.code and branch_id = p_branch and qty >= -p_delta returning qty into v;
    if not found then
      select qty into v from public.material_qty where material_code = t.code and branch_id = p_branch;
      raise exception 'STOCK: not enough % at %: % in stock, % needed.', t.name,
        case when p_branch = '100' then 'Head Office' else 'Branch Code ' || p_branch end, coalesce(v, 0), -p_delta using errcode = '22023';
    end if;
    return v;
  end if;
  insert into public.material_qty (material_code, branch_id, qty) values (t.code, p_branch, p_delta)
  on conflict (material_code, branch_id) do update set qty = public.material_qty.qty + excluded.qty, updated_at = now()
  returning qty into v;
  return v;
end $$;

create or replace function app.mat_where(p_branch varchar) returns text
language sql immutable set search_path = '' as $$
  select case when p_branch = '100' then 'Head Office' else 'Branch Code ' || p_branch end
$$;

create or replace function app.mat_audit(p_title text, p_detail text, p_branch varchar, p_action text, p_target text) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (title, detail, branch_id, action, target, status)
  values (p_title, left(p_detail, 2000), p_branch, p_action, p_target, 'Success')
$$;

-- The kit of a device (created empty the first time).
create or replace function app.kit_row(p_device varchar) returns public.device_kits
language plpgsql security definer set search_path = '' as $$
declare k public.device_kits;
begin
  insert into public.device_kits (device_serial) values (p_device) on conflict (device_serial) do nothing;
  select * into k from public.device_kits where device_serial = p_device for update;
  return k;
end $$;

-- Gives one item of the kit to the merchant of p_device. p_from_stock: taken from the device's branch reserve
-- (a new installation, an add-on, a replacement). Otherwise a record of what the merchant already holds (baseline).
create or replace function app.kit_add(p_device varchar, p_code text, p_qty int, p_serial text, p_from_stock boolean, p_note text, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.material_types := app.mat_type(p_code);
  d public.devices; k public.device_kits; s public.material_serials;
  v_serial text; v_qty int := greatest(coalesce(p_qty, 1), 1); v_items jsonb; v_found boolean := false; v_dt text;
begin
  select * into d from public.devices where serial = p_device for update;
  if not found then raise exception 'INPUT: unit % is not in the inventory.', p_device using errcode = '22023'; end if;
  v_dt := case when d.type = 'Sound Box' then 'SB' else 'POS' end;
  if t.device_type not in ('BOTH', v_dt) then
    raise exception 'INPUT: % does not go with a %.', t.name, d.type using errcode = '22023';
  end if;
  k := app.kit_row(d.serial);
  if t.tracking = 'SERIAL' then
    v_serial := app.mat_serial(t.code, p_serial);
    if v_serial is null then
      raise exception 'INPUT: "%" is not a valid % number.', coalesce(p_serial, ''), t.name using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(k.items) x where x->>'code' = t.code) then
      raise exception 'KIT: unit % already has a %; return or replace it first.', d.serial, t.name using errcode = '22023';
    end if;
    select * into s from public.material_serials where material_code = t.code and serial = v_serial for update;
    if p_from_stock then
      if not found or s.status <> 'BRANCH_RESERVE' or s.branch_id is distinct from d.branch_id then
        raise exception 'STOCK: % % is not in the reserve of % %.', t.name, v_serial, app.mat_where(d.branch_id),
          case when found then '(it is ' || lower(replace(s.status, '_', ' ')) || ' at ' || app.mat_where(s.branch_id) || ')' else '(not registered)' end using errcode = '22023';
      end if;
    elsif found then
      if s.status = 'AT_MERCHANT' and s.device_serial = d.serial then
        null;   -- already recorded on this unit
      elsif s.status = 'AT_MERCHANT' then
        raise exception 'KIT: % % is already at another merchant (unit %).', t.name, v_serial, s.device_serial using errcode = '22023';
      else
        raise exception 'KIT: % % is % at %; choose "Take from branch stock" instead.', t.name, v_serial,
          lower(replace(s.status, '_', ' ')), app.mat_where(s.branch_id) using errcode = '22023';
      end if;
    end if;
    insert into public.material_serials (material_code, serial, status, branch_id, device_serial, mid, merchant_name, updated_by)
    values (t.code, v_serial, 'AT_MERCHANT', d.branch_id, d.serial, d.mid, d.merchant_name, app.label())
    on conflict (material_code, serial) do update
      set status = 'AT_MERCHANT', branch_id = excluded.branch_id, device_serial = excluded.device_serial, mid = excluded.mid,
          merchant_name = excluded.merchant_name, req_id = null, updated_at = now(), updated_by = excluded.updated_by;
    v_items := k.items || jsonb_build_object('code', t.code, 'qty', 1, 'serial', v_serial, 'given_at', now(), 'given_by', app.label(), 'note', nullif(btrim(coalesce(p_note, '')), ''));
    if t.code = 'SIM' then update public.device_kits set connection = 'SIM' where device_serial = d.serial; end if;
  else
    if p_from_stock then perform app.mat_qty_move(t.code, d.branch_id, -v_qty); end if;
    select coalesce(jsonb_agg(case when x->>'code' = t.code
                                   then x || jsonb_build_object('qty', (x->>'qty')::int + v_qty, 'given_at', now(), 'given_by', app.label())
                                   else x end), '[]'::jsonb),
           bool_or(x->>'code' = t.code)
      into v_items, v_found from jsonb_array_elements(k.items) x;
    if not coalesce(v_found, false) then
      v_items := v_items || jsonb_build_object('code', t.code, 'qty', v_qty, 'given_at', now(), 'given_by', app.label(), 'note', nullif(btrim(coalesce(p_note, '')), ''));
    end if;
  end if;
  update public.device_kits set items = v_items, updated_at = now(), updated_by = app.label() where device_serial = d.serial;
  perform app.mat_log(case when p_from_stock then 'KIT_ADD' else 'KIT_BASELINE' end, t.code, v_serial, case when t.tracking = 'SERIAL' then 1 else v_qty end,
                      case when p_from_stock then d.branch_id end, null, d.branch_id, p_ref, d.serial, d.mid, p_note);
  return jsonb_build_object('code', t.code, 'serial', v_serial, 'qty', case when t.tracking = 'SERIAL' then 1 else v_qty end);
end $$;

-- Takes one item out of a device's kit: RETURNED (back to the device's branch reserve), LOST (Lost list, Open) or
-- FAULTY (sent to Head Office, out of stock).
create or replace function app.kit_remove(p_device varchar, p_code text, p_qty int, p_serial text, p_result text, p_remark text, p_source text, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.material_types := app.mat_type(p_code);
  d public.devices; k public.device_kits;
  v_serial text; v_qty int := greatest(coalesce(p_qty, 1), 1); v_have int; v_items jsonb; v_res text := upper(btrim(coalesce(p_result, '')));
  v_lost bigint;
begin
  if v_res not in ('RETURNED', 'LOST', 'FAULTY') then raise exception 'INPUT: result must be Returned, Lost or Faulty.' using errcode = '22023'; end if;
  if v_res = 'LOST' and char_length(btrim(coalesce(p_remark, ''))) < 3 then
    raise exception 'INPUT: write a remark for the lost %.', t.name using errcode = '22023';
  end if;
  select * into d from public.devices where serial = p_device for update;
  if not found then raise exception 'INPUT: unit % is not in the inventory.', p_device using errcode = '22023'; end if;
  select * into k from public.device_kits where device_serial = d.serial for update;
  if not found then raise exception 'KIT: unit % has no kit recorded.', d.serial using errcode = '22023'; end if;
  if t.tracking = 'SERIAL' then
    v_serial := app.mat_serial(t.code, p_serial);
    if v_serial is null then   -- the one in the kit
      select x->>'serial' into v_serial from jsonb_array_elements(k.items) x where x->>'code' = t.code limit 1;
    end if;
    if not exists (select 1 from jsonb_array_elements(k.items) x where x->>'code' = t.code and x->>'serial' = v_serial) then
      raise exception 'KIT: % % is not in the kit of unit %.', t.name, coalesce(v_serial, ''), d.serial using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_items from jsonb_array_elements(k.items) x where not (x->>'code' = t.code and x->>'serial' = v_serial);
    update public.material_serials
       set status = case v_res when 'RETURNED' then 'BRANCH_RESERVE' when 'LOST' then 'LOST' else 'FAULTY' end,
           branch_id = case when v_res = 'FAULTY' then '100' else d.branch_id end,
           device_serial = case when v_res = 'LOST' then device_serial end,
           mid = case when v_res = 'LOST' then mid end,
           merchant_name = case when v_res = 'LOST' then merchant_name end,
           updated_at = now(), updated_by = app.label()
     where material_code = t.code and serial = v_serial;
    v_qty := 1;
  else
    select coalesce(sum((x->>'qty')::int), 0) into v_have from jsonb_array_elements(k.items) x where x->>'code' = t.code;
    if v_have < v_qty then
      raise exception 'KIT: the merchant of unit % holds % % (not %).', d.serial, v_have, t.name, v_qty using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(case when x->>'code' = t.code then x || jsonb_build_object('qty', (x->>'qty')::int - v_qty) else x end)
                    filter (where not (x->>'code' = t.code and (x->>'qty')::int - v_qty <= 0)), '[]'::jsonb)
      into v_items from jsonb_array_elements(k.items) x;
    if v_res = 'RETURNED' then perform app.mat_qty_move(t.code, d.branch_id, v_qty); end if;
  end if;
  update public.device_kits set items = v_items,
         connection = case when t.code = 'SIM' then null else connection end,
         updated_at = now(), updated_by = app.label()
   where device_serial = d.serial;
  if v_res = 'LOST' then
    insert into public.material_lost (material_code, serial, qty, branch_id, device_serial, mid, merchant_name, source, remark, reported_by)
    values (t.code, v_serial, v_qty, d.branch_id, d.serial, d.mid, d.merchant_name, coalesce(p_source, 'Return'), left(btrim(p_remark), 500), app.label())
    returning id into v_lost;
  end if;
  perform app.mat_log(case v_res when 'RETURNED' then 'KIT_RETURN' when 'LOST' then 'LOST' else 'FAULTY' end, t.code, v_serial, v_qty, d.branch_id,
                      case v_res when 'RETURNED' then d.branch_id when 'FAULTY' then '100' end, d.branch_id, coalesce(p_ref, v_lost::text), d.serial, d.mid, p_remark);
  return jsonb_build_object('code', t.code, 'serial', v_serial, 'qty', v_qty, 'result', v_res, 'lost_id', v_lost);
end $$;

-- 5. Admin HQ functions ----------------------------------------------------------------------------------------------
-- Stock in: new materials arrive. {code, branch_id ('100' default), qty | serials[], note}
create or replace function public.admin_material_stock_in(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.material_types := app.mat_type(p->>'code');
  v_branch varchar := app.mat_branch(coalesce(nullif(p->>'branch_id', ''), '100'));
  v_qty int; x text; v_s text; v_added int := 0; v_ref jsonb := '[]'::jsonb; v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can add stock.' using errcode = '42501'; end if;
  if t.tracking = 'QTY' then
    v_qty := coalesce((p->>'qty')::int, 0);
    if v_qty <= 0 or v_qty > 100000 then raise exception 'INPUT: enter a quantity between 1 and 100,000.' using errcode = '22023'; end if;
    perform app.mat_qty_move(t.code, v_branch, v_qty);
    perform app.mat_log('STOCK_IN', t.code, null, v_qty, null, v_branch, v_branch, null, null, null, v_note);
    v_added := v_qty;
  else
    if jsonb_typeof(p->'serials') <> 'array' or jsonb_array_length(p->'serials') = 0 then
      raise exception 'INPUT: list at least one % number.', t.name using errcode = '22023';
    end if;
    if jsonb_array_length(p->'serials') > 5000 then raise exception 'INPUT: at most 5,000 numbers at a time.' using errcode = '22023'; end if;
    for x in select jsonb_array_elements_text(p->'serials') loop
      v_s := app.mat_serial(t.code, x);
      if v_s is null then v_ref := v_ref || jsonb_build_object('serial', x, 'why', 'not a valid number'); continue; end if;
      if exists (select 1 from public.material_serials where material_code = t.code and serial = v_s) then
        v_ref := v_ref || jsonb_build_object('serial', v_s, 'why', 'already registered'); continue;
      end if;
      insert into public.material_serials (material_code, serial, status, branch_id, note, updated_by)
      values (t.code, v_s, case when v_branch = '100' then 'HQ_STOCK' else 'BRANCH_RESERVE' end, v_branch, v_note, app.label());
      perform app.mat_log('STOCK_IN', t.code, v_s, 1, null, v_branch, v_branch, null, null, null, v_note);
      v_added := v_added + 1;
    end loop;
  end if;
  if v_added > 0 then
    perform app.mat_audit('Materials Stock In', t.name || ': ' || v_added || ' added at ' || app.mat_where(v_branch) || coalesce(' · ' || v_note, ''),
                          v_branch, 'MATERIAL_STOCK_IN', t.code);
  end if;
  return jsonb_build_object('added', v_added, 'refused', v_ref);
end $$;

-- Opening stock (once, from the branches' current counts). Quantities are SET to the given figure (the difference is
-- recorded); SIMs and batteries are registered where they are. {qty:[{branch, code, qty}], serials:[{branch, code, serial}]}
create or replace function public.admin_material_opening(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; t public.material_types; v_branch varchar; v_new int; v_old int; v_s text;
  v_q int := 0; v_n int := 0; v_ref jsonb := '[]'::jsonb;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can load the opening stock.' using errcode = '42501'; end if;
  if coalesce(jsonb_array_length(case when jsonb_typeof(p->'qty') = 'array' then p->'qty' end), 0)
     + coalesce(jsonb_array_length(case when jsonb_typeof(p->'serials') = 'array' then p->'serials' end), 0) = 0 then
    raise exception 'INPUT: the file has no rows.' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p->'qty') = 'array' then p->'qty' else '[]'::jsonb end) loop
    begin
      t := app.mat_type(r->>'code');
      if t.tracking <> 'QTY' then raise exception 'INPUT: % is counted by number, not by quantity.', t.name; end if;
      v_branch := app.mat_branch(r->>'branch');
      v_new := (r->>'qty')::int;
      if v_new is null or v_new < 0 or v_new > 100000 then raise exception 'INPUT: quantity must be 0 to 100,000.'; end if;
      select qty into v_old from public.material_qty where material_code = t.code and branch_id = v_branch;
      insert into public.material_qty (material_code, branch_id, qty) values (t.code, v_branch, v_new)
      on conflict (material_code, branch_id) do update set qty = excluded.qty, updated_at = now();
      if coalesce(v_old, 0) <> v_new then
        perform app.mat_log('OPENING', t.code, null, v_new - coalesce(v_old, 0), null, v_branch, v_branch, null, null, null,
                            'Opening stock: ' || coalesce(v_old, 0) || ' -> ' || v_new);
      end if;
      v_q := v_q + 1;
    exception when others then
      v_ref := v_ref || jsonb_build_object('row', r, 'why', regexp_replace(sqlerrm, '^[A-Z]+: ', ''));
    end;
  end loop;
  for r in select * from jsonb_array_elements(case when jsonb_typeof(p->'serials') = 'array' then p->'serials' else '[]'::jsonb end) loop
    begin
      t := app.mat_type(r->>'code');
      if t.tracking <> 'SERIAL' then raise exception 'INPUT: % is counted by quantity.', t.name; end if;
      v_branch := app.mat_branch(r->>'branch');
      v_s := app.mat_serial(t.code, r->>'serial');
      if v_s is null then raise exception 'INPUT: "%" is not a valid number.', r->>'serial'; end if;
      if exists (select 1 from public.material_serials where material_code = t.code and serial = v_s) then
        raise exception 'INPUT: % is already registered.', v_s;
      end if;
      insert into public.material_serials (material_code, serial, status, branch_id, note, updated_by)
      values (t.code, v_s, case when v_branch = '100' then 'HQ_STOCK' else 'BRANCH_RESERVE' end, v_branch, 'Opening stock', app.label());
      perform app.mat_log('OPENING', t.code, v_s, 1, null, v_branch, v_branch, null, null, null, 'Opening stock');
      v_n := v_n + 1;
    exception when others then
      v_ref := v_ref || jsonb_build_object('row', r, 'why', regexp_replace(sqlerrm, '^[A-Z]+: ', ''));
    end;
  end loop;
  perform app.mat_audit('Materials Opening Stock', v_q || ' quantity line(s) and ' || v_n || ' SIM / battery number(s) loaded'
                        || case when jsonb_array_length(v_ref) > 0 then '; ' || jsonb_array_length(v_ref) || ' row(s) refused' else '' end,
                        '100', 'MATERIAL_OPENING', null);
  return jsonb_build_object('qty_lines', v_q, 'serials', v_n, 'refused', v_ref);
end $$;

-- Correct a figure, with a reason. Quantity: {code, branch_id, qty (the correct figure), reason}.
-- SIM / battery: {code, serial, status, branch_id, reason} (for example a SIM found again, or moved between locations).
create or replace function public.admin_material_adjust(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.material_types := app.mat_type(p->>'code');
  v_reason text := btrim(coalesce(p->>'reason', '')); v_branch varchar; v_new int; v_old int; v_s text; s public.material_serials; v_status text;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can correct stock.' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'INPUT: write the reason for the correction.' using errcode = '22023'; end if;
  v_branch := app.mat_branch(p->>'branch_id');
  if t.tracking = 'QTY' then
    v_new := (p->>'qty')::int;
    if v_new is null or v_new < 0 or v_new > 100000 then raise exception 'INPUT: quantity must be 0 to 100,000.' using errcode = '22023'; end if;
    select qty into v_old from public.material_qty where material_code = t.code and branch_id = v_branch;
    insert into public.material_qty (material_code, branch_id, qty) values (t.code, v_branch, v_new)
    on conflict (material_code, branch_id) do update set qty = excluded.qty, updated_at = now();
    perform app.mat_log('ADJUST', t.code, null, v_new - coalesce(v_old, 0), null, v_branch, v_branch, null, null, null, v_reason);
    perform app.mat_audit('Materials Corrected', t.name || ' at ' || app.mat_where(v_branch) || ': ' || coalesce(v_old, 0) || ' -> ' || v_new || ' · ' || v_reason,
                          v_branch, 'MATERIAL_ADJUST', t.code);
    return jsonb_build_object('qty', v_new, 'was', coalesce(v_old, 0));
  end if;
  v_s := app.mat_serial(t.code, p->>'serial');
  v_status := upper(btrim(coalesce(p->>'status', '')));
  if v_s is null then raise exception 'INPUT: "%" is not a valid number.', p->>'serial' using errcode = '22023'; end if;
  if v_status not in ('HQ_STOCK', 'BRANCH_RESERVE', 'FAULTY', 'WRITTEN_OFF') then
    raise exception 'INPUT: a correction can set HQ stock, branch reserve, faulty or written off; use the kit for merchants.' using errcode = '22023';
  end if;
  if v_status = 'HQ_STOCK' then v_branch := '100'; end if;
  select * into s from public.material_serials where material_code = t.code and serial = v_s for update;
  if found and s.status = 'AT_MERCHANT' then
    raise exception 'INPUT: % % is at a merchant (unit %); return it from the kit.', t.name, v_s, s.device_serial using errcode = '22023';
  end if;
  insert into public.material_serials (material_code, serial, status, branch_id, updated_by)
  values (t.code, v_s, v_status, v_branch, app.label())
  on conflict (material_code, serial) do update set status = excluded.status, branch_id = excluded.branch_id, device_serial = null, mid = null,
    merchant_name = null, req_id = null, updated_at = now(), updated_by = excluded.updated_by;
  perform app.mat_log('ADJUST', t.code, v_s, 1, case when found then s.branch_id end, v_branch, v_branch, null, null, null,
                      coalesce(lower(replace(s.status, '_', ' ')), 'new') || ' -> ' || lower(replace(v_status, '_', ' ')) || ' · ' || v_reason);
  perform app.mat_audit('Materials Corrected', t.name || ' ' || v_s || ': ' || coalesce(lower(replace(s.status, '_', ' ')), 'new') || ' -> '
                        || lower(replace(v_status, '_', ' ')) || ' at ' || app.mat_where(v_branch) || ' · ' || v_reason, v_branch, 'MATERIAL_ADJUST', v_s);
  return jsonb_build_object('serial', v_s, 'status', v_status);
end $$;

-- Lost items: RECOVER (found: back to the branch reserve), WRITE_OFF (reason), BLOCKED (SIM blocked with the carrier).
create or replace function public.admin_material_lost_action(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.material_lost; v_act text := upper(btrim(coalesce(p->>'action', ''))); v_reason text := btrim(coalesce(p->>'reason', ''));
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can close a lost item.' using errcode = '42501'; end if;
  select * into l from public.material_lost where id = (p->>'id')::bigint for update;
  if not found then raise exception 'INPUT: lost item not found.' using errcode = '22023'; end if;
  if v_act = 'BLOCKED' then
    if l.material_code <> 'SIM' then raise exception 'INPUT: only a SIM can be blocked with the carrier.' using errcode = '22023'; end if;
    update public.material_lost set blocked_with_carrier = true where id = l.id;
    update public.material_serials set blocked_with_carrier = true, updated_at = now(), updated_by = app.label()
     where material_code = 'SIM' and serial = l.serial;
    perform app.mat_audit('SIM Blocked with Carrier', 'SIM ' || l.serial || ' (lost, ' || app.mat_where(l.branch_id) || ')', l.branch_id, 'MATERIAL_SIM_BLOCKED', l.serial);
    return jsonb_build_object('blocked', true);
  end if;
  if l.status <> 'OPEN' then raise exception 'INPUT: this lost item is already %.', lower(replace(l.status, '_', ' ')) using errcode = '22023'; end if;
  if v_act = 'RECOVER' then
    if l.serial is not null then
      update public.material_serials set status = 'BRANCH_RESERVE', branch_id = l.branch_id, device_serial = null, mid = null, merchant_name = null,
             updated_at = now(), updated_by = app.label()
       where material_code = l.material_code and serial = l.serial;
    else
      perform app.mat_qty_move(l.material_code, l.branch_id, l.qty);
    end if;
    update public.material_lost set status = 'RECOVERED', resolution = nullif(v_reason, ''), resolved_by = app.label(), resolved_at = now() where id = l.id;
    perform app.mat_log('RECOVER', l.material_code, l.serial, l.qty, null, l.branch_id, l.branch_id, l.id::text, l.device_serial, l.mid, v_reason);
  elsif v_act = 'WRITE_OFF' then
    if char_length(v_reason) < 3 then raise exception 'INPUT: write the reason for the write-off.' using errcode = '22023'; end if;
    if l.serial is not null then
      update public.material_serials set status = 'WRITTEN_OFF', updated_at = now(), updated_by = app.label()
       where material_code = l.material_code and serial = l.serial;
    end if;
    update public.material_lost set status = 'WRITTEN_OFF', resolution = v_reason, resolved_by = app.label(), resolved_at = now() where id = l.id;
    perform app.mat_log('WRITE_OFF', l.material_code, l.serial, l.qty, l.branch_id, null, l.branch_id, l.id::text, l.device_serial, l.mid, v_reason);
  else
    raise exception 'INPUT: action must be Recover, Write off or Blocked.' using errcode = '22023';
  end if;
  perform app.mat_audit(case v_act when 'RECOVER' then 'Lost Material Recovered' else 'Lost Material Written Off' end,
                        (select name from public.material_types where code = l.material_code) || coalesce(' ' || l.serial, ' × ' || l.qty)
                        || ' · ' || app.mat_where(l.branch_id) || coalesce(' · ' || nullif(v_reason, ''), ''), l.branch_id,
                        case v_act when 'RECOVER' then 'MATERIAL_RECOVER' else 'MATERIAL_WRITE_OFF' end, l.id::text);
  return jsonb_build_object('status', case v_act when 'RECOVER' then 'RECOVERED' else 'WRITTEN_OFF' end);
end $$;

-- Kits ---------------------------------------------------------------------------------------------------------------
-- Add items to a merchant's kit. {device_serial, connection?, from_stock (default true), items:[{code, qty, serial, note}]}
-- from_stock false = record what the merchant already holds (existing merchants, no stock movement).
create or replace function public.admin_kit_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_dev varchar := btrim(coalesce(p->>'device_serial', '')); it jsonb; v_out jsonb := '[]'::jsonb;
        v_stock boolean := coalesce((p->>'from_stock')::boolean, true); v_conn text := upper(nullif(btrim(coalesce(p->>'connection', '')), ''));
        k public.device_kits; d public.devices;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can change a merchant kit in the portal.' using errcode = '42501'; end if;
  select * into d from public.devices where serial = v_dev;
  if not found then raise exception 'INPUT: unit % is not in the inventory.', v_dev using errcode = '22023'; end if;
  if v_conn is not null and v_conn not in ('SIM', 'WIFI') then raise exception 'INPUT: connection must be SIM or Wi-Fi.' using errcode = '22023'; end if;
  if v_conn = 'WIFI' and exists (select 1 from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) x where upper(x->>'code') = 'SIM') then
    raise exception 'INPUT: a Wi-Fi merchant gets no SIM card.' using errcode = '22023';
  end if;
  k := app.kit_row(v_dev);
  if v_conn = 'WIFI' and exists (select 1 from jsonb_array_elements(k.items) x where x->>'code' = 'SIM') then
    raise exception 'KIT: return the SIM card first, then set the connection to Wi-Fi.' using errcode = '22023';
  end if;
  if v_conn is not null then update public.device_kits set connection = v_conn, updated_at = now(), updated_by = app.label() where device_serial = v_dev; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    v_out := v_out || app.kit_add(v_dev, it->>'code', (it->>'qty')::int, it->>'serial', v_stock, it->>'note', null);
  end loop;
  perform app.mat_audit(case when v_stock then 'Merchant Kit Issued' else 'Merchant Kit Recorded' end,
                        'Unit ' || v_dev || coalesce(' · ' || d.merchant_name, '') || coalesce(' (MID ' || d.mid || ')', '')
                        || coalesce(' · connection ' || v_conn, '') || ' · ' || jsonb_array_length(v_out) || ' item(s)'
                        || case when v_stock then ' from branch stock' else ' already at the merchant' end, d.branch_id, 'MATERIAL_KIT_ADD', v_dev);
  return jsonb_build_object('added', v_out);
end $$;

-- Take items back from a merchant's kit. {device_serial, items:[{code, qty, serial, result: RETURNED|LOST|FAULTY, remark}]}
create or replace function public.admin_kit_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_dev varchar := btrim(coalesce(p->>'device_serial', '')); it jsonb; v_out jsonb := '[]'::jsonb; d public.devices;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can change a merchant kit in the portal.' using errcode = '42501'; end if;
  select * into d from public.devices where serial = v_dev;
  if not found then raise exception 'INPUT: unit % is not in the inventory.', v_dev using errcode = '22023'; end if;
  if coalesce(jsonb_array_length(case when jsonb_typeof(p->'items') = 'array' then p->'items' end), 0) = 0 then
    raise exception 'INPUT: choose at least one item.' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_out := v_out || app.kit_remove(v_dev, it->>'code', (it->>'qty')::int, it->>'serial', it->>'result', it->>'remark', 'Return', null);
  end loop;
  perform app.mat_audit('Merchant Kit Returned', 'Unit ' || v_dev || coalesce(' · ' || d.merchant_name, '') || ' · '
                        || (select string_agg(initcap(x->>'result') || ' ' || (x->>'code') || coalesce(' ' || (x->>'serial'), ''), ', ') from jsonb_array_elements(v_out) x),
                        d.branch_id, 'MATERIAL_KIT_RETURN', v_dev);
  return jsonb_build_object('items', v_out);
end $$;

-- Replace one item: the old one is RETURNED / FAULTY / LOST, the new one comes from the branch reserve.
-- {device_serial, code, old_serial, old_result, remark, new_serial, qty}
create or replace function public.admin_kit_replace(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_dev varchar := btrim(coalesce(p->>'device_serial', '')); v_old jsonb; v_new jsonb; d public.devices;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can change a merchant kit in the portal.' using errcode = '42501'; end if;
  select * into d from public.devices where serial = v_dev;
  if not found then raise exception 'INPUT: unit % is not in the inventory.', v_dev using errcode = '22023'; end if;
  v_old := app.kit_remove(v_dev, p->>'code', (p->>'qty')::int, p->>'old_serial', coalesce(p->>'old_result', 'FAULTY'), p->>'remark', 'Replacement', null);
  v_new := app.kit_add(v_dev, p->>'code', (p->>'qty')::int, p->>'new_serial', true, p->>'remark', null);
  perform app.mat_audit('Merchant Kit Replacement', 'Unit ' || v_dev || coalesce(' · ' || d.merchant_name, '') || ' · ' || (v_old->>'code')
                        || coalesce(' ' || (v_old->>'serial'), '') || ' (' || lower(v_old->>'result') || ') -> ' || coalesce(v_new->>'serial', 'new × ' || (v_new->>'qty'))
                        || coalesce(' · ' || nullif(btrim(p->>'remark'), ''), ''), d.branch_id, 'MATERIAL_KIT_REPLACE', v_dev);
  return jsonb_build_object('old', v_old, 'new', v_new);
end $$;

-- Monthly count --------------------------------------------------------------------------------------------------------
-- Branch staff (own branch) or Admin HQ submit what is on the shelf. {branch_id, month 'YYYY-MM',
--   lines:[{code, counted (quantities), present:[numbers] (SIM / battery), remark}]}. The system figures are taken now.
create or replace function public.material_count_submit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_branch varchar; v_month text := btrim(coalesce(p->>'month', '')); r jsonb; t public.material_types;
  v_lines jsonb := '[]'::jsonb; v_sys int; v_cnt int; v_present text[]; v_system text[]; v_missing text[]; v_extra text[]; v_diffs int := 0; v_id bigint;
begin
  if app.role() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  v_branch := app.mat_branch(coalesce(nullif(p->>'branch_id', ''), app.branch()));
  if not app.is_admin() and v_branch is distinct from app.branch() then raise exception 'You can count only your own branch.' using errcode = '42501'; end if;
  if v_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'INPUT: month must look like 2026-11.' using errcode = '22023'; end if;
  if exists (select 1 from public.material_counts where branch_id = v_branch and month = v_month and status = 'APPROVED') then
    raise exception 'INPUT: the % count of % is already approved.', v_month, app.mat_where(v_branch) using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    t := app.mat_type(r->>'code');
    if t.tracking = 'QTY' then
      v_cnt := (r->>'counted')::int;
      if v_cnt is null or v_cnt < 0 then raise exception 'INPUT: enter the counted quantity of %.', t.name using errcode = '22023'; end if;
      select coalesce(sum(qty), 0) into v_sys from public.material_qty where material_code = t.code and branch_id = v_branch;
      v_lines := v_lines || jsonb_build_object('code', t.code, 'system', v_sys, 'counted', v_cnt, 'diff', v_cnt - v_sys, 'remark', nullif(btrim(coalesce(r->>'remark', '')), ''));
      if v_cnt <> v_sys then v_diffs := v_diffs + 1; end if;
    else
      select coalesce(array_agg(distinct app.mat_serial(t.code, x)) filter (where app.mat_serial(t.code, x) is not null), '{}')
        into v_present from jsonb_array_elements_text(coalesce(r->'present', '[]'::jsonb)) x;
      select coalesce(array_agg(serial order by serial), '{}') into v_system
        from public.material_serials where material_code = t.code and branch_id = v_branch and status = 'BRANCH_RESERVE';
      select coalesce(array_agg(s order by s), '{}') into v_missing from unnest(v_system) s where not s = any(v_present);
      select coalesce(array_agg(s order by s), '{}') into v_extra from unnest(v_present) s where not s = any(v_system);
      v_lines := v_lines || jsonb_build_object('code', t.code, 'system', cardinality(v_system), 'counted', cardinality(v_present),
                 'diff', cardinality(v_present) - cardinality(v_system), 'missing', to_jsonb(v_missing), 'extra', to_jsonb(v_extra),
                 'remark', nullif(btrim(coalesce(r->>'remark', '')), ''));
      if cardinality(v_missing) + cardinality(v_extra) > 0 then v_diffs := v_diffs + 1; end if;
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'INPUT: the count has no lines.' using errcode = '22023'; end if;
  delete from public.material_counts where branch_id = v_branch and month = v_month and status = 'PENDING';   -- a new count replaces a waiting one
  insert into public.material_counts (branch_id, month, lines, differences, submitted_by)
  values (v_branch, v_month, v_lines, v_diffs, app.label()) returning id into v_id;
  perform app.mat_audit('Monthly Count Submitted', app.mat_where(v_branch) || ' · ' || v_month || ' · ' || v_diffs || ' item(s) with a difference',
                        v_branch, 'MATERIAL_COUNT_SUBMIT', v_id::text);
  return jsonb_build_object('id', v_id, 'differences', v_diffs, 'lines', v_lines);
end $$;

-- Admin HQ approves (system corrected to the count; missing SIMs / batteries become Lost) or rejects (recount).
create or replace function public.admin_material_count_review(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.material_counts; v_act text := upper(btrim(coalesce(p->>'action', ''))); v_note text := btrim(coalesce(p->>'note', ''));
        l jsonb; s text; v_lost int := 0; v_adj int := 0;
begin
  if not app.is_admin() then raise exception 'Only Admin HQ can review a count.' using errcode = '42501'; end if;
  select * into c from public.material_counts where id = (p->>'id')::bigint for update;
  if not found then raise exception 'INPUT: count not found.' using errcode = '22023'; end if;
  if c.status <> 'PENDING' then raise exception 'INPUT: this count is already %.', lower(c.status) using errcode = '22023'; end if;
  if v_act = 'REJECT' then
    if char_length(v_note) < 3 then raise exception 'INPUT: write why the count is rejected.' using errcode = '22023'; end if;
    update public.material_counts set status = 'REJECTED', reviewed_by = app.label(), reviewed_at = now(), review_note = v_note where id = c.id;
    perform app.mat_audit('Monthly Count Rejected', app.mat_where(c.branch_id) || ' · ' || c.month || ' · ' || v_note, c.branch_id, 'MATERIAL_COUNT_REJECT', c.id::text);
    return jsonb_build_object('status', 'REJECTED');
  end if;
  if v_act <> 'APPROVE' then raise exception 'INPUT: action must be Approve or Reject.' using errcode = '22023'; end if;
  for l in select * from jsonb_array_elements(c.lines) loop
    if l ? 'missing' then
      for s in select jsonb_array_elements_text(l->'missing') loop
        update public.material_serials set status = 'LOST', updated_at = now(), updated_by = app.label()
         where material_code = l->>'code' and serial = s and branch_id = c.branch_id and status = 'BRANCH_RESERVE';
        if found then
          insert into public.material_lost (material_code, serial, qty, branch_id, source, remark, reported_by)
          values (l->>'code', s, 1, c.branch_id, 'Monthly count', coalesce(l->>'remark', 'Not found at the ' || c.month || ' count'), c.submitted_by);
          perform app.mat_log('LOST', l->>'code', s, 1, c.branch_id, null, c.branch_id, 'count ' || c.id, null, null, 'Monthly count ' || c.month);
          v_lost := v_lost + 1;
        end if;
      end loop;
    elsif (l->>'diff')::int <> 0 then
      update public.material_qty set qty = (l->>'counted')::int, updated_at = now() where material_code = l->>'code' and branch_id = c.branch_id;
      if not found then insert into public.material_qty (material_code, branch_id, qty) values (l->>'code', c.branch_id, (l->>'counted')::int); end if;
      perform app.mat_log('COUNT_ADJUST', l->>'code', null, (l->>'diff')::int, null, c.branch_id, c.branch_id, 'count ' || c.id, null, null,
                          'Monthly count ' || c.month || ': ' || (l->>'system') || ' -> ' || (l->>'counted') || coalesce(' · ' || (l->>'remark'), ''));
      v_adj := v_adj + 1;
    end if;
  end loop;
  update public.material_counts set status = 'APPROVED', reviewed_by = app.label(), reviewed_at = now(), review_note = nullif(v_note, '') where id = c.id;
  perform app.mat_audit('Monthly Count Approved', app.mat_where(c.branch_id) || ' · ' || c.month || ' · ' || v_adj || ' quantity correction(s), '
                        || v_lost || ' SIM / battery recorded Lost' || coalesce(' · ' || nullif(v_note, ''), ''), c.branch_id, 'MATERIAL_COUNT_APPROVE', c.id::text);
  return jsonb_build_object('status', 'APPROVED', 'adjusted', v_adj, 'lost', v_lost);
end $$;

-- 6. Stock Requests carry materials ----------------------------------------------------------------------------------
-- Materials move only through dispatch and receipt; a branch may change the requested quantities while pending.
do $do$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('app.requisitions_guard()'::regprocedure);
  if position('materials_sent' in v_def) > 0 then return; end if;   -- already patched (migration run twice)
  v_new := replace(v_def,
    $a$    new.arranged_devices := '[]'::jsonb;$a$,
    $a$    new.arranged_devices := '[]'::jsonb;
    new.materials_sent := '{}'::jsonb;$a$);
  v_new := replace(v_new,
    $a$     or new.branch_id is distinct from old.branch_id then$a$,
    $a$     or new.branch_id is distinct from old.branch_id or new.materials_sent is distinct from old.materials_sent then$a$);
  v_new := replace(v_new,
    $a$      or new.reason is distinct from old.reason or new.staff is distinct from old.staff) then$a$,
    $a$      or new.reason is distinct from old.reason or new.staff is distinct from old.staff or new.materials is distinct from old.materials) then$a$);
  v_new := replace(v_new,
    $a$    if coalesce(new.pos_qty, 0) + coalesce(new.sb_qty, 0) <= 0 then
      raise exception 'Enter at least one POS Terminal or Sound Box.' using errcode = '22023';$a$,
    $a$    if coalesce(new.pos_qty, 0) + coalesce(new.sb_qty, 0)
       + coalesce((select sum(greatest((x.value)::int, 0)) from jsonb_each_text(coalesce(new.materials, '{}'::jsonb)) x where x.value ~ '^\d+$'), 0) <= 0 then
      raise exception 'Enter at least one POS Terminal, Sound Box or material.' using errcode = '22023';$a$);
  if v_new = v_def or position('new.materials_sent := ' in v_new) = 0 or position('or new.materials is distinct from old.materials' in v_new) = 0
     or position('or material.' in v_new) = 0 then
    raise exception 'requisitions_guard has changed since this migration was written: not patched.';
  end if;
  execute v_new;
end $do$;

-- Receipt moves the request's materials into the branch reserve (once).
create or replace function app.material_receive(p_req_id text, p_by text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.requisitions; m jsonb; k text; v int; s text; v_n int := 0;
begin
  select * into r from public.requisitions where req_id = p_req_id;
  m := coalesce(r.materials_sent, '{}'::jsonb);
  if m = '{}'::jsonb or coalesce((m->>'received')::boolean, false) then return jsonb_build_object('materials', 0); end if;
  for k, v in select key, value::int from jsonb_each_text(coalesce(m->'qty', '{}'::jsonb)) loop
    if v > 0 then
      perform app.mat_qty_move(k, r.branch_id, v);
      perform app.mat_log('RECEIVE', k, null, v, null, r.branch_id, r.branch_id, r.req_id, null, null, 'Received · ' || coalesce(p_by, ''));
      v_n := v_n + v;
    end if;
  end loop;
  for k in select key from jsonb_each(coalesce(m->'serials', '{}'::jsonb)) loop
    for s in select jsonb_array_elements_text(m->'serials'->k) loop
      update public.material_serials set status = 'BRANCH_RESERVE', branch_id = r.branch_id, req_id = null, updated_at = now(), updated_by = coalesce(p_by, app.label())
       where material_code = k and serial = s and status = 'IN_TRANSIT' and req_id = r.req_id;
      if found then
        perform app.mat_log('RECEIVE', k, s, 1, null, r.branch_id, r.branch_id, r.req_id, null, null, 'Received · ' || coalesce(p_by, ''));
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  update public.requisitions set materials_sent = m || jsonb_build_object('received', true) where req_id = r.req_id;
  return jsonb_build_object('materials', v_n);
end $$;
revoke all on function app.material_receive(text, text) from public, anon, authenticated;

do $do$
declare f text; v_def text; v_new text; v_anchor text := $a$  update public.requisitions set status = 'RECEIVED' where req_id = r.req_id;$a$;
begin
  foreach f in array array['public.branch_confirm_receipt(text)', 'public.mv_req_confirm(jsonb)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if position(v_anchor in v_def) = 0 then raise exception '% has changed since this migration was written: not patched.', f; end if;
    if position('app.material_receive' in v_def) > 0 then continue; end if;
    v_new := replace(v_def, v_anchor,
      case when f like 'public.branch_confirm_receipt%'
           then $a$  perform app.material_receive(r.req_id, coalesce(app.label(), 'staff'));
$a$ else $a$  perform app.material_receive(r.req_id, v_by || ' (Merchant Visit app)');
$a$ end || v_anchor);
    execute v_new;
  end loop;
end $do$;

-- Dispatch a request: devices and materials together, all or nothing.
-- {req_id, serials:[device serials], note, materials:{qty:{CODE:n}, serials:{SIM:[...], BATTERY:[...]}}}
create or replace function public.admin_dispatch_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.requisitions; v_serials text[]; v_mq jsonb := coalesce(p->'materials'->'qty', '{}'::jsonb); v_ms jsonb := coalesce(p->'materials'->'serials', '{}'::jsonb);
  k text; v int; x text; s text; t public.material_types; v_req int; v_sent jsonb := '{}'::jsonb; v_list text[]; v_res jsonb := '{}'::jsonb; v_n int := 0;
begin
  if not app.is_admin() then raise exception 'Only HQ admins can dispatch stock.' using errcode = '42501'; end if;
  perform set_config('app.trusted_change', 'on', true);
  select * into r from public.requisitions where req_id = p->>'req_id' for update;
  if not found then raise exception 'Request % not found.', p->>'req_id'; end if;
  if coalesce(r.type, 'STOCK_REQUEST') <> 'STOCK_REQUEST' then raise exception 'Request % is a stock return, not a stock request.', r.req_id; end if;
  if r.status <> 'PENDING_ADMIN' then raise exception 'Request % is already % and cannot be dispatched again.', r.req_id, r.status; end if;
  select coalesce(array_agg(e.v), '{}') into v_serials from jsonb_array_elements_text(coalesce(p->'serials', '[]'::jsonb)) as e(v) where btrim(e.v) <> '';
  -- materials by quantity: from Head Office stock, at most what was requested
  for k, v in select upper(key), value::int from jsonb_each_text(v_mq) where value ~ '^\d+$' loop
    if v <= 0 then continue; end if;
    t := app.mat_type(k);
    if t.tracking <> 'QTY' then raise exception 'INPUT: % is sent by number, not by quantity.', t.name using errcode = '22023'; end if;
    v_req := coalesce((r.materials->>t.code)::int, 0);
    if v > v_req then raise exception 'Not dispatched: % % sent but % requested.', v, t.name, v_req using errcode = '22023'; end if;
    perform app.mat_qty_move(t.code, '100', -v);
    perform app.mat_log('DISPATCH', t.code, null, v, '100', r.branch_id, r.branch_id, r.req_id, null, null, 'In transit');
    v_sent := jsonb_set(v_sent, '{qty}', coalesce(v_sent->'qty', '{}'::jsonb) || jsonb_build_object(t.code, v));
    v_n := v_n + v;
  end loop;
  -- SIMs and batteries by number: each must be in Head Office stock
  for k in select upper(key) from jsonb_each(v_ms) loop
    t := app.mat_type(k);
    if t.tracking <> 'SERIAL' then raise exception 'INPUT: % is sent by quantity.', t.name using errcode = '22023'; end if;
    v_list := '{}';
    for x in select jsonb_array_elements_text(v_ms->k) loop
      s := app.mat_serial(t.code, x);
      if s is null then raise exception 'Not dispatched: "%" is not a valid % number.', x, t.name using errcode = '22023'; end if;
      if s = any(v_list) then raise exception 'Not dispatched: % % is listed twice.', t.name, s using errcode = '22023'; end if;
      update public.material_serials set status = 'IN_TRANSIT', req_id = r.req_id, updated_at = now(), updated_by = app.label()
       where material_code = t.code and serial = s and status = 'HQ_STOCK' and branch_id = '100';
      if not found then raise exception 'Not dispatched: % % is not in Head Office stock.', t.name, s using errcode = '22023'; end if;
      perform app.mat_log('DISPATCH', t.code, s, 1, '100', r.branch_id, r.branch_id, r.req_id, null, null, 'In transit');
      v_list := v_list || s;
    end loop;
    if cardinality(v_list) > coalesce((r.materials->>t.code)::int, 0) then
      raise exception 'Not dispatched: % % sent but % requested.', cardinality(v_list), t.name, coalesce((r.materials->>t.code)::int, 0) using errcode = '22023';
    end if;
    if cardinality(v_list) > 0 then
      v_sent := jsonb_set(v_sent, '{serials}', coalesce(v_sent->'serials', '{}'::jsonb) || jsonb_build_object(t.code, to_jsonb(v_list)));
      v_n := v_n + cardinality(v_list);
    end if;
  end loop;
  if cardinality(v_serials) = 0 and v_n = 0 then raise exception 'Choose at least one unit or material to dispatch.' using errcode = '22023'; end if;
  update public.requisitions set materials_sent = v_sent where req_id = r.req_id;
  if cardinality(v_serials) > 0 then
    v_res := public.admin_dispatch_requisition(r.req_id, v_serials, p->>'note');   -- devices: unchanged rules; sets DISPATCHED
  else
    update public.requisitions set status = 'DISPATCHED', arranged_devices = '[]'::jsonb where req_id = r.req_id;
  end if;
  if v_n > 0 then
    perform app.mat_audit('Materials Dispatched', 'Request ' || r.req_id || ' to Branch Code ' || r.branch_id || ': '
                          || coalesce((select string_agg(key || ' × ' || value, ', ') from jsonb_each_text(coalesce(v_sent->'qty', '{}'::jsonb))), '')
                          || coalesce((select ' ' || string_agg(key || ' ' || jsonb_array_length(value) || ' no.', ', ') from jsonb_each(coalesce(v_sent->'serials', '{}'::jsonb))), ''),
                          r.branch_id, 'MATERIAL_DISPATCH', r.req_id);
  end if;
  return v_res || jsonb_build_object('materials_sent', v_sent);
end $$;

-- 7. Access to the functions ----------------------------------------------------------------------------------------
revoke all on function app.norm_sim(text), app.mat_serial(text, text), app.mat_type(text), app.mat_branch(text),
  app.mat_log(text, text, text, int, varchar, varchar, varchar, text, varchar, varchar, text), app.mat_qty_move(text, varchar, int),
  app.mat_where(varchar), app.mat_audit(text, text, varchar, text, text), app.kit_row(varchar),
  app.kit_add(varchar, text, int, text, boolean, text, text), app.kit_remove(varchar, text, int, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_material_stock_in(jsonb), public.admin_material_opening(jsonb), public.admin_material_adjust(jsonb),
  public.admin_material_lost_action(jsonb), public.admin_kit_add(jsonb), public.admin_kit_return(jsonb), public.admin_kit_replace(jsonb),
  public.material_count_submit(jsonb), public.admin_material_count_review(jsonb), public.admin_dispatch_request(jsonb) from public, anon;
grant execute on function public.admin_material_stock_in(jsonb), public.admin_material_opening(jsonb), public.admin_material_adjust(jsonb),
  public.admin_material_lost_action(jsonb), public.admin_kit_add(jsonb), public.admin_kit_return(jsonb), public.admin_kit_replace(jsonb),
  public.material_count_submit(jsonb), public.admin_material_count_review(jsonb), public.admin_dispatch_request(jsonb) to authenticated;
