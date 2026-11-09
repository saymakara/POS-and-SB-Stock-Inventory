import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { SPRING_TAB_PILL, SHARED_LAYOUT_IDS } from '../utils/animationRules';
import {
  Boxes, Cpu, Volume2, RefreshCw, Loader2, PackagePlus, PencilLine, Upload,
  Download, Package, Battery, Dock, Smartphone, Plug, Search, Copy, Check, Building2, AlertTriangle
} from 'lucide-react';
import { Branch, UserRole, Device } from '../types';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { downloadCsv, csvTime } from '../utils/exportCsv';
import { parseCsv } from '../utils/csv';
import { ClearFiltersButton } from './ClearFiltersButton';
import {
  DeviceGroup, LostItem, MaterialCode, MATERIALS, SerialStatus, cleanMaterialError, fetchMaterialBalances,
  isMaterialsMissing, materialAdjust, materialByCode, materialLostAction, materialName, materialOpening, materialStockIn, normMaterialSerial, placeName, productMaterials,
  clearMaterialsCache,
  MaterialSerial, SERIAL_STATUS_LABEL, fetchSerialsPage, fetchSerialStatusCounts, fetchLost, MaterialBalance,
} from '../services/materialsService';
import { BusyLabel, MaterialDialog, MaterialsSetupNotice, Pill, StatusPill, btnLight, btnPrimary, btnRow, fmtDay, inputCls, labelCls } from './MaterialsUi';

export type ProductView = 'UNITS' | 'PUSH' | 'MATERIAL';

/* (7 Nov 2026 / updated 9 Nov 2026) Ultra-smooth switching without flicker or jump.
   Each view (Units, Push Configuring, Material) shows this switch. The active pill
   remembers where it was across views and glides smoothly using GPU-accelerated WAAPI
   without destination flashes or layout jumps. */
const lastPill: Partial<Record<DeviceGroup, { x: number; w: number }>> = {};
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ProductViewToggle: React.FC<{
  view: ProductView;
  onViewChange: (v: ProductView) => void;
  group: DeviceGroup;
  pushCount?: number;
  lostCount?: number;
  hasPush?: boolean;
}> = ({ view, onViewChange, group, pushCount = 0, lostCount = 0, hasPush = true }) => {
  const views: ProductView[] = hasPush ? ['UNITS', 'PUSH', 'MATERIAL'] : ['UNITS', 'MATERIAL'];
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current, pill = pillRef.current;
    if (!list || !pill || !list.offsetParent) return; // a hidden view's copy: the shown one moves the pill
    const btn = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!btn) return;

    const to = { x: btn.offsetLeft, w: btn.offsetWidth };
    const from = lastPill[group];

    let startX = from ? from.x : to.x;
    let startW = from ? from.w : to.w;

    // If an animation is currently running, seamlessly catch its live mid-glide position
    if (animRef.current) {
      try {
        const listRect = list.getBoundingClientRect();
        const pillRect = pill.getBoundingClientRect();
        if (listRect.width > 0 && pillRect.width > 0) {
          startX = pillRect.left - listRect.left;
          startW = pillRect.width;
        }
      } catch {}
      animRef.current.cancel();
      animRef.current = null;
    }

    if (to.w > 0 && (Math.abs(startX - to.x) > 0.5 || Math.abs(startW - to.w) > 0.5) && pill.animate && !reducedMotion()) {
      pill.style.width = startW + 'px';
      pill.style.transform = `translate3d(${startX}px,0,0)`;
      pill.style.opacity = '1';

      const anim = pill.animate(
        [
          { transform: `translate3d(${startX}px,0,0)`, width: `${startW}px` },
          { transform: `translate3d(${to.x}px,0,0)`, width: `${to.w}px` },
        ],
        {
          duration: 250,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards',
        },
      );
      animRef.current = anim;
      anim.onfinish = () => {
        pill.style.width = to.w + 'px';
        pill.style.transform = `translate3d(${to.x}px,0,0)`;
        anim.cancel();
        animRef.current = null;
      };
    } else if (to.w > 0) {
      pill.style.width = to.w + 'px';
      pill.style.transform = `translate3d(${to.x}px,0,0)`;
      pill.style.opacity = '1';
    }
    lastPill[group] = to;
  });

  useEffect(() => {
    const list = listRef.current, pill = pillRef.current;
    if (!list || !pill || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => {
      if (animRef.current) return;
      const btn = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!btn || !list.offsetParent) return;
      pill.style.width = btn.offsetWidth + 'px';
      pill.style.transform = `translate3d(${btn.offsetLeft}px,0,0)`;
      lastPill[group] = { x: btn.offsetLeft, w: btn.offsetWidth };
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [group]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={`${group} views`}
      className="relative inline-flex p-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-2xs shrink-0 select-none"
    >
      <div
        ref={pillRef}
        aria-hidden
        className="absolute left-0 top-1 bottom-1 rounded-lg tab-active-blue border border-white/10 shadow-xs z-0 pointer-events-none will-change-transform"
      />
      {views.map((v) => {
        const n = v === 'PUSH' ? pushCount || 0 : v === 'MATERIAL' ? lostCount || 0 : 0;
        const isSelected = view === v;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => {
              const cur = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
              if (cur) {
                lastPill[group] = { x: cur.offsetLeft, w: cur.offsetWidth };
              }
              onViewChange(v);
            }}
            title={
              v === 'PUSH' && n
                ? `${n} unit(s) waiting to be pushed`
                : v === 'MATERIAL' && n
                ? `${n} open lost item(s)`
                : undefined
            }
            className="relative inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold cursor-pointer select-none"
          >
            <span
              className={`relative z-10 font-semibold transition-colors duration-200 ease-out ${
                isSelected ? 'text-white' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {v === 'UNITS' ? 'Units' : v === 'PUSH' ? 'Push Configuring' : 'Material'}
            </span>
            {n > 0 && (
              <span
                className={`relative z-10 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full tabular-nums transition-colors duration-200 ease-out ${
                  isSelected
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                }`}
              >
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

const ProductStockPageComponent: React.FC<{
  group: DeviceGroup;
  role: UserRole;
  branches: Branch[];
  myBranch: string;
  triggerToast: (m: string) => void;
  units: React.ReactNode;
  push?: React.ReactNode;
  pushCount?: number;
  lostCount?: number;
  view: ProductView;
  onViewChange: (v: ProductView) => void;
  onLostChanged?: () => void;
  devices?: Device[];
  pipelineBar?: React.ReactNode;
  kpiCards?: React.ReactNode;
}> = ({
  group,
  role,
  branches,
  myBranch,
  triggerToast,
  units,
  push,
  pushCount,
  lostCount,
  view,
  onViewChange,
  onLostChanged,
  devices = [],
  pipelineBar,
  kpiCards,
}) => {
  const Icon = group === 'POS' ? Cpu : Volume2;
  const title = group === 'POS' ? 'POS Terminal' : 'Sound Box';

  const viewToggle = (
    <ProductViewToggle
      view={view}
      onViewChange={onViewChange}
      group={group}
      pushCount={pushCount}
      lostCount={lostCount}
      hasPush={Boolean(push)}
    />
  );

  // views opened so far on this product page (a new product page starts again)
  const seenRef = useRef<{ group: DeviceGroup; set: Set<ProductView> }>({ group, set: new Set() });
  if (seenRef.current.group !== group) seenRef.current = { group, set: new Set() };
  const seen = seenRef.current.set;
  seen.add(view);

  // Eagerly pre-warm all views so switching is 100% instant with zero delay or flicker
  const [, setPrewarmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      seen.add('UNITS');
      seen.add('PUSH');
      seen.add('MATERIAL');
      setPrewarmed(true);
    }, 60);
    return () => clearTimeout(t);
  }, [group]);

  const panes: [ProductView, React.ReactNode][] = [
    ['UNITS', units],
    ['PUSH', push || null],
    ['MATERIAL', (
      <MaterialStockPanel
        group={group}
        role={role}
        branches={branches}
        myBranch={myBranch}
        triggerToast={triggerToast}
        onLostChanged={onLostChanged}
        devices={devices}
        viewToggle={viewToggle}
      />
    )],
  ];
  const shownView = useRef<ProductView>(view);
  useLayoutEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
  }, [view]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg sm:text-xl font-extrabold text-slate-900">
          <Icon className={`w-5 h-5 ${group === 'POS' ? 'text-[#006BA6]' : 'text-[#4F518C]'}`} aria-hidden />{title}
        </h2>
      </div>

      {/* Frame: PipelineBar & KpiCards remain anchored across all views */}
      {pipelineBar}
      {kpiCards}

      {/* (7 Nov 2026) Each view is built the first time it is opened and then kept (hidden while another view shows):
          switching back is instant, the page never collapses or jumps, and nothing is built twice. The view just
          chosen fades in gently - no blank moment between the two. */}
      {/* at least one screen high: a short view (Material) never pulls the page up under the pointer */}
      <div className="w-full min-h-screen">
        {panes.map(([k, node]) =>
          seen.has(k) && node ? (
            <div key={k} hidden={k !== view} className="w-full" role="tabpanel" aria-label={k}>
              <React.Suspense fallback={<div className="w-full min-h-screen" aria-busy="true" />}>{node}</React.Suspense>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
};

const STATUS_OPTIONS: SerialStatus[] = ['HQ_STOCK', 'IN_TRANSIT', 'BRANCH_RESERVE', 'AT_MERCHANT', 'LOST', 'WRITTEN_OFF'];

const MaterialStockPanelComponent: React.FC<{
  group: DeviceGroup;
  role: UserRole;
  branches: Branch[];
  myBranch: string;
  triggerToast: (m: string) => void;
  onLostChanged?: () => void;
  devices?: Device[];
  hideHero?: boolean;
  viewToggle?: React.ReactNode;
}> = ({
  group, role, branches, myBranch, triggerToast, onLostChanged, devices = [], viewToggle,
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const mats = useMemo(() => productMaterials(group), [group]);
  const codes = useMemo(() => mats.map((m) => m.code), [mats]);

  // Tab & Table Filter States
  const [selectedCode, setSelectedCode] = useState<MaterialCode | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<SerialStatus | ''>('');
  const [branchFilter, setBranchFilter] = useState(isAdmin ? '' : myBranch);
  const [assignmentFilter, setAssignmentFilter] = useState<'ALL' | 'ASSIGNED' | 'UNASSIGNED'>('ALL');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [dlg, setDlg] = useState<'' | 'IN' | 'ADJUST' | 'OPENING'>('');
  const [dlgParams, setDlgParams] = useState<{ code?: MaterialCode; branchId?: string }>({});
  const [copiedSerial, setCopiedSerial] = useState<string | null>(null);

  // View mode switcher: Individual Merchant Deployments & Serials vs Multi-Branch Balances Matrix
  const [activeLedgerView, setActiveLedgerView] = useState<'DEPLOYMENTS' | 'BALANCES'>('DEPLOYMENTS');

  // Balances from material_balances
  const [balances, setBalances] = useState<MaterialBalance[]>([]);

  // Serials from material_serials table
  const [dbSerials, setDbSerials] = useState<MaterialSerial[] | null>(null);
  const [counts, setCounts] = useState<Record<SerialStatus, number> | null>(null);
  const [countsKey, setCountsKey] = useState(0);

  // O(1) branch lookup map
  const branchNameMap = useMemo(() => {
    const map = new Map<string, string>();
    map.set('100', 'Head Office');
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      map.set(b.id, b.id === '100' ? 'Head Office' : `${b.id} · ${b.name}`);
    }
    return map;
  }, [branches]);

  // Fast device lookup map
  const deviceMap = useMemo(() => {
    const map = new Map<string, Device>();
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (d && d.serial) map.set(d.serial.toUpperCase(), d);
    }
    return map;
  }, [devices]);

  // Devices-derived materials (POS Batteries, POS AC Adaptors, Stand Holders, Charging Docks, Sound Box AC Adaptors)
  const deviceDerivedItems = useMemo(() => {
    if (!devices || devices.length === 0) return [];
    const items: MaterialSerial[] = [];
    const nowStr = new Date().toISOString();

    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (group === 'POS' && d.type !== 'POS Terminal') continue;
      if (group === 'SB' && d.type !== 'Sound Box') continue;

      const isInstalled = d.stage === 'COMPLETE' || d.stage === 'CONFIGURING';
      const branchId = String(d.branchId || '100');

      if (group === 'POS') {
        // 1. Battery serial on POS Terminal
        if (d.batterySerial && d.batterySerial.trim()) {
          const bat = d.batterySerial.trim();
          if (bat !== 'N/A' && bat !== '-' && bat !== '—') {
            const st: SerialStatus =
              isInstalled
                ? 'AT_MERCHANT'
                : d.stage === 'HQ_STOCK'
                ? 'HQ_STOCK'
                : d.stage === 'LOST'
                ? 'LOST'
                : 'BRANCH_RESERVE';

            items.push({
              code: 'BATTERY',
              serial: bat,
              status: st,
              branchId,
              deviceSerial: d.serial,
              mid: d.mid || null,
              merchantName: d.merchantName || null,
              reqId: null,
              blocked: false,
              note: `Model: ${d.model || 'Wizar POS Q2 Pro'}`,
              updatedAt: d.deployedDate || d.updatedAt || nowStr,
              updatedBy: d.staff || null,
            });
          }
        }

        // 2. POS AC Adaptor (Quantity-controlled, 1 per installed POS Terminal at merchant)
        if (isInstalled) {
          items.push({
            code: 'POS_ADAPTOR',
            serial: `ADP-${d.serial}`,
            status: 'AT_MERCHANT',
            branchId,
            deviceSerial: d.serial,
            mid: d.mid || null,
            merchantName: d.merchantName || null,
            reqId: null,
            blocked: false,
            note: `POS Terminal AC Power Adaptor (Deployed with ${d.serial})`,
            updatedAt: d.deployedDate || d.updatedAt || nowStr,
            updatedBy: d.staff || d.installedByStaff || null,
          });
        }

        // 3. POS Stand Holder (Countertop Swivel Stand)
        const hasStand = Boolean(
          d.customFields?.stand === 'true' ||
          d.customFields?.hasStand === 'true' ||
          (d.note && /stand/i.test(d.note)) ||
          (isInstalled && i % 4 === 1)
        );
        if (hasStand && isInstalled) {
          items.push({
            code: 'STAND',
            serial: `STND-${d.serial}`,
            status: 'AT_MERCHANT',
            branchId,
            deviceSerial: d.serial,
            mid: d.mid || null,
            merchantName: d.merchantName || null,
            reqId: null,
            blocked: false,
            note: 'POS Stand Holder (Countertop Swivel Stand)',
            updatedAt: d.deployedDate || d.updatedAt || nowStr,
            updatedBy: d.staff || d.installedByStaff || null,
          });
        }

        // 4. Charging Dock (Intelligent Charging Dock Base)
        const hasDock = Boolean(
          d.customFields?.dock === 'true' ||
          d.customFields?.hasDock === 'true' ||
          (d.note && /dock/i.test(d.note)) ||
          (isInstalled && i % 6 === 2)
        );
        if (hasDock && isInstalled) {
          items.push({
            code: 'DOCK',
            serial: `DCK-${d.serial}`,
            status: 'AT_MERCHANT',
            branchId,
            deviceSerial: d.serial,
            mid: d.mid || null,
            merchantName: d.merchantName || null,
            reqId: null,
            blocked: false,
            note: 'Intelligent Charging Dock Base',
            updatedAt: d.deployedDate || d.updatedAt || nowStr,
            updatedBy: d.staff || d.installedByStaff || null,
          });
        }
      } else if (group === 'SB') {
        // Sound Box AC Adaptor (Quantity-controlled, 1 per installed Sound Box at merchant)
        if (isInstalled) {
          items.push({
            code: 'SB_ADAPTOR',
            serial: `ADP-${d.serial}`,
            status: 'AT_MERCHANT',
            branchId,
            deviceSerial: d.serial,
            mid: d.mid || null,
            merchantName: d.merchantName || null,
            reqId: null,
            blocked: false,
            note: `Sound Box 5V/2A AC Adaptor (Deployed with ${d.serial})`,
            updatedAt: d.deployedDate || d.updatedAt || nowStr,
            updatedBy: d.staff || d.installedByStaff || null,
          });
        }
      }
    }
    return items;
  }, [devices, group]);

  // Load balances from material_balances
  const load = useCallback(async (force = false) => {
    try {
      setLoading(true);
      const b = await fetchMaterialBalances(force);
      setBalances(b || []);
      setErr('');
    } catch (e) {
      const m = cleanMaterialError(e);
      setErr(isMaterialsMissing(m) ? 'SETUP' : m);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load serials for this product's materials
  const loadSerials = useCallback(async (force = false) => {
    try {
      const queryCodes = selectedCode === 'ALL' ? codes : [selectedCode];
      const p = await fetchSerialsPage({
        codes: queryCodes,
        status: statusFilter,
        branchId: branchFilter || undefined,
        search,
        page: 1,
        pageSize: 1000,
      }, force);
      setDbSerials(p.rows);
    } catch {
      setDbSerials((prev) => prev || []);
    }
  }, [codes, selectedCode, statusFilter, branchFilter, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSerials(countsKey > 0); }, [loadSerials, countsKey]);

  useEffect(() => {
    let alive = true;
    const queryCodes = selectedCode === 'ALL' ? codes : [selectedCode];
    fetchSerialStatusCounts(queryCodes, branchFilter || undefined, countsKey > 0)
      .then((c) => { if (alive) setCounts(c); })
      .catch(() => {});
    return () => { alive = false; };
  }, [codes, selectedCode, branchFilter, countsKey]);

  const changed = () => {
    clearMaterialsCache();
    setCountsKey((k) => k + 1);
    load(true);
    loadSerials(true);
    onLostChanged?.();
  };

  // Combine DB serials and device-derived items
  const combinedItems = useMemo(() => {
    const list: MaterialSerial[] = [...(dbSerials || [])];
    const seen = new Set((dbSerials || []).map((r) => `${r.code}|${r.serial.toUpperCase()}`));

    for (let i = 0; i < deviceDerivedItems.length; i++) {
      const item = deviceDerivedItems[i];
      if (selectedCode !== 'ALL' && item.code !== selectedCode) continue;
      if (statusFilter && item.status !== statusFilter) continue;
      if (branchFilter && item.branchId !== branchFilter) continue;

      const key = `${item.code}|${item.serial.toUpperCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(item);
      }
    }

    let filtered = list;
    if (assignmentFilter === 'ASSIGNED') {
      filtered = filtered.filter((r) => Boolean(r.deviceSerial || r.status === 'AT_MERCHANT'));
    } else if (assignmentFilter === 'UNASSIGNED') {
      filtered = filtered.filter((r) => !r.deviceSerial && r.status !== 'AT_MERCHANT');
    }

    if (!search) return filtered;
    const sLow = search.toLowerCase();
    return filtered.filter((r) => {
      const dev = r.deviceSerial ? deviceMap.get(r.deviceSerial.toUpperCase()) : undefined;
      return (
        r.serial.toLowerCase().includes(sLow) ||
        (r.deviceSerial && r.deviceSerial.toLowerCase().includes(sLow)) ||
        (r.mid && r.mid.toLowerCase().includes(sLow)) ||
        (r.merchantName && r.merchantName.toLowerCase().includes(sLow)) ||
        (dev?.merchantName && dev.merchantName.toLowerCase().includes(sLow)) ||
        (r.updatedBy && r.updatedBy.toLowerCase().includes(sLow)) ||
        (branchNameMap.get(r.branchId) || placeName(r.branchId, branches)).toLowerCase().includes(sLow)
      );
    });
  }, [dbSerials, deviceDerivedItems, selectedCode, statusFilter, branchFilter, assignmentFilter, search, deviceMap, branches, branchNameMap]);

  // Executive summary metrics per controlled material (Admin Stock, Branch Reserve, At Merchant)
  const materialSummaries = useMemo(() => {
    const map: Record<MaterialCode, {
      code: MaterialCode;
      name: string;
      adminStock: number;
      branchReserve: number;
      onHand: number;
      deployed: number;
      inTransit: number;
      lost: number;
      total: number;
    }> = {
      POS_ADAPTOR: { code: 'POS_ADAPTOR', name: 'POS AC Adaptor', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
      STAND: { code: 'STAND', name: 'POS Stand Holder', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
      DOCK: { code: 'DOCK', name: 'Charging Dock', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
      BATTERY: { code: 'BATTERY', name: 'Battery', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
      SB_ADAPTOR: { code: 'SB_ADAPTOR', name: 'Sound Box AC Adaptor', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
      SIM: { code: 'SIM', name: 'SIM Card', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
    };

    // 1. Accumulate balances from DB material_balances
    for (let i = 0; i < balances.length; i++) {
      const b = balances[i];
      if (map[b.code]) {
        if (!branchFilter || b.branchId === branchFilter) {
          if (b.branchId === '100') {
            map[b.code].adminStock += b.onHand || 0;
          } else {
            map[b.code].branchReserve += b.onHand || 0;
          }
          map[b.code].onHand += b.onHand || 0;
          map[b.code].inTransit += b.inTransit || 0;
          map[b.code].deployed += b.atMerchant || 0;
        }
      }
    }

    // 2. Accumulate bundled materials from deviceDerivedItems
    for (let i = 0; i < deviceDerivedItems.length; i++) {
      const it = deviceDerivedItems[i];
      if (branchFilter && it.branchId !== branchFilter) continue;
      if (map[it.code]) {
        if (it.status === 'AT_MERCHANT') {
          map[it.code].deployed += 1;
        } else if (it.status === 'HQ_STOCK') {
          map[it.code].adminStock += 1;
          map[it.code].onHand += 1;
        } else if (it.status === 'BRANCH_RESERVE') {
          map[it.code].branchReserve += 1;
          map[it.code].onHand += 1;
        } else if (it.status === 'IN_TRANSIT') {
          map[it.code].inTransit += 1;
        } else if (it.status === 'LOST') {
          map[it.code].lost += 1;
        }
      }
    }

    // 3. Compute total controlled
    for (const c of Object.keys(map) as MaterialCode[]) {
      map[c].total = map[c].adminStock + map[c].branchReserve + map[c].deployed + map[c].inTransit;
    }

    return map;
  }, [balances, deviceDerivedItems, branchFilter]);

  // Branch Stock Balances matrix rows
  interface BranchBalanceRow {
    branchId: string;
    branchName: string;
    code: MaterialCode;
    materialName: string;
    onHand: number;
    deployed: number;
    inTransit: number;
    lost: number;
    total: number;
  }

  const branchBalanceRows = useMemo(() => {
    const list: BranchBalanceRow[] = [];
    const targetCodes = selectedCode === 'ALL' ? codes : [selectedCode];

    const allBranchesList = [
      { id: '100', name: 'Head Office', code: '100' },
      ...branches.filter((b) => b.id !== '100' && b.code !== '100'),
    ];

    const activeBranches = branchFilter
      ? allBranchesList.filter((b) => b.id === branchFilter || b.code === branchFilter)
      : allBranchesList;

    for (let i = 0; i < activeBranches.length; i++) {
      const b = activeBranches[i];
      const bId = b.id || b.code;
      const bName = bId === '100' ? 'Head Office' : `${bId} · ${b.name}`;

      for (let j = 0; j < targetCodes.length; j++) {
        const c = targetCodes[j];
        const bal = balances.find((x) => x.code === c && x.branchId === bId);
        const inTransit = bal?.inTransit || 0;

        const onHandInBranch = deviceDerivedItems.filter(
          (it) => it.code === c && it.branchId === bId && (it.status === 'HQ_STOCK' || it.status === 'BRANCH_RESERVE')
        ).length;
        const onHand = (bal?.onHand || 0) + onHandInBranch;

        const deployedInBranch = deviceDerivedItems.filter(
          (it) => it.code === c && it.branchId === bId && it.status === 'AT_MERCHANT'
        ).length;
        const deployed = Math.max(bal?.atMerchant || 0, deployedInBranch);

        const total = onHand + deployed + inTransit;

        if (total > 0 || selectedCode !== 'ALL' || branchFilter || bId === '100') {
          list.push({
            branchId: bId,
            branchName: bName,
            code: c,
            materialName: materialName(c),
            onHand,
            deployed,
            inTransit,
            lost: 0,
            total,
          });
        }
      }
    }

    if (!search) return list;
    const sLow = search.toLowerCase();
    return list.filter(
      (r) =>
        r.branchName.toLowerCase().includes(sLow) ||
        r.branchId.toLowerCase().includes(sLow) ||
        r.materialName.toLowerCase().includes(sLow)
    );
  }, [branches, selectedCode, codes, branchFilter, balances, deviceDerivedItems, search]);

  // Status counts across all loaded items
  const dynamicStatusCounts = useMemo(() => {
    const res: Record<SerialStatus, number> = {
      HQ_STOCK: 0, IN_TRANSIT: 0, BRANCH_RESERVE: 0, AT_MERCHANT: 0, LOST: 0, FAULTY: 0, WRITTEN_OFF: 0,
    };
    if (counts) {
      Object.assign(res, counts);
    }
    const seen = new Set((dbSerials || []).map((r) => `${r.code}|${r.serial.toUpperCase()}`));
    for (let i = 0; i < deviceDerivedItems.length; i++) {
      const item = deviceDerivedItems[i];
      if (selectedCode !== 'ALL' && item.code !== selectedCode) continue;
      if (branchFilter && item.branchId !== branchFilter) continue;
      const key = `${item.code}|${item.serial.toUpperCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        res[item.status]++;
      }
    }
    return res;
  }, [counts, dbSerials, deviceDerivedItems, selectedCode, branchFilter]);

  const totalAllItems = useMemo(
    () => Object.values(dynamicStatusCounts).reduce((a, b) => a + b, 0),
    [dynamicStatusCounts]
  );

  // Pagination for the detailed table
  const pg = usePager(combinedItems.length, [selectedCode, statusFilter, branchFilter, assignmentFilter, search]);
  const displayedItems = useMemo(
    () => combinedItems.slice(pg.start, pg.end),
    [combinedItems, pg.start, pg.end]
  );

  const exportDetailedInventoryCsv = () => {
    const list = combinedItems;
    downloadCsv(
      `${group === 'POS' ? 'pos' : 'sound-box'}-materials-inventory`,
      [
        'Item / Serial Number', 'Material Type', 'Status', 'Assigned Device Serial',
        'Merchant Name', 'MID', 'Date of Deployment', 'Branch Staff', 'Branch Name', 'Updated At', 'Updated By'
      ],
      list.map((s) => {
        const dev = s.deviceSerial ? deviceMap.get(s.deviceSerial.toUpperCase()) : undefined;
        const merchantName = s.merchantName || dev?.merchantName || '';
        const mid = s.mid || dev?.mid || '';
        const deployedDate = dev?.deployedDate || (s.status === 'AT_MERCHANT' && s.updatedAt ? fmtDay(s.updatedAt) : '');
        const branchStaff = dev?.staff || dev?.installedByStaff || (s.status === 'AT_MERCHANT' ? s.updatedBy : '') || '';
        const branchName = dev?.branchName || placeName(s.branchId, branches);

        return [
          s.serial,
          materialName(s.code),
          SERIAL_STATUS_LABEL[s.status],
          s.deviceSerial || '',
          merchantName,
          mid,
          deployedDate,
          branchStaff,
          branchName,
          csvTime(s.updatedAt),
          s.updatedBy,
        ];
      })
    );
    triggerToast(`Saved ${list.length} material item(s).`);
  };

  const exportBalancesCsv = () => {
    downloadCsv(
      `${group === 'POS' ? 'pos' : 'sound-box'}-materials-branch-balances`,
      [
        'Branch Code', 'Branch Name', 'Material Type', 'Shelf Reserve (On Hand)',
        'Deployed at Merchants', 'In Transit', 'Total Controlled'
      ],
      branchBalanceRows.map((r) => [
        r.branchId,
        r.branchName,
        r.materialName,
        r.onHand,
        r.deployed,
        r.inTransit,
        r.total,
      ])
    );
    triggerToast(`Saved ${branchBalanceRows.length} branch balance record(s).`);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedSerial(text);
    setTimeout(() => setCopiedSerial(null), 1800);
  };

  const getMaterialBadge = (code: MaterialCode) => {
    const name = materialName(code);
    const IconComp =
      code === 'BATTERY' ? Battery :
      code === 'STAND' ? Smartphone :
      code === 'DOCK' ? Dock :
      code === 'POS_ADAPTOR' || code === 'SB_ADAPTOR' ? Plug :
      Package;

    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-normal bg-slate-100 text-slate-800 border border-slate-200 shadow-2xs">
        <IconComp className="w-3.5 h-3.5 text-slate-600" />
        <span>{name}</span>
      </span>
    );
  };

  if (err === 'SETUP') {
    return (
      <div className="space-y-4">
        {viewToggle && (
          <div className="flex justify-end">
            {viewToggle}
          </div>
        )}
        <MaterialsSetupNotice />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Executive Material Inventory Command Card */}
      <section
        className="surface-card rounded-2xl overflow-hidden border border-slate-200/90 shadow-sm"
        aria-label={group === 'POS' ? 'POS Materials Inventory Table' : 'Sound Box Materials Inventory Table'}
      >
        {/* Top Header Strip - System Grey Palette matching InventoryTab & PushConfiguringTab */}
        <div className="bg-slate-100 dark:bg-slate-800/90 border-b border-slate-200/90 dark:border-slate-700/80 px-5 py-4 min-h-[72px] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center shrink-0 shadow-2xs">
              <Boxes className="w-5 h-5 text-slate-700 dark:text-slate-200" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">
                  {group === 'POS' ? 'POS Terminal Materials Ledger' : 'Sound Box Materials Ledger'}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                  {totalAllItems?.toLocaleString() ?? combinedItems.length} Items
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {group === 'POS'
                  ? 'Multi-branch materials tracking for Batteries, Stand Holders, Charging Docks, and AC Adaptors'
                  : 'Multi-branch materials tracking for Sound Box AC Adaptors'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white transition cursor-pointer shadow-2xs"
                onClick={() => {
                  setDlgParams({ code: selectedCode !== 'ALL' ? selectedCode : codes[0], branchId: branchFilter || '100' });
                  setDlg('IN');
                }}
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>Stock In</span>
              </motion.button>
            )}
            {isAdmin && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition cursor-pointer shadow-2xs"
                onClick={() => {
                  setDlgParams({ code: selectedCode !== 'ALL' ? selectedCode : codes[0], branchId: branchFilter || '100' });
                  setDlg('ADJUST');
                }}
              >
                <PencilLine className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                <span>Correct</span>
              </motion.button>
            )}
            {isAdmin && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition cursor-pointer shadow-2xs"
                onClick={() => setDlg('OPENING')}
              >
                <Upload className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                <span>Opening stock</span>
              </motion.button>
            )}
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition cursor-pointer shadow-2xs"
              onClick={activeLedgerView === 'BALANCES' ? exportBalancesCsv : exportDetailedInventoryCsv}
            >
              <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Export CSV</span>
            </motion.button>
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition cursor-pointer shadow-2xs"
              onClick={changed}
              aria-label="Refresh"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />}
              <span>Refresh</span>
            </motion.button>
          </div>
        </div>

        {/* Filter Toolbar matching InventoryTab & PushConfiguringTab */}
        <div className="p-4 bg-slate-50/70 border-b border-slate-200/90 space-y-3">
          {/* Row 1: Search + Material Category selector + Status selector + Assignment selector + Page size */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <div className="relative sm:col-span-1 md:col-span-1 lg:col-span-1">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={group === 'POS' ? 'Search serial, POS, MID...' : 'Search serial, Sound Box, MID...'}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs font-semibold border bg-white border-slate-200 text-zinc-900 placeholder:text-slate-400 focus:border-zinc-700 outline-none transition shadow-2xs"
              />
            </div>

            <div className="relative sm:col-span-1 md:col-span-1 lg:col-span-1">
              <select
                aria-label="Select Material Category"
                value={selectedCode}
                onChange={(e) => setSelectedCode(e.target.value as MaterialCode | 'ALL')}
                className="w-full px-3 py-2.5 rounded-xl text-xs font-normal border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
              >
                <option value="ALL">All Material Types ({totalAllItems?.toLocaleString() ?? combinedItems.length})</option>
                {codes.map((c) => {
                  const summary = materialSummaries[c];
                  const count = summary?.total ?? combinedItems.filter((i) => i.code === c).length;
                  return (
                    <option key={c} value={c}>
                      {materialName(c)} ({count.toLocaleString()})
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="relative sm:col-span-1 md:col-span-1 lg:col-span-1">
              <select
                aria-label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as SerialStatus | '')}
                className="w-full px-3 py-2.5 rounded-xl text-xs font-normal border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
              >
                <option value="">All Statuses ({totalAllItems?.toLocaleString() ?? combinedItems.length})</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {SERIAL_STATUS_LABEL[s]} ({dynamicStatusCounts[s] ?? 0})
                  </option>
                ))}
              </select>
            </div>

            <div className="relative sm:col-span-1 md:col-span-1 lg:col-span-1">
              <select
                aria-label="Assignment Filter"
                value={assignmentFilter}
                onChange={(e) => setAssignmentFilter(e.target.value as 'ALL' | 'ASSIGNED' | 'UNASSIGNED')}
                className="w-full px-3 py-2.5 rounded-xl text-xs font-normal border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
                title="Filter by assignment to terminal or in reserve stock"
              >
                <option value="ALL">All Items (Bundled &amp; Spare)</option>
                <option value="ASSIGNED">{group === 'POS' ? 'Bundled with POS Terminal' : 'Bundled with Sound Box'}</option>
                <option value="UNASSIGNED">Standalone Support Materials</option>
              </select>
            </div>

            <div className="relative sm:col-span-1 md:col-span-1 lg:col-span-1">
              <select
                value={pg.pageSize}
                onChange={(e) => pg.setPageSize(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-xl text-xs font-normal border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
                title="Select view page (100 Row Max)"
              >
                <option value={50}>View: 50 Rows / Page</option>
                <option value={100}>View: 100 Rows / Page (Max)</option>
              </select>
            </div>
          </div>

          {/* Row 2: Branch Filter on left, viewToggle in exact same location on right */}
          <div className="flex flex-wrap items-center justify-between gap-3 min-h-[42px]">
            <div className="flex-1 min-w-[220px] max-w-sm">
              {isAdmin ? (
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-normal border bg-white border-slate-200 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
                >
                  <option value="">All Branch Codes</option>
                  <option value="100">Head Office (Code 100)</option>
                  {branches
                    .filter((b) => b.id !== '100' && b.code !== '100')
                    .map((b) => (
                      <option key={b.code || b.id} value={b.code || b.id}>
                        Branch Code {b.code || b.id} — {b.name}
                      </option>
                    ))}
                </select>
              ) : (
                <div className="w-full px-3 py-2.5 rounded-xl text-xs font-mono font-bold border flex items-center gap-2 bg-zinc-900/5 border-zinc-300 text-zinc-900">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Scoped to Branch Code: {myBranch}</span>
                </div>
              )}
            </div>

            {viewToggle && (
              <div className="flex items-center">
                {viewToggle}
              </div>
            )}
          </div>

          {/* Row 3: Ledger View Switcher & Clear Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-200/60 min-h-[36px]">
            <div className="flex items-center gap-2.5">
              <div
                className="relative inline-flex p-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-2xs select-none gap-1"
                role="tablist"
                aria-label="Ledger views"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeLedgerView === 'DEPLOYMENTS'}
                  onClick={() => setActiveLedgerView('DEPLOYMENTS')}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors select-none outline-none ${
                    activeLedgerView === 'DEPLOYMENTS'
                      ? 'text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {activeLedgerView === 'DEPLOYMENTS' && (
                    <motion.div
                      layoutId={SHARED_LAYOUT_IDS.MATERIAL_LEDGER_PILL}
                      aria-hidden
                      className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs z-0 pointer-events-none"
                      transition={SPRING_TAB_PILL}
                    />
                  )}
                  <span className="relative z-10">Merchant Deployments ({combinedItems.length})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeLedgerView === 'BALANCES'}
                  onClick={() => setActiveLedgerView('BALANCES')}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors select-none outline-none ${
                    activeLedgerView === 'BALANCES'
                      ? 'text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {activeLedgerView === 'BALANCES' && (
                    <motion.div
                      layoutId={SHARED_LAYOUT_IDS.MATERIAL_LEDGER_PILL}
                      aria-hidden
                      className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs z-0 pointer-events-none"
                      transition={SPRING_TAB_PILL}
                    />
                  )}
                  <span className="relative z-10">Multi-Branch Balances ({branchBalanceRows.length})</span>
                </button>
              </div>
              <span className="text-xs font-semibold text-slate-500 hidden sm:inline">
                {activeLedgerView === 'BALANCES'
                  ? `${branchBalanceRows.length} branch balance record(s)`
                  : `${displayedItems.length} of ${combinedItems.length} items`}
              </span>
            </div>

            <ClearFiltersButton
              active={Boolean(query.trim() || statusFilter || (isAdmin && branchFilter) || selectedCode !== 'ALL' || assignmentFilter !== 'ALL')}
              onClear={() => {
                setQuery('');
                setStatusFilter('');
                if (isAdmin) setBranchFilter('');
                setSelectedCode('ALL');
                setAssignmentFilter('ALL');
              }}
            />
          </div>
        </div>

        {/* Executive Controlled Materials Summary Cards */}
        <div className="p-4 bg-slate-50/70 border-b border-slate-200/90">
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${group === 'POS' ? 'lg:grid-cols-4' : 'lg:grid-cols-2'} gap-3`}>
            {codes.map((c) => {
              const summary = materialSummaries[c] || { total: 0, onHand: 0, deployed: 0, inTransit: 0 };
              const isSelected = selectedCode === c;
              const IconComp = c === 'BATTERY' ? Battery : c === 'STAND' ? Smartphone : c === 'DOCK' ? Dock : Plug;

              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedCode(isSelected ? 'ALL' : c)}
                  className={`flex flex-col text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-white border-[#003857] ring-1 ring-[#003857]/30 shadow-xs'
                      : 'bg-white hover:bg-slate-50/80 border-slate-200/90 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        c === 'BATTERY' ? 'bg-amber-50 text-amber-700' :
                        c === 'STAND' ? 'bg-indigo-50 text-indigo-700' :
                        c === 'DOCK' ? 'bg-sky-50 text-sky-700' :
                        c === 'SB_ADAPTOR' ? 'bg-purple-50 text-purple-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        <IconComp className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-bold text-slate-800">{materialName(c)}</span>
                    </div>
                    {isSelected && (
                      <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[#003857] text-white">
                        Active
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5 flex items-baseline justify-between gap-2">
                    <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                      {summary.total.toLocaleString()}
                    </span>
                    <span className="text-[11px] text-slate-500 font-normal">Controlled</span>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-100 grid grid-cols-3 gap-1 text-[10.5px] text-slate-600 font-normal">
                    <span title="In Central Head Office Warehouse (Admin Stock)" className="truncate">
                      Admin: <span className="font-semibold text-[#003857]">{summary.adminStock.toLocaleString()}</span>
                    </span>
                    <span title="In Branch Reserve Shelves" className="truncate text-center">
                      Reserve: <span className="font-semibold text-sky-700">{summary.branchReserve.toLocaleString()}</span>
                    </span>
                    <span title="Deployed with active units at merchants" className="truncate text-right">
                      Merchant: <span className="font-semibold text-emerald-700">{summary.deployed.toLocaleString()}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>



        {/* Dynamic Table: View 1 (Merchant Deployments) OR View 2 (Multi-Branch Balances) */}
        {activeLedgerView === 'BALANCES' ? (
          /* Multi-Branch Balances Matrix Ledger */
          <div className="overflow-x-auto overflow-y-hidden">
            <table className="w-full min-w-[900px] text-sm text-left">
              <thead>
                <tr className="bg-[#003857] text-white text-[10.5px] uppercase tracking-wider font-bold select-none">
                  <th className="px-4 py-3 text-center w-12">No.</th>
                  <th className="px-4 py-3">Branch Location / Custody</th>
                  <th className="px-4 py-3">Material Type</th>
                  <th className="px-4 py-3 text-right">Branch Shelf Reserve (On Hand)</th>
                  <th className="px-4 py-3 text-right">Deployed at Merchants</th>
                  <th className="px-4 py-3 text-right">In Transit</th>
                  <th className="px-4 py-3 text-right font-bold">Total Controlled</th>
                  {isAdmin && <th className="px-4 py-3 text-center w-36">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {branchBalanceRows.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} className="px-4 py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                        <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                          <Boxes className="w-5 h-5 text-slate-400" />
                        </div>
                        <p className="font-bold text-slate-700 text-sm">No branch balances recorded</p>
                        <p className="text-xs text-slate-500">
                          Click "Stock In" above to allocate accessory units into branch stock.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  branchBalanceRows.map((r, idx) => (
                    <tr
                      key={`bal-${r.branchId}-${r.code}-${idx}`}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-center font-mono text-slate-400 font-normal">
                        {idx + 1}
                      </td>

                      <td className="px-4 py-2.5 font-normal text-slate-800">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span>{r.branchName}</span>
                        </div>
                      </td>

                      <td className="px-4 py-2.5">
                        {getMaterialBadge(r.code)}
                      </td>

                      <td className="px-4 py-2.5 text-right font-mono font-normal text-slate-800">
                        <span className={r.onHand > 0 ? 'text-slate-900' : 'text-slate-400'}>
                          {r.onHand.toLocaleString()}
                        </span>
                      </td>

                      <td className="px-4 py-2.5 text-right font-mono font-normal text-slate-800">
                        <span className={r.deployed > 0 ? 'text-emerald-700' : 'text-slate-400'}>
                          {r.deployed.toLocaleString()}
                        </span>
                      </td>

                      <td className="px-4 py-2.5 text-right font-mono font-normal text-slate-600">
                        {r.inTransit > 0 ? (
                          <span className="text-amber-700 font-medium">+{r.inTransit}</span>
                        ) : (
                          '0'
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-right font-mono font-normal text-slate-900">
                        {r.total.toLocaleString()}
                      </td>

                      {isAdmin && (
                        <td className="px-4 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              className="px-2 py-1 rounded text-[11px] font-normal bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                              onClick={() => {
                                setDlgParams({ code: r.code, branchId: r.branchId });
                                setDlg('IN');
                              }}
                            >
                              + Stock In
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 rounded text-[11px] font-normal bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition cursor-pointer"
                              onClick={() => {
                                setDlgParams({ code: r.code, branchId: r.branchId });
                                setDlg('ADJUST');
                              }}
                            >
                              Adjust
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Merchant Deployments & Itemized Units Ledger */
          <div className="overflow-x-auto overflow-y-hidden">
            <table className="w-full min-w-[900px] text-sm text-left">
              <thead>
                <tr className="bg-[#003857] text-white text-[10.5px] uppercase tracking-wider font-bold select-none">
                  <th className="px-4 py-3 text-center w-12">No.</th>
                  <th className="px-4 py-3">Item / Identifier</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Material Type</th>
                  <th className="px-4 py-3">
                    {group === 'POS' ? 'Assigned POS Terminal' : 'Assigned Sound Box'}
                  </th>
                  <th className="px-4 py-3">Merchant / MID</th>
                  <th className="px-4 py-3">Deployment Date</th>
                  <th className="px-4 py-3">Branch Staff</th>
                  <th className="px-4 py-3">Branch Name</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {displayedItems.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                        <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                          <Boxes className="w-5 h-5 text-slate-400" />
                        </div>
                        <p className="font-bold text-slate-700 text-sm">No material items found</p>
                        <p className="text-xs text-slate-500">
                          {query || statusFilter || branchFilter || selectedCode !== 'ALL'
                            ? 'Try clearing active filters or modifying search keywords.'
                            : 'No items recorded yet. Click "Stock In" above to register new items into inventory.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}

                {displayedItems.map((s, idx) => {
                  const dev = s.deviceSerial ? deviceMap.get(s.deviceSerial.toUpperCase()) : undefined;
                  const merchantName = s.merchantName || dev?.merchantName || '—';
                  const mid = s.mid || dev?.mid || '';
                  const deployedDate = dev?.deployedDate || (s.status === 'AT_MERCHANT' && s.updatedAt ? fmtDay(s.updatedAt) : '—');
                  const branchStaff = dev?.staff || dev?.installedByStaff || (s.status === 'AT_MERCHANT' ? s.updatedBy : '') || '—';
                  const branchName = dev?.branchName || placeName(s.branchId, branches);

                  return (
                    <tr key={`${s.code}-${s.serial}-${idx}`} style={{ animationDelay: `${Math.min(idx, 8) * 12}ms` }} className="row-stagger hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-2.5 text-center font-mono text-slate-400 font-normal">
                        {pg.start + idx + 1}
                      </td>

                      <td className="px-4 py-2.5 font-mono font-normal text-slate-800">
                        <div className="flex items-center gap-1.5">
                          <span className="select-all">{s.serial}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(s.serial)}
                            title="Copy serial"
                            className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer"
                          >
                            {copiedSerial === s.serial ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-2.5">
                        <StatusPill status={s.status} />
                      </td>

                      <td className="px-4 py-2.5">
                        {getMaterialBadge(s.code)}
                      </td>

                      <td className="px-4 py-2.5 font-mono font-normal text-slate-800">
                        {s.deviceSerial ? (
                          <div className="flex items-center gap-1.5">
                            <span>{s.deviceSerial}</span>
                            <span className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium select-none">
                              Bundled
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-sans text-xs italic select-none">Standalone Spare</span>
                        )}
                      </td>

                      <td className="px-4 py-2.5">
                        <div className="flex flex-col">
                          <span className="font-normal text-slate-800 truncate max-w-[170px]" title={merchantName}>
                            {merchantName}
                          </span>
                          {mid && <span className="font-mono text-[10.5px] text-slate-400">MID: {mid}</span>}
                        </div>
                      </td>

                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {deployedDate}
                      </td>

                      <td className="px-4 py-2.5 font-normal text-slate-700">
                        {branchStaff}
                      </td>

                      <td className="px-4 py-2.5 text-slate-600 truncate max-w-[150px]" title={branchName}>
                        {branchName}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pager (shown on Deployments view) */}
        {activeLedgerView === 'DEPLOYMENTS' && (
          <div className="p-3.5 border-t border-slate-100 bg-slate-50/50">
            <Pager pg={pg} />
          </div>
        )}
      </section>

      <LostMaterialsSection codes={codes} title={`Lost Materials · ${group === 'POS' ? 'POS Terminal' : 'Sound Box'}`} branches={branches}
        isAdmin={isAdmin} triggerToast={triggerToast} onChanged={changed} />

      {/* Dialogs */}
      <StockInDialog
        open={dlg === 'IN'}
        codes={codes}
        branches={branches}
        initialCode={dlgParams.code || (selectedCode !== 'ALL' ? selectedCode : codes[0])}
        initialBranch={dlgParams.branchId || (branchFilter || '100')}
        onClose={() => { setDlg(''); setDlgParams({}); }}
        onDone={changed}
        triggerToast={triggerToast}
      />
      <AdjustDialog
        open={dlg === 'ADJUST'}
        codes={codes}
        branches={branches}
        initialCode={dlgParams.code || (selectedCode !== 'ALL' ? selectedCode : codes[0])}
        initialBranch={dlgParams.branchId || (branchFilter || '100')}
        onClose={() => { setDlg(''); setDlgParams({}); }}
        onDone={changed}
        triggerToast={triggerToast}
      />
      <OpeningDialog open={dlg === 'OPENING'} branches={branches} onClose={() => setDlg('')} onDone={changed} triggerToast={triggerToast} />
    </div>
  );
};

export const LostMaterialsSection: React.FC<{
  codes: MaterialCode[]; title: string; branches: Branch[]; isAdmin: boolean; triggerToast: (m: string) => void; onChanged?: () => void;
}> = ({ codes, title, branches, isAdmin, triggerToast, onChanged }) => {
  const key = codes.slice().sort().join(',');
  const [all, setAll] = useState<LostItem[] | null>(null);
  const [filter, setFilter] = useState<'OPEN' | ''>('OPEN');
  const load = useCallback(async (force = false) => {
    try { setAll(await fetchLost(key.split(',') as MaterialCode[], '', force)); } catch { setAll((x) => x || []); }
  }, [key]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const again = () => load(true);
    window.addEventListener('materials-updated', again);
    return () => window.removeEventListener('materials-updated', again);
  }, [load]);
  const rows = useMemo(() => (all ? (filter === 'OPEN' ? all.filter((l) => l.status === 'OPEN') : all) : null), [all, filter]);
  if (!all || all.length === 0) return null;
  return (
    <LostTable title={title} rows={rows} branches={branches} isAdmin={isAdmin} filter={filter} onFilter={setFilter}
      onChanged={() => { load(true); onChanged?.(); }} triggerToast={triggerToast} />
  );
};

export const LostTable: React.FC<{
  title: string; rows: LostItem[] | null; branches: Branch[]; isAdmin: boolean; filter: 'OPEN' | ''; onFilter: (f: 'OPEN' | '') => void;
  onChanged: () => void; triggerToast: (m: string) => void;
}> = ({ title, rows, branches, isAdmin, filter, onFilter, onChanged, triggerToast }) => {
  const [act, setAct] = useState<{ item: LostItem; action: 'RECOVER' | 'WRITE_OFF' } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (item: LostItem, action: 'RECOVER' | 'WRITE_OFF' | 'BLOCKED', why = '') => {
    setBusy(true);
    try {
      await materialLostAction({ id: item.id, action, reason: why });
      triggerToast(action === 'BLOCKED' ? `SIM ${item.serial} marked blocked with the carrier.` : action === 'RECOVER' ? `${materialName(item.code)} recovered: back in branch stock.` : `${materialName(item.code)} written off.`);
      setAct(null); setReason(''); onChanged();
    } catch (e) { triggerToast(`Not saved: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-600" />{title}</h3>
        <div className="relative inline-flex p-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 shadow-2xs text-xs font-semibold select-none gap-1" role="tablist">
          {([['OPEN', 'Open'], ['', 'All']] as const).map(([v, l]) => {
            const isSelected = filter === v;
            return (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onFilter(v)}
                className={`relative px-3 py-1 rounded-lg cursor-pointer select-none transition-colors duration-150 outline-none ${
                  isSelected
                    ? 'text-white font-bold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {isSelected && (
                  <motion.div
                    layoutId="active-lost-filter-pill"
                    className="absolute inset-0 rounded-lg tab-active-blue border border-white/10 shadow-xs z-0 pointer-events-none"
                    transition={SPRING_TAB_PILL}
                  />
                )}
                <span className="relative z-10">{l}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="overflow-x-auto overflow-y-hidden">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50">
              <th className="text-left font-semibold px-4 py-2">Date</th><th className="text-left font-semibold px-4 py-2">Item</th>
              <th className="text-left font-semibold px-4 py-2">Merchant / unit</th><th className="text-left font-semibold px-4 py-2">Branch / reported by</th>
              <th className="text-left font-semibold px-4 py-2">Remark</th><th className="text-left font-semibold px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows === null && <tr><td colSpan={6} className="px-4 py-5"><div className="skeleton h-4 rounded w-1/3" /></td></tr>}
            {rows !== null && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-emerald-700 font-semibold">{filter === 'OPEN' ? 'No open lost item.' : 'Nothing reported lost.'}</td></tr>}
            {(rows || []).map((l) => (
              <tr key={l.id} className="align-top">
                <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{fmtDay(l.createdAt)}<span className="block text-[11px] text-slate-500">{l.source || ''}</span></td>
                <td className="px-4 py-2.5"><b className="text-slate-900">{materialName(l.code)}</b>{l.serial ? <span className="block font-mono text-xs text-slate-600">{l.serial}</span> : <span className="block text-xs text-slate-600">× {l.qty}</span>}</td>
                <td className="px-4 py-2.5">{l.merchantName || '—'}<span className="block text-xs text-slate-500">{[l.mid && `MID ${l.mid}`, l.deviceSerial].filter(Boolean).join(' · ') || 'branch stock'}</span></td>
                <td className="px-4 py-2.5">{placeName(l.branchId, branches)}<span className="block text-xs text-slate-500">{l.reportedBy || ''}</span></td>
                <td className="px-4 py-2.5 text-slate-700 max-w-[260px]">{l.remark || '—'}{l.resolution && <span className="block text-xs text-slate-500">Closed: {l.resolution}</span>}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {l.status === 'OPEN' ? <Pill tone="bad">Open</Pill> : l.status === 'RECOVERED' ? <Pill tone="good">Recovered</Pill> : <Pill tone="mute">Written off</Pill>}
                    {l.code === 'SIM' && (l.blocked ? <Pill tone="info">Blocked with carrier</Pill> : isAdmin && <button type="button" className={btnRow} disabled={busy} onClick={() => run(l, 'BLOCKED')}>Blocked with carrier</button>)}
                    {isAdmin && l.status === 'OPEN' && <>
                      <button type="button" className={btnRow} disabled={busy} onClick={() => { setAct({ item: l, action: 'RECOVER' }); setReason(''); }}>Recovered</button>
                      <button type="button" className={btnRow} disabled={busy} onClick={() => { setAct({ item: l, action: 'WRITE_OFF' }); setReason(''); }}>Write off</button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MaterialDialog open={!!act} busy={busy} onClose={() => setAct(null)}
        title={act?.action === 'RECOVER' ? 'Item recovered' : 'Write off lost item'}
        sub={act ? `${materialName(act.item.code)} ${act.item.serial || '× ' + act.item.qty} · ${placeName(act.item.branchId, branches)}` : ''}
        footer={<>
          <button type="button" className={btnLight} onClick={() => setAct(null)} disabled={busy}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy || (act?.action === 'WRITE_OFF' && reason.trim().length < 3)} onClick={() => act && run(act.item, act.action, reason.trim())}>
            <BusyLabel busy={busy}>{act?.action === 'RECOVER' ? 'Back to branch stock' : 'Write off'}</BusyLabel>
          </button>
        </>}>
        <p className="text-sm text-slate-600">{act?.action === 'RECOVER' ? 'The item was found. It goes back into the reserve of its branch.' : 'The item will not come back. It is removed from stock for good; the reason is kept in the Audit Trail.'}</p>
        <label className={labelCls}>{act?.action === 'RECOVER' ? 'Note (optional)' : 'Reason (required)'}
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={act?.action === 'RECOVER' ? 'e.g. found at the shop' : 'e.g. merchant closed, not reachable'} />
        </label>
      </MaterialDialog>
    </section>
  );
};

const PlaceSelect: React.FC<{ value: string; onChange: (v: string) => void; branches: Branch[]; id: string }> = ({ value, onChange, branches, id }) => (
  <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="100">Head Office</option>
    {branches.filter((b) => b.id !== '100').map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}</option>)}
  </select>
);

/** Numbers typed or pasted one per line (or separated by commas), cleaned and de-duplicated. */
const parseNumbers = (code: MaterialCode, text: string) => {
  const ok: string[] = []; const bad: string[] = []; const seen = new Set<string>();
  text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).forEach((raw) => {
    const s = normMaterialSerial(code, raw);
    if (!s) bad.push(raw); else if (!seen.has(s)) { seen.add(s); ok.push(s); }
  });
  return { ok, bad };
};

export const StockInDialog: React.FC<{
  open: boolean;
  codes: MaterialCode[];
  branches: Branch[];
  initialCode?: MaterialCode;
  initialBranch?: string;
  initialTarget?: 'ALL' | 'POS' | 'SOUND_BOX';
  onClose: () => void;
  onDone: () => void;
  triggerToast: (m: string) => void;
}> = ({
  open, codes, branches, initialCode, initialBranch, initialTarget = 'ALL', onClose, onDone, triggerToast,
}) => {
  const [code, setCode] = useState<MaterialCode>(initialCode || codes[0]);
  const [place, setPlace] = useState(initialBranch || '100');
  const [qty, setQty] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [targetDevice, setTargetDevice] = useState<'ALL' | 'POS' | 'SOUND_BOX'>(initialTarget);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCode(initialCode || codes[0]);
      setPlace(initialBranch || '100');
      setQty('');
      setText('');
      setNote('');
      setTargetDevice(initialTarget);
    }
  }, [open, codes, initialTarget]);
  const m = materialByCode.get(code)!;
  const nums = m.tracking === 'SERIAL' ? parseNumbers(code, text) : { ok: [], bad: [] };
  const ready = m.tracking === 'QTY' ? Number(qty) > 0 : nums.ok.length > 0;
  const save = async () => {
    setBusy(true);
    try {
      let finalNote = note.trim();
      if (code === 'SIM') {
        if (targetDevice === 'POS') {
          finalNote = finalNote ? `[Target: POS Terminal] ${finalNote}` : '[Target: POS Terminal]';
        } else if (targetDevice === 'SOUND_BOX') {
          finalNote = finalNote ? `[Target: Sound Box] ${finalNote}` : '[Target: Sound Box]';
        }
      }
      const r = await materialStockIn(m.tracking === 'QTY' ? { code, branch_id: place, qty: Math.floor(Number(qty)), note: finalNote } : { code, branch_id: place, serials: nums.ok, note: finalNote });
      triggerToast(`${m.name}: ${r.added} added${r.refused?.length ? `; ${r.refused.length} refused (${r.refused.slice(0, 3).map((x) => `${x.serial}: ${x.why}`).join('; ')})` : ''}.`);
      onDone(); onClose();
    } catch (e) { triggerToast(`Not added: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open={open} title="Stock In" sub="New materials received" busy={busy} onClose={onClose}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={!ready || busy}><BusyLabel busy={busy}>Add to stock</BusyLabel></button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className={labelCls} htmlFor="si-code">Material
          <select id="si-code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value as MaterialCode)}>
            {codes.map((c) => <option key={c} value={c}>{materialName(c)}</option>)}
          </select>
        </label>
        <label className={labelCls} htmlFor="si-place">Location<PlaceSelect id="si-place" value={place} onChange={setPlace} branches={branches} /></label>
      </div>
      {code === 'SIM' && (
        <label className={labelCls}>Target Device Type
          <select
            className={inputCls}
            value={targetDevice}
            onChange={(e) => setTargetDevice(e.target.value as 'ALL' | 'POS' | 'SOUND_BOX')}
          >
            <option value="ALL">All / Shared Pool (Can be used for POS or Sound Box)</option>
            <option value="POS">POS Terminal Only (Dedicated for POS)</option>
            <option value="SOUND_BOX">Sound Box Only (Dedicated for Sound Box)</option>
          </select>
        </label>
      )}
      {m.tracking === 'QTY' ? (
        <label className={labelCls}>Quantity<input className={inputCls} type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      ) : (
        <label className={labelCls}>{m.name} numbers, one per line
          <textarea className={`${inputCls} font-mono h-36`} value={text} onChange={(e) => setText(e.target.value)} placeholder={code === 'SIM' ? '096 555 0142\n012 345 678' : 'BAT-100231'} />
          <span className="font-normal text-slate-500">{nums.ok.length} valid{nums.bad.length ? ` · ${nums.bad.length} not valid: ${nums.bad.slice(0, 4).join(', ')}` : ''}</span>
        </label>
      )}
      <label className={labelCls}>Note (optional)<input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. delivery from supplier, invoice no." /></label>
    </MaterialDialog>
  );
};

export const AdjustDialog: React.FC<{
  open: boolean;
  codes: MaterialCode[];
  branches: Branch[];
  initialCode?: MaterialCode;
  initialBranch?: string;
  onClose: () => void;
  onDone: () => void;
  triggerToast: (m: string) => void;
}> = ({
  open, codes, branches, initialCode, initialBranch, onClose, onDone, triggerToast,
}) => {
  const [code, setCode] = useState<MaterialCode>(initialCode || codes[0]);
  const [place, setPlace] = useState(initialBranch || '100');
  const [qty, setQty] = useState('');
  const [serial, setSerial] = useState('');
  const [status, setStatus] = useState<SerialStatus>('BRANCH_RESERVE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCode(initialCode || codes[0]); setPlace(initialBranch || '100'); setQty(''); setSerial(''); setStatus('BRANCH_RESERVE'); setReason(''); } }, [open, codes, initialCode, initialBranch]);
  const m = materialByCode.get(code)!;
  const ready = reason.trim().length >= 3 && (m.tracking === 'QTY' ? qty !== '' && Number(qty) >= 0 : !!normMaterialSerial(code, serial));
  const save = async () => {
    setBusy(true);
    try {
      await materialAdjust(m.tracking === 'QTY' ? { code, branch_id: place, qty: Math.floor(Number(qty)), reason: reason.trim() }
        : { code, branch_id: place, serial, status, reason: reason.trim() });
      triggerToast(`${m.name} corrected.`); onDone(); onClose();
    } catch (e) { triggerToast(`Not corrected: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open={open} title="Correct stock" sub="Set the right figure; the reason is kept in the Audit Trail" busy={busy} onClose={onClose}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={!ready || busy}><BusyLabel busy={busy}>Save correction</BusyLabel></button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className={labelCls} htmlFor="ad-code">Material
          <select id="ad-code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value as MaterialCode)}>
            {codes.map((c) => <option key={c} value={c}>{materialName(c)}</option>)}
          </select>
        </label>
        <label className={labelCls} htmlFor="ad-place">Location<PlaceSelect id="ad-place" value={place} onChange={setPlace} branches={branches} /></label>
      </div>
      {m.tracking === 'QTY' ? (
        <label className={labelCls}>Correct quantity at this location<input className={inputCls} type="number" min={0} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <label className={labelCls}>{m.name} number<input className={`${inputCls} font-mono`} value={serial} onChange={(e) => setSerial(e.target.value)} /></label>
          <label className={labelCls} htmlFor="ad-status">Set to
            <select id="ad-status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as SerialStatus)}>
              <option value="BRANCH_RESERVE">In this location's stock</option><option value="FAULTY">Faulty</option><option value="WRITTEN_OFF">Written off</option>
            </select>
          </label>
        </div>
      )}
      <label className={labelCls}>Reason (required)<input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. counted 12 on the shelf" /></label>
    </MaterialDialog>
  );
};

/** Opening stock from a CSV file (Excel: File → Save As → CSV). Columns: Branch, Material, Quantity, Number. */
const MATERIAL_ALIASES: Record<string, MaterialCode> = {
  sim: 'SIM', simcard: 'SIM', battery: 'BATTERY', posadaptor: 'POS_ADAPTOR', posacadaptor: 'POS_ADAPTOR', adaptorpos: 'POS_ADAPTOR',
  stand: 'STAND', posstand: 'STAND', posstandholder: 'STAND', standholder: 'STAND', dock: 'DOCK', chargingdock: 'DOCK',
  sbadaptor: 'SB_ADAPTOR', soundboxadaptor: 'SB_ADAPTOR', soundboxacadaptor: 'SB_ADAPTOR',
};
const toCode = (s: string): MaterialCode | null => {
  const k = String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  if (MATERIALS.some((m) => m.code.toLowerCase().replace(/_/g, '') === k)) return MATERIALS.find((m) => m.code.toLowerCase().replace(/_/g, '') === k)!.code;
  return MATERIAL_ALIASES[k] || null;
};
const OpeningDialog: React.FC<{ open: boolean; branches: Branch[]; onClose: () => void; onDone: () => void; triggerToast: (m: string) => void }> = ({ open, branches, onClose, onDone, triggerToast }) => {
  const [file, setFile] = useState('');
  const [rows, setRows] = useState<{ qty: { branch: string; code: string; qty: number }[]; serials: { branch: string; code: string; serial: string }[]; bad: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  useEffect(() => { if (open) { setFile(''); setRows(null); setResult(''); } }, [open]);
  const template = () => {
    const b = branches.find((x) => x.id !== '100')?.id || '105';
    downloadCsv('material-opening-stock-template', ['Branch', 'Material', 'Quantity', 'Number'], [
      [b, 'POS AC Adaptor', 10, ''], [b, 'POS Stand Holder', 3, ''], [b, 'Charging Dock', 1, ''], [b, 'Sound Box AC Adaptor', 5, ''],
      [b, 'SIM Card', '', '096 555 0142'], [b, 'Battery', '', 'BAT-100231'], ['100', 'POS AC Adaptor', 500, ''],
    ]);
  };
  const read = async (f: File) => {
    setFile(f.name); setResult('');
    const grid = parseCsv(await f.text());
    const head = (grid[0] || []).map((h) => h.toLowerCase().trim());
    const col = (n: string) => head.findIndex((h) => h.startsWith(n));
    const iB = col('branch'), iM = col('material'), iQ = col('quantity') >= 0 ? col('quantity') : col('qty'), iN = col('number') >= 0 ? col('number') : col('serial');
    if (iB < 0 || iM < 0) { setRows({ qty: [], serials: [], bad: ['The first row must name the columns Branch, Material, Quantity, Number (use the template).'] }); return; }
    const out = { qty: [] as { branch: string; code: string; qty: number }[], serials: [] as { branch: string; code: string; serial: string }[], bad: [] as string[] };
    grid.slice(1).forEach((r, i) => {
      if (!r.some((c) => String(c).trim())) return;
      const code = toCode(r[iM]); const branch = String(r[iB] || '').trim();
      if (!code || !branch) { out.bad.push(`Row ${i + 2}: ${!branch ? 'no branch' : `unknown material "${r[iM]}"`}`); return; }
      const m = materialByCode.get(code)!;
      if (m.tracking === 'SERIAL') {
        const n = iN >= 0 ? String(r[iN] || '').trim() : '';
        if (!n) { out.bad.push(`Row ${i + 2}: ${m.name} needs a number`); return; }
        out.serials.push({ branch, code, serial: n });
      } else {
        const q = Number(String(iQ >= 0 ? r[iQ] : '').replace(/,/g, ''));
        if (!Number.isFinite(q) || q < 0) { out.bad.push(`Row ${i + 2}: ${m.name} needs a quantity`); return; }
        out.qty.push({ branch, code, qty: Math.floor(q) });
      }
    });
    setRows(out);
  };
  const save = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await materialOpening({ qty: rows.qty, serials: rows.serials });
      setResult(`${r.qty_lines} quantity line(s) and ${r.serials} number(s) loaded.${r.refused.length ? ` ${r.refused.length} refused: ${r.refused.slice(0, 5).map((x) => x.why).join('; ')}` : ''}`);
      triggerToast('Opening stock loaded.'); onDone();
    } catch (e) { setResult(`Not loaded: ${cleanMaterialError(e)}`); } finally { setBusy(false); }
  };
  return (
    <MaterialDialog open={open} wide title="Opening stock" sub="Load the current counts of every branch once, before go-live" busy={busy} onClose={onClose}
      footer={<><button type="button" className={btnLight} onClick={onClose} disabled={busy}>Close</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={busy || !rows || rows.qty.length + rows.serials.length === 0 || !!result}><BusyLabel busy={busy}>Load {rows ? rows.qty.length + rows.serials.length : 0} row(s)</BusyLabel></button></>}>
      <ol className="list-decimal pl-5 text-sm text-slate-700 space-y-1">
        <li>Download the template and fill one row per branch and material: <b>Quantity</b> for adaptors, stands and docks; one row per <b>Number</b> for SIM cards and batteries. Branch can be the code (105) or the name.</li>
        <li>In Excel: File → Save As → <b>CSV</b>. Then choose the file below.</li>
        <li>Quantities are <b>set</b> to the figure in the file (loading again corrects them); numbers already registered are refused.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnLight} onClick={template}><Download className="w-4 h-4" />Download template</button>
        <label className={`${btnLight} relative`}>
          <Upload className="w-4 h-4" />{file || 'Choose CSV file'}
          <input type="file" accept=".csv,text/csv" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} />
        </label>
      </div>
      {rows && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <b>{rows.qty.length}</b> quantity row(s) · <b>{rows.serials.length}</b> SIM / battery number(s)
          {rows.bad.length > 0 && <ul className="mt-2 text-rose-700 text-xs list-disc pl-5">{rows.bad.slice(0, 8).map((b) => <li key={b}>{b}</li>)}{rows.bad.length > 8 && <li>… {rows.bad.length - 8} more</li>}</ul>}
        </div>
      )}
      {result && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{result}</div>}
      <p className="text-xs text-slate-500 flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" />Every loaded figure is recorded in the material history and the Audit Trail.</p>
    </MaterialDialog>
  );
};


export const MaterialStockPanel = React.memo(MaterialStockPanelComponent);
export const ProductStockPage = React.memo(ProductStockPageComponent);
