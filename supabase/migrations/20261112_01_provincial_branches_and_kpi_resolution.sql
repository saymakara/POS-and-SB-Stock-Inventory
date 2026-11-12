-- Migration: 20261112_01_provincial_branches_and_kpi_resolution.sql
-- 1. Insert provincial branches and special branches
INSERT INTO public.branches (id, code, name, region, active)
VALUES
  ('135', '135', 'GDT Branch', 'Phnom Penh', true),
  ('901', '901', 'Special Shift', 'Phnom Penh', true),
  ('202', '202', 'Preah Vihear Provincial Branch', 'Provincial', true),
  ('301', '301', 'Kratie Provincial Branch', 'Provincial', true),
  ('302', '302', 'Ratanak Kiri Provincial Branch', 'Provincial', true),
  ('303', '303', 'Mondul Kiri Branch', 'Provincial', true),
  ('311', '311', 'Snuol District Branch', 'Provincial', true),
  ('401', '401', 'Preah Sihanouk Provincial Branch', 'Provincial', true),
  ('402', '402', 'Krong Ta Khmau Branch', 'Provincial', true),
  ('403', '403', 'Takeo Provincial Branch', 'Provincial', true),
  ('404', '404', 'Kampong Speu Branch', 'Provincial', true),
  ('405', '405', 'Kampot Provincial Branch', 'Provincial', true),
  ('406', '406', 'Svay Rieng Branch', 'Provincial', true),
  ('407', '407', 'Prey Veng Provincial Branch', 'Provincial', true),
  ('408', '408', 'Koh Kong Branch', 'Provincial', true),
  ('409', '409', 'Kep Provincial Branch', 'Provincial', true),
  ('411', '411', 'Prey Nob District Branch', 'Provincial', true),
  ('412', '412', 'Kandal Stueng District Branch', 'Provincial', true),
  ('413', '413', 'Tram Kok District Branch', 'Provincial', true),
  ('414', '414', 'Samraong Tong District Branch', 'Provincial', true),
  ('415', '415', 'Chhuk District Branch', 'Provincial', true),
  ('416', '416', 'Krong Bavet Branch', 'Provincial', true),
  ('417', '417', 'Peam Ro District Branch', 'Provincial', true),
  ('418', '418', 'Srae Ambel Branch', 'Provincial', true),
  ('421', '421', 'Krong Kampong Soam Branch', 'Provincial', true),
  ('422', '422', 'Sang District Branch', 'Provincial', true),
  ('423', '423', 'Bati District Branch', 'Provincial', true),
  ('424', '424', 'Oudongk District Branch', 'Provincial', true),
  ('425', '425', 'Angkor Chey District Branch', 'Provincial', true),
  ('426', '426', 'Svay Chrum District Branch', 'Provincial', true),
  ('427', '427', 'Pea Reang District Branch', 'Provincial', true),
  ('432', '432', 'Kien Svay District Branch', 'Provincial', true),
  ('433', '433', 'Bati (Samrong Yaong) District Branch', 'Provincial', true),
  ('435', '435', 'Kampong Trach District Branch', 'Provincial', true),
  ('442', '442', 'Angk Snuol District Branch', 'Provincial', true),
  ('443', '443', 'Kiri Vong District Branch', 'Provincial', true),
  ('452', '452', 'Mukh Kampul District Branch', 'Provincial', true),
  ('462', '462', 'Kaoh Thom District Branch', 'Provincial', true),
  ('501', '501', 'Kampong Cham Provincial Branch', 'Provincial', true),
  ('502', '502', 'Kampong Thom Provincial Branch', 'Provincial', true),
  ('503', '503', 'Kampong Chhnang Branch', 'Provincial', true),
  ('511', '511', 'Cheung Prey District Branch', 'Provincial', true),
  ('512', '512', 'Baray District Branch', 'Provincial', true),
  ('513', '513', 'Kampong Tralach District Branch', 'Provincial', true),
  ('514', '514', 'Memot District Branch', 'Provincial', true),
  ('521', '521', 'Prey Chhor District Branch', 'Provincial', true),
  ('522', '522', 'Stoung District Branch', 'Provincial', true),
  ('531', '531', 'Chamkar Leu District Branch', 'Provincial', true),
  ('541', '541', 'Steung Trang District Branch', 'Provincial', true),
  ('601', '601', 'Siem Reap Provincial Branch', 'Provincial', true),
  ('602', '602', 'Battambang Provincial Branch', 'Provincial', true),
  ('603', '603', 'Pursat Provincial Branch', 'Provincial', true),
  ('604', '604', 'Krong Paoy Paet Branch', 'Provincial', true),
  ('605', '605', 'Banteay Meanchey Provincial Branch', 'Provincial', true),
  ('606', '606', 'Pailin Provincial Branch', 'Provincial', true),
  ('611', '611', 'Krong Siemreap (Phsar Leu) Branch', 'Provincial', true),
  ('612', '612', 'Thma Koul District Branch', 'Provincial', true),
  ('613', '613', 'Bakan District Branch', 'Provincial', true),
  ('615', '615', 'Mongkol Borei District Branch', 'Provincial', true),
  ('621', '621', 'Krong Siem Reap (Angkor) Branch', 'Provincial', true),
  ('622', '622', 'Moung Ruessei District Branch', 'Provincial', true),
  ('625', '625', 'Preah Netr Preah District Branch', 'Provincial', true),
  ('631', '631', 'Soutr Nikom District Branch', 'Provincial', true),
  ('632', '632', 'Krong Battambang Branch', 'Provincial', true),
  ('641', '641', 'Pouk District Branch', 'Provincial', true),
  ('642', '642', 'Bavel District Branch', 'Provincial', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  region = EXCLUDED.region,
  active = EXCLUDED.active;

-- 2. Insert aliases
INSERT INTO public.branch_aliases (alias_norm, branch_id)
VALUES
  ('gdtbranch', '135'),
  ('gdt', '135'),
  ('specialshift', '901')
ON CONFLICT (alias_norm) DO NOTHING;

INSERT INTO public.branch_aliases (alias_norm, branch_id)
SELECT DISTINCT app.norm(branch_text), substring(branch_text from '^([0-9]{3})')
FROM (
  SELECT branch_text FROM public.field_events WHERE branch_text IS NOT NULL
  UNION SELECT branch_text FROM public.qr_installations WHERE branch_text IS NOT NULL
  UNION SELECT branch_text FROM public.cc_entries WHERE branch_text IS NOT NULL
  UNION SELECT branch_text FROM public.mv_visits WHERE branch_text IS NOT NULL
) b
WHERE substring(branch_text from '^([0-9]{3})') IS NOT NULL
ON CONFLICT (alias_norm) DO NOTHING;

-- 3. Update app.resolve_branch
CREATE OR REPLACE FUNCTION app.resolve_branch(t text)
 RETURNS character varying
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text; v_id varchar;
begin
  if coalesce(trim(t), '') = '' then return null; end if;
  v_code := substring(t from '^([0-9]{3})');
  if v_code is null then
    v_code := substring(t from '([0-9]{3})');
  end if;
  if v_code is not null then
    select b.id into v_id from public.branches b where b.id = v_code or b.code = v_code limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  select a.branch_id into v_id from public.branch_aliases a where a.alias_norm = app.norm(t);
  if v_id is not null then return v_id; end if;
  select b.id into v_id from public.branches b where app.norm(b.name) = app.norm(t) limit 1;
  return v_id;
end $function$;

-- 4. Backfill branch_id across event tables
UPDATE public.field_events
SET branch_id = app.resolve_branch(branch_text)
WHERE branch_id IS NULL AND branch_text IS NOT NULL AND app.resolve_branch(branch_text) IS NOT NULL;

UPDATE public.qr_installations
SET branch_id = app.resolve_branch(branch_text)
WHERE branch_id IS NULL AND branch_text IS NOT NULL AND app.resolve_branch(branch_text) IS NOT NULL;

UPDATE public.cc_entries
SET branch_id = app.resolve_branch(branch_text)
WHERE branch_id IS NULL AND branch_text IS NOT NULL AND app.resolve_branch(branch_text) IS NOT NULL;

UPDATE public.mv_visits
SET branch_id = app.resolve_branch(branch_text)
WHERE branch_id IS NULL AND branch_text IS NOT NULL AND app.resolve_branch(branch_text) IS NOT NULL;
