-- =====================================================================================================================
-- 15 (1 Nov 2026) KPI Performance & Management Point System (Daily, Weekly, Monthly, Quarterly & All-Time)
-- =====================================================================================================================
-- 1. public.kpi_point_rules : Admin-defined KPI Tasks & Point weights by Category and Sub-Category.
-- 2. public.kpi_settings    : Admin-defined Daily, Weekly, Monthly, and Quarterly point targets for Branches & Staff.
-- 3. public.kpi_save_rule   : Admin RPC to create/update KPI task point rules (with audit trail).
-- 4. public.kpi_delete_rule : Admin RPC to remove custom KPI rules (system rules can be set to 0 pts or inactive).
-- 5. public.kpi_save_targets: Admin RPC to update Daily / Weekly / Monthly / Quarterly targets.
-- 6. public.kpi_dashboard_summary : Single-round-trip aggregation across POS Terminal, Sound Box, KHQR (live + archive),
--    and Credit Card for Branch KPIs, Individual Staff KPIs, Daily/Weekly/Monthly/Quarterly trends, and Top 10 per month.
-- =====================================================================================================================

create table if not exists public.kpi_point_rules (
  code         text primary key check (code ~ '^[A-Z0-9_]{2,40}$'),
  category     text not null check (category in ('POS Terminal', 'Sound Box', 'KHQR', 'Credit Card', 'Other')),
  sub_category text not null check (char_length(trim(sub_category)) between 1 and 120),
  description  text not null default '' check (char_length(description) <= 400),
  points       numeric(8, 2) not null default 0 check (points >= 0 and points <= 10000),
  unit         text not null default 'per task' check (char_length(unit) <= 60),
  active       boolean not null default true,
  is_system    boolean not null default false,
  sort_order   integer not null default 100,
  updated_by   text,
  updated_at   timestamptz not null default now()
);

alter table public.kpi_point_rules enable row level security;
revoke all on public.kpi_point_rules from anon;
revoke insert, update, delete on public.kpi_point_rules from authenticated;
grant select on public.kpi_point_rules to authenticated, service_role;

drop policy if exists kpi_rules_read on public.kpi_point_rules;
create policy kpi_rules_read on public.kpi_point_rules for select to authenticated
  using ((select app.role()) is not null);

-- Seed the 12 core system KPI tasks (idempotent: preserves any point edits made by Admin)
insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order)
values
  ('POS_INSTALL',   'POS Terminal', 'POS New Installation',          'Approved new POS Terminal installation at merchant',               10.00, 'per terminal',   true, true, 10),
  ('POS_REPLACE',   'POS Terminal', 'POS Replacement / Swap',        'Approved POS Terminal replacement or hardware swap',                5.00, 'per swap',       true, true, 20),
  ('POS_BATTERY',   'POS Terminal', 'POS Battery Replacement',       'Approved POS Terminal battery replacement in the field',            3.00, 'per battery',    true, true, 30),
  ('SB_INSTALL',    'Sound Box',    'Sound Box New Installation',    'Approved new Sound Box installation at merchant',                   8.00, 'per unit',       true, true, 40),
  ('SB_REPLACE',    'Sound Box',    'Sound Box Replacement / Swap',  'Approved Sound Box replacement or swap',                            4.00, 'per swap',       true, true, 50),
  ('SB_MAINT',      'Sound Box',    'Sound Box Maintenance',         'Approved Sound Box maintenance / troubleshooting visit',            3.00, 'per visit',      true, true, 60),
  ('SB_RETURN',     'Sound Box',    'Sound Box Return / Recovery',   'Approved Sound Box retrieval / return from merchant',               2.00, 'per unit',       true, true, 70),
  ('KHQR_INSTALL',  'KHQR',         'KHQR New Installation',         'Verified KHQR new merchant installation (camera-scanned MID)',      4.00, 'per merchant',   true, true, 80),
  ('KHQR_REPLACE',  'KHQR',         'KHQR Replacement',              'Verified KHQR stand / sticker replacement (camera-scanned MID)',    2.00, 'per merchant',   true, true, 90),
  ('KHQR_MATERIAL', 'KHQR',         'QR Material Scanned (Bonus)',   'Bonus per physical QR stand/sticker scanned during KHQR visit',     0.50, 'per QR item',    true, true, 100),
  ('CC_PRIMARY',    'Credit Card',  'Primary Credit Card Onboarded', 'Primary Credit Card onboarding confirmed by Head Office',          15.00, 'per card',       true, true, 110),
  ('CC_SUPP',       'Credit Card',  'Supplementary Card Onboarded',  'Supplementary Credit Card onboarding confirmed by Head Office',     8.00, 'per supp. card', true, true, 120)
on conflict (code) do nothing;

-- Global KPI Targets (Daily, Weekly, Monthly, Quarterly for Branches and Individual Staff)
create table if not exists public.kpi_settings (
  id                       smallint primary key default 1 check (id = 1),
  branch_daily_target      numeric(10, 2) not null default 20,
  branch_weekly_target     numeric(10, 2) not null default 120,
  branch_monthly_target    numeric(10, 2) not null default 500,
  branch_quarterly_target  numeric(10, 2) not null default 1500,
  staff_daily_target       numeric(10, 2) not null default 5,
  staff_weekly_target      numeric(10, 2) not null default 30,
  staff_monthly_target     numeric(10, 2) not null default 120,
  staff_quarterly_target   numeric(10, 2) not null default 360,
  updated_by               text,
  updated_at               timestamptz not null default now()
);

alter table public.kpi_settings enable row level security;
revoke all on public.kpi_settings from anon;
revoke insert, update, delete on public.kpi_settings from authenticated;
grant select on public.kpi_settings to authenticated, service_role;

drop policy if exists kpi_settings_read on public.kpi_settings;
create policy kpi_settings_read on public.kpi_settings for select to authenticated
  using ((select app.role()) is not null);

insert into public.kpi_settings (id) values (1) on conflict (id) do nothing;

-- Admin RPC: Create or update a KPI task & point rule
create or replace function public.kpi_save_rule(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(trim(coalesce(p->>'code', '')), '[^A-Za-z0-9_]', '_', 'g'));
  v_cat  text := trim(coalesce(p->>'category', ''));
  v_sub  text := trim(coalesce(p->>'sub_category', ''));
  v_desc text := trim(coalesce(p->>'description', ''));
  v_pts  numeric(8, 2) := round(coalesce((p->>'points')::numeric, 0), 2);
  v_unit text := coalesce(nullif(trim(coalesce(p->>'unit', '')), ''), 'per task');
  v_act  boolean := coalesce((p->>'active')::boolean, true);
  v_sort integer := coalesce((p->>'sort_order')::integer, 100);
  v_by   text := app.label();
  r      public.kpi_point_rules;
begin
  if not app.is_admin() then
    raise exception 'Only Admin HQ can change KPI point rules.' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) < 2 then
    raise exception 'Task code is required (at least 2 characters).' using errcode = '22023';
  end if;
  if v_cat not in ('POS Terminal', 'Sound Box', 'KHQR', 'Credit Card', 'Other') then
    raise exception 'Invalid KPI category.' using errcode = '22023';
  end if;
  if v_sub = '' then
    raise exception 'Task / Sub-Category name is required.' using errcode = '22023';
  end if;
  if v_pts < 0 or v_pts > 10000 then
    raise exception 'KPI points must be between 0 and 10,000.' using errcode = '22023';
  end if;

  insert into public.kpi_point_rules (code, category, sub_category, description, points, unit, active, is_system, sort_order, updated_by, updated_at)
  values (left(v_code, 40), v_cat, left(v_sub, 120), left(v_desc, 400), v_pts, left(v_unit, 60), v_act, false, v_sort, v_by, now())
  on conflict (code) do update set
    category     = excluded.category,
    sub_category = excluded.sub_category,
    description  = excluded.description,
    points       = excluded.points,
    unit         = excluded.unit,
    active       = excluded.active,
    sort_order   = coalesce((p->>'sort_order')::integer, public.kpi_point_rules.sort_order),
    updated_by   = v_by,
    updated_at   = now()
  returning * into r;

  insert into public.audit_logs (title, detail, action, target, branch_id)
  values ('KPI Rule Updated', r.code || ' (' || r.sub_category || ') → ' || r.points || ' pts (' || case when r.active then 'Active' else 'Inactive' end || ')', 'KPI_RULE_SAVE', r.code, '100');

  return to_jsonb(r);
end $$;

-- Admin RPC: Delete a custom KPI rule (system rules cannot be deleted, only deactivated or set to 0 pts)
create or replace function public.kpi_delete_rule(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.kpi_point_rules;
begin
  if not app.is_admin() then
    raise exception 'Only Admin HQ can delete KPI point rules.' using errcode = '42501';
  end if;
  select * into r from public.kpi_point_rules where code = p_code;
  if not found then
    return jsonb_build_object('ok', true);
  end if;
  if r.is_system then
    raise exception 'System KPI rule % cannot be deleted. You can set its points to 0 or mark it Inactive.', p_code using errcode = '22023';
  end if;
  delete from public.kpi_point_rules where code = p_code;
  insert into public.audit_logs (title, detail, action, target, branch_id)
  values ('KPI Rule Deleted', r.code || ' · ' || r.sub_category, 'KPI_RULE_DELETE', r.code, '100');
  return jsonb_build_object('ok', true);
end $$;

-- Admin RPC: Update Daily / Weekly / Monthly / Quarterly KPI point targets
create or replace function public.kpi_save_targets(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.kpi_settings; v_by text := app.label();
begin
  if not app.is_admin() then
    raise exception 'Only Admin HQ can change KPI targets.' using errcode = '42501';
  end if;
  update public.kpi_settings set
    branch_daily_target     = greatest(0, coalesce((p->>'branch_daily_target')::numeric, branch_daily_target)),
    branch_weekly_target    = greatest(0, coalesce((p->>'branch_weekly_target')::numeric, branch_weekly_target)),
    branch_monthly_target   = greatest(0, coalesce((p->>'branch_monthly_target')::numeric, branch_monthly_target)),
    branch_quarterly_target = greatest(0, coalesce((p->>'branch_quarterly_target')::numeric, branch_quarterly_target)),
    staff_daily_target      = greatest(0, coalesce((p->>'staff_daily_target')::numeric, staff_daily_target)),
    staff_weekly_target     = greatest(0, coalesce((p->>'staff_weekly_target')::numeric, staff_weekly_target)),
    staff_monthly_target    = greatest(0, coalesce((p->>'staff_monthly_target')::numeric, staff_monthly_target)),
    staff_quarterly_target  = greatest(0, coalesce((p->>'staff_quarterly_target')::numeric, staff_quarterly_target)),
    updated_by              = v_by,
    updated_at              = now()
  where id = 1
  returning * into r;

  insert into public.audit_logs (title, detail, action, target, branch_id)
  values ('KPI Targets Updated',
          'Branch (D/W/M/Q): ' || r.branch_daily_target || '/' || r.branch_weekly_target || '/' || r.branch_monthly_target || '/' || r.branch_quarterly_target
          || ' · Staff (D/W/M/Q): ' || r.staff_daily_target || '/' || r.staff_weekly_target || '/' || r.staff_monthly_target || '/' || r.staff_quarterly_target,
          'KPI_TARGETS_SAVE', 'KPI_SETTINGS', '100');
  return to_jsonb(r);
end $$;

-- =====================================================================================================================
-- Single-RPC KPI Performance Aggregation (Branch, Individual, Daily/Weekly/Monthly/Quarterly Trends, Monthly Top 10)
-- =====================================================================================================================
create or replace function public.kpi_dashboard_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := app.role();
  v_keep timestamptz := public.qr_keep_from();
  v_rules jsonb;
  v_targets jsonb;
  v_staff jsonb;
  v_daily jsonb;
  v_weekly jsonb;
  v_monthly jsonb;
  v_quarterly jsonb;
  v_monthly_staff jsonb;
begin
  if v_role is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order, r.code), '[]'::jsonb)
    into v_rules from public.kpi_point_rules r;

  select to_jsonb(s) into v_targets from public.kpi_settings s where s.id = 1;

  -- 1) Staff-level unified task aggregation for the selected period [p_from, p_to)
  --    (Branch KPIs, Product Consumption, and Individual Staff KPIs are derived from this exact dataset)
  with raw_events as (
    -- POS Terminal & Sound Box field events
    select
      coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(fe.staff_name), '') as staff_name,
      coalesce(fe.branch_id, app.resolve_branch(fe.branch_text)) as branch_id,
      nullif(trim(fe.branch_text), '') as branch_text,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'INSTALL' and fe.status = 'APPROVED')::int as pos_install,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'REPLACE' and fe.status = 'APPROVED')::int as pos_replace,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'BATTERY' and fe.status = 'APPROVED')::int as pos_battery,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.status in ('APPROVED', 'REJECTED', 'PENDING'))::int as pos_submitted,
      count(*) filter (where coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.status = 'REJECTED')::int as pos_rejected,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.kind = 'INSTALL' and fe.status = 'APPROVED')::int as sb_install,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.kind = 'REPLACE' and fe.status = 'APPROVED')::int as sb_replace,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.kind = 'SB_MAINT' and fe.status = 'APPROVED')::int as sb_maint,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.kind = 'SB_RETURN' and fe.status = 'APPROVED')::int as sb_return,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.status in ('APPROVED', 'REJECTED', 'PENDING'))::int as sb_submitted,
      count(*) filter (where fe.device_type = 'Sound Box' and fe.status = 'REJECTED')::int as sb_rejected,
      0::int as khqr_install,
      0::int as khqr_replace,
      0::int as khqr_materials,
      0::int as khqr_failed,
      0::int as cc_primary,
      0::int as cc_supp,
      0::int as cc_submitted,
      0::int as cc_rejected
    from public.field_events fe
    where (p_from is null or coalesce(fe.recorded_at, fe.received_at) >= p_from)
      and (p_to is null or coalesce(fe.recorded_at, fe.received_at) < p_to)
    group by 1, 2, 3, 4

    union all

    -- KHQR live entries
    select
      coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(q.staff_name), '') as staff_name,
      coalesce(q.branch_id, app.resolve_branch(q.branch_text)) as branch_id,
      nullif(trim(q.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      count(*) filter (where q.activity = 'NEW_INSTALLATION')::int as khqr_install,
      count(*) filter (where q.activity = 'QR_REPLACEMENT')::int as khqr_replace,
      coalesce(sum(q.qr_count), 0)::int as khqr_materials,
      count(*) filter (where q.failed_attempts > 0)::int as khqr_failed,
      0, 0, 0, 0
    from public.qr_installations q
    where (p_from is null or q.submitted_at >= p_from)
      and (p_to is null or q.submitted_at < p_to)
    group by 1, 2, 3, 4

    union all

    -- KHQR archived monthly summaries (for months older than qr_keep_from)
    select
      coalesce(nullif(trim(s.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(s.staff_name), '') as staff_name,
      coalesce(s.branch_id, app.resolve_branch(s.branch_text)) as branch_id,
      nullif(trim(s.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      coalesce(sum(s.install), 0)::int as khqr_install,
      coalesce(sum(s.replace), 0)::int as khqr_replace,
      coalesce(sum(s.qr), 0)::int as khqr_materials,
      coalesce(sum(s.attempts), 0)::int as khqr_failed,
      0, 0, 0, 0
    from public.qr_monthly_summary s
    where s.month < (v_keep at time zone 'Asia/Phnom_Penh')::date
      and (p_from is null or (s.month::timestamp at time zone 'Asia/Phnom_Penh') >= p_from)
      and (p_to is null or (s.month::timestamp at time zone 'Asia/Phnom_Penh') < p_to)
    group by 1, 2, 3, 4

    union all

    -- Credit Card entries
    select
      coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(c.staff_name), '') as staff_name,
      coalesce(c.branch_id, app.resolve_branch(c.branch_text)) as branch_id,
      nullif(trim(c.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      count(*) filter (where c.review_status = 'CONFIRMED' and c.request_type <> 'Add Supplementary Only' and c.card_status = 'Onboarded Successfully')::int as cc_primary,
      coalesce(sum(jsonb_array_length(c.supplementary)) filter (where c.review_status = 'CONFIRMED'), 0)::int as cc_supp,
      count(*)::int as cc_submitted,
      count(*) filter (where c.review_status = 'REJECTED')::int as cc_rejected
    from public.cc_entries c
    where (p_from is null or c.submitted_at >= p_from)
      and (p_to is null or c.submitted_at < p_to)
    group by 1, 2, 3, 4
  ),
  grouped_staff as (
    select
      r.staff_id,
      coalesce(max(sp.name), max(r.staff_name), r.staff_id) as staff_name,
      coalesce(max(sp.branch_id), max(r.branch_id), 'UNASSIGNED') as branch_id,
      coalesce(max(b.name), max(r.branch_text), 'Unassigned') as branch_name,
      sum(r.pos_install)::int as pos_install,
      sum(r.pos_replace)::int as pos_replace,
      sum(r.pos_battery)::int as pos_battery,
      sum(r.pos_submitted)::int as pos_submitted,
      sum(r.pos_rejected)::int as pos_rejected,
      sum(r.sb_install)::int as sb_install,
      sum(r.sb_replace)::int as sb_replace,
      sum(r.sb_maint)::int as sb_maint,
      sum(r.sb_return)::int as sb_return,
      sum(r.sb_submitted)::int as sb_submitted,
      sum(r.sb_rejected)::int as sb_rejected,
      sum(r.khqr_install)::int as khqr_install,
      sum(r.khqr_replace)::int as khqr_replace,
      sum(r.khqr_materials)::int as khqr_materials,
      sum(r.khqr_failed)::int as khqr_failed,
      sum(r.cc_primary)::int as cc_primary,
      sum(r.cc_supp)::int as cc_supp,
      sum(r.cc_submitted)::int as cc_submitted,
      sum(r.cc_rejected)::int as cc_rejected
    from raw_events r
    left join public.staff_profiles sp on sp.emp_id = r.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, r.branch_id)
    group by r.staff_id
  )
  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_staff from grouped_staff g;

  -- 2) All time-bucketed events over the last 24 months for Daily (30d), Weekly (12w), Monthly (12m), Quarterly (8q)
  with timed_events as (
    select
      (coalesce(fe.recorded_at, fe.received_at) at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(fe.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(fe.staff_name), '') as staff_name,
      coalesce(fe.branch_id, app.resolve_branch(fe.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(fe.branch_text), '') as branch_text,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'INSTALL' and fe.status = 'APPROVED' then 1 else 0 end) as pos_install,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'REPLACE' and fe.status = 'APPROVED' then 1 else 0 end) as pos_replace,
      (case when coalesce(fe.device_type, 'POS Terminal') <> 'Sound Box' and fe.kind = 'BATTERY' and fe.status = 'APPROVED' then 1 else 0 end) as pos_battery,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'INSTALL' and fe.status = 'APPROVED' then 1 else 0 end) as sb_install,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'REPLACE' and fe.status = 'APPROVED' then 1 else 0 end) as sb_replace,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'SB_MAINT' and fe.status = 'APPROVED' then 1 else 0 end) as sb_maint,
      (case when fe.device_type = 'Sound Box' and fe.kind = 'SB_RETURN' and fe.status = 'APPROVED' then 1 else 0 end) as sb_return,
      0 as khqr_install, 0 as khqr_replace, 0 as khqr_materials,
      0 as cc_primary, 0 as cc_supp
    from public.field_events fe
    where fe.status = 'APPROVED'
      and coalesce(fe.recorded_at, fe.received_at) >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh'

    union all

    select
      (q.submitted_at at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(q.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(q.staff_name), '') as staff_name,
      coalesce(q.branch_id, app.resolve_branch(q.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(q.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0,
      (case when q.activity = 'NEW_INSTALLATION' then 1 else 0 end) as khqr_install,
      (case when q.activity = 'QR_REPLACEMENT' then 1 else 0 end) as khqr_replace,
      coalesce(q.qr_count, 0)::int as khqr_materials,
      0, 0
    from public.qr_installations q
    where q.submitted_at >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh'

    union all

    select
      s.month as d,
      coalesce(nullif(trim(s.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(s.staff_name), '') as staff_name,
      coalesce(s.branch_id, app.resolve_branch(s.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(s.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0,
      s.install, s.replace, s.qr,
      0, 0
    from public.qr_monthly_summary s
    where s.month < (v_keep at time zone 'Asia/Phnom_Penh')::date
      and s.month >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months')::date

    union all

    select
      (c.submitted_at at time zone 'Asia/Phnom_Penh')::date as d,
      coalesce(nullif(trim(c.staff_id), ''), 'UNKNOWN') as staff_id,
      nullif(trim(c.staff_name), '') as staff_name,
      coalesce(c.branch_id, app.resolve_branch(c.branch_text), 'UNASSIGNED') as branch_id,
      nullif(trim(c.branch_text), '') as branch_text,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      (case when c.request_type <> 'Add Supplementary Only' and c.card_status = 'Onboarded Successfully' then 1 else 0 end) as cc_primary,
      jsonb_array_length(c.supplementary) as cc_supp
    from public.cc_entries c
    where c.review_status = 'CONFIRMED'
      and c.submitted_at >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh') - interval '24 months') at time zone 'Asia/Phnom_Penh'
  ),
  daily_agg as (
    select
      d::text as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    where d >= ((now() at time zone 'Asia/Phnom_Penh')::date - 29)
    group by d
    order by d desc
  ),
  weekly_agg as (
    select
      date_trunc('week', d::timestamp)::date::text as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    where d >= (date_trunc('week', now() at time zone 'Asia/Phnom_Penh')::date - interval '11 weeks')::date
    group by 1
    order by 1 desc
  ),
  monthly_agg as (
    select
      to_char(date_trunc('month', d::timestamp), 'YYYY-MM') as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    where d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '11 months')::date
    group by 1
    order by 1 desc
  ),
  quarterly_agg as (
    select
      to_char(date_trunc('quarter', d::timestamp), 'YYYY-"Q"Q') as period,
      count(distinct branch_id)::int as active_branches,
      count(distinct staff_id)::int as active_staff,
      sum(pos_install)::int as pos_install, sum(pos_replace)::int as pos_replace, sum(pos_battery)::int as pos_battery,
      sum(sb_install)::int as sb_install, sum(sb_replace)::int as sb_replace, sum(sb_maint)::int as sb_maint, sum(sb_return)::int as sb_return,
      sum(khqr_install)::int as khqr_install, sum(khqr_replace)::int as khqr_replace, sum(khqr_materials)::int as khqr_materials,
      sum(cc_primary)::int as cc_primary, sum(cc_supp)::int as cc_supp
    from timed_events
    group by 1
    order by 1 desc
    limit 8
  ),
  m_staff as (
    select
      to_char(date_trunc('month', t.d::timestamp), 'YYYY-MM') as month,
      t.staff_id,
      coalesce(max(sp.name), max(t.staff_name), t.staff_id) as staff_name,
      coalesce(max(sp.branch_id), max(nullif(t.branch_id, 'UNASSIGNED')), 'UNASSIGNED') as branch_id,
      coalesce(max(b.name), max(t.branch_text), 'Unassigned') as branch_name,
      sum(t.pos_install)::int as pos_install, sum(t.pos_replace)::int as pos_replace, sum(t.pos_battery)::int as pos_battery,
      sum(t.sb_install)::int as sb_install, sum(t.sb_replace)::int as sb_replace, sum(t.sb_maint)::int as sb_maint, sum(t.sb_return)::int as sb_return,
      sum(t.khqr_install)::int as khqr_install, sum(t.khqr_replace)::int as khqr_replace, sum(t.khqr_materials)::int as khqr_materials,
      sum(t.cc_primary)::int as cc_primary, sum(t.cc_supp)::int as cc_supp
    from timed_events t
    left join public.staff_profiles sp on sp.emp_id = t.staff_id
    left join public.branches b on b.id = coalesce(sp.branch_id, nullif(t.branch_id, 'UNASSIGNED'))
    where t.d >= (date_trunc('month', now() at time zone 'Asia/Phnom_Penh')::date - interval '11 months')::date
    group by 1, 2
  )
  select
    coalesce((select jsonb_agg(to_jsonb(x)) from daily_agg x), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(x)) from weekly_agg x), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(x)) from monthly_agg x), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(x)) from quarterly_agg x), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(x)) from m_staff x), '[]'::jsonb)
  into v_daily, v_weekly, v_monthly, v_quarterly, v_monthly_staff;

  return jsonb_build_object(
    'rules', v_rules,
    'targets', v_targets,
    'staff', v_staff,
    'daily', v_daily,
    'weekly', v_weekly,
    'monthly', v_monthly,
    'quarterly', v_quarterly,
    'monthly_staff', v_monthly_staff
  );
end $$;

revoke all on function public.kpi_save_rule(jsonb), public.kpi_delete_rule(text), public.kpi_save_targets(jsonb), public.kpi_dashboard_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.kpi_save_rule(jsonb), public.kpi_delete_rule(text), public.kpi_save_targets(jsonb), public.kpi_dashboard_summary(timestamptz, timestamptz) to authenticated, service_role;
