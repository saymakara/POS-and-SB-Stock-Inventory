import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { SPRING_TAB_PILL, SHARED_LAYOUT_IDS } from '../utils/animationRules';
import {
  Boxes, Cpu, Volume2, RefreshCw, Loader2, PackagePlus, PencilLine, Upload,
  Download, Package, Battery, Dock, Smartphone, Plug, Search, Copy, Check, Building2, AlertTriangle, SendHorizontal
} from 'lucide-react';
import { Branch, UserRole, Device, User } from '../types';
import { Pager } from './Pager';
import { usePager } from '../utils/usePager';
import { downloadCsv, csvTime } from '../utils/exportCsv';
import { parseCsv } from '../utils/csv';
import { ClearFiltersButton } from './ClearFiltersButton';
import {
  DeviceGroup, LostItem, MaterialCode, MATERIALS, SerialStatus, cleanMaterialError, fetchMaterialBalances,
  isMaterialsMissing, materialAdjust, materialByCode, materialLostAction, materialName, materialOpening, materialStockIn, normMaterialSerial, placeName, productMaterials,
  clearMaterialsCache, kitAdd, kitReturn,
  MaterialSerial, SERIAL_STATUS_LABEL, fetchSerialsPage, fetchSerialStatusCounts, fetchLost, MaterialBalance, deriveDeviceKitMaterials,
} from '../services/materialsService';
import { BusyLabel, MaterialDialog, MaterialsSetupNotice, Pill, StatusPill, btnLight, btnPrimary, btnRow, fmtDay, inputCls, labelCls } from './MaterialsUi';
import {
  PillMotion,
  CAPSULE_TRACK_CLS,
  CAPSULE_TRACK_COMPACT_CLS,
  CAPSULE_PILL_CLS,
  CAPSULE_BTN_ACTIVE_CLS,
  CAPSULE_BTN_NAVY_ACTIVE_CLS,
  CAPSULE_BTN_INACTIVE_CLS,
  CAPSULE_COUNT_ACTIVE_CLS,
  CAPSULE_COUNT_WARN_ACTIVE_CLS,
  CAPSULE_COUNT_INACTIVE_CLS,
} from './PillMotion';
import { ManageMaterialModal } from './ManageMaterialModal';
import { buildPpDirectoryScope } from '../utils/fieldScope';
import { getCachedStaff, onStaffList } from '../services/staffCache';
import { onPortalSync } from '../utils/portalSync';
import type { StaffAccount } from '../services/supabaseService';

export type ProductView = 'UNITS' | 'PUSH';

/* (7 Nov 2026 / updated 14 Nov 2026) Ultra-smooth switching without flicker or jump.
   Only Units and Push Configuring tabs exist; Material is filtered in-place inside Units.
   The active pill remembers where it was across views and glides smoothly using WAAPI. */
const lastPill: Partial<Record<DeviceGroup, { x: number; w: number }>> = {};
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface MaterialSummaryMetric {
  code: MaterialCode;
  name: string;
  adminStock: number;
  branchReserve: number;
  onHand: number;
  deployed: number;
  inTransit: number;
  lost: number;
  total: number;
}

export const ProductViewToggle: React.FC<{
  view: ProductView;
  onViewChange: (v: ProductView) => void;
  group: DeviceGroup;
  pushCount?: number;
  lostCount?: number;
  hasPush?: boolean;
}> = ({ view, onViewChange, group, pushCount = 0, hasPush = true }) => {
  const views: ProductView[] = hasPush ? ['UNITS', 'PUSH'] : ['UNITS'];
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
    // (23 Nov 2026, speed) only when the selected view, its count or the group changes. Before, this ran after every
    // redraw of the Stock Inventory page and made the browser lay out the whole page each time (~280 ms when opening it);
    // a change of size is followed by the ResizeObserver below.
  }, [view, group, hasPush, pushCount]);

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
      className={`${CAPSULE_TRACK_CLS} shrink-0`}
    >
      <div
        ref={pillRef}
        aria-hidden
        className="absolute left-0 top-1 bottom-1 rounded-full bg-white dark:bg-slate-700 shadow-[0_1px_4px_rgba(15,23,42,0.12)] z-0 pointer-events-none will-change-transform"
      />
      {views.map((v) => {
        const n = v === 'PUSH' ? pushCount || 0 : 0;
        const isSelected = view === v;
        const Icon = v === 'UNITS' ? (group === 'POS' ? Cpu : Volume2) : SendHorizontal;
        const iconColor = v === 'UNITS' ? 'text-[#004e75] dark:text-sky-400' : 'text-amber-500';
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
            title={v === 'PUSH' && n ? `${n} unit(s) waiting to be pushed` : undefined}
            className="relative inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs sm:text-sm cursor-pointer select-none"
          >
            <Icon className={`relative z-10 w-3.5 h-3.5 shrink-0 transition-colors duration-200 ${iconColor}`} aria-hidden />
            <span
              className={`relative z-10 transition-colors duration-200 ease-out ${
                isSelected ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
              }`}
            >
              {v === 'UNITS' ? 'Units' : 'Push Configuring'}
            </span>
            {n > 0 && (
              <span
                className={`relative z-10 text-[10.5px] px-1.5 py-0.5 rounded-full tabular-nums transition-colors duration-200 ease-out ${
                  isSelected ? CAPSULE_COUNT_WARN_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS
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

export interface HardwareSummaryMetric {
  total: number;
  adminStock: number;
  branchReserve: number;
  live: number;
}

const STRIP_LG_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
};

const MaterialSummaryCardsStrip: React.FC<{
  codes: MaterialCode[];
  summaries: Partial<Record<MaterialCode, MaterialSummaryMetric>>;
  selectedCode: MaterialCode | 'ALL' | null;
  onSelectCode: (code: MaterialCode) => void;
  hardwareSummary?: HardwareSummaryMetric;
  hardwareGroup?: DeviceGroup;
  isHardwareSelected?: boolean;
  onSelectHardware?: () => void;
  lostCount?: number;
  onOpenLostMaterials?: () => void;
  embedded?: boolean;
}> = ({
  codes,
  summaries,
  selectedCode,
  onSelectCode,
  hardwareSummary,
  hardwareGroup = 'POS',
  isHardwareSelected = false,
  onSelectHardware,
  lostCount = 0,
  onOpenLostMaterials,
  embedded = false,
}) => {
  const cardCount = Math.min(5, Math.max(1, codes.length + (hardwareSummary ? 1 : 0)));
  const HardwareIcon = hardwareGroup === 'SB' ? Volume2 : Cpu;
  const hardwareLabel = hardwareGroup === 'SB' ? 'Sound Box' : 'POS Terminal';
  return (
  <div className={embedded ? 'space-y-3' : 'px-4 py-3 bg-slate-50/70 border-b border-slate-200/90 space-y-2.5'}>
    {lostCount > 0 && onOpenLostMaterials && (
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onOpenLostMaterials}
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/90 transition cursor-pointer"
        >
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          <span>{lostCount} Open Lost Material{lostCount === 1 ? '' : 's'} — View</span>
        </button>
      </div>
    )}
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${STRIP_LG_COLS[cardCount] || 'lg:grid-cols-4'}`}>
      {hardwareSummary && (
        <button
          type="button"
          onClick={onSelectHardware}
          className={`flex flex-col justify-between text-left ${embedded ? 'p-3.5' : 'p-4'} rounded-2xl border transition-all active:scale-[0.985] ${
            onSelectHardware ? 'cursor-pointer' : 'cursor-default'
          } ${
            isHardwareSelected
              ? 'bg-white border-[#155484] ring-1 ring-[#155484]/25 shadow-xs'
              : 'bg-white hover:bg-slate-50/80 border-slate-200/90 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${hardwareGroup === 'SB' ? 'bg-[#4F518C]/10 text-[#4F518C]' : 'bg-[#184e77]/10 text-[#184e77]'}`}>
                <HardwareIcon className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-slate-800 truncate">{hardwareLabel}</span>
            </div>
            {isHardwareSelected && (
              <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[#155484] text-white shrink-0">
                Active
              </span>
            )}
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono text-slate-700 tabular-nums leading-none">
              {hardwareSummary.total.toLocaleString()}
            </span>
            <span className="text-[11px] text-slate-500 font-normal">Units</span>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-x-1.5 gap-y-0.5 flex-wrap text-[10.5px] text-slate-600 font-normal">
            <span title="Admin HQ Stock" className="whitespace-nowrap">
              In Stock: <span className="font-semibold text-[#002F4A]">{hardwareSummary.adminStock.toLocaleString()}</span>
            </span>
            <span title="Branch Reserve" className="whitespace-nowrap">
              Reserve: <span className="font-semibold text-sky-700">{hardwareSummary.branchReserve.toLocaleString()}</span>
            </span>
            <span title="Installed Live / Configuring" className="whitespace-nowrap">
              Live: <span className="font-semibold text-emerald-700">{hardwareSummary.live.toLocaleString()}</span>
            </span>
          </div>
        </button>
      )}
      {codes.map((c) => {
        const summary = summaries[c] || { total: 0, adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0 };
        const isSelected = selectedCode === c;
        const IconComp = c === 'BATTERY' ? Battery : c === 'STAND' ? Smartphone : c === 'DOCK' ? Dock : Plug;

        return (
          <button
            key={c}
            type="button"
            onClick={() => onSelectCode(c)}
            className={`flex flex-col justify-between text-left ${embedded ? 'p-3.5' : 'p-4'} rounded-2xl border transition-all cursor-pointer active:scale-[0.985] ${
              isSelected
                ? 'bg-white border-[#155484] ring-1 ring-[#155484]/25 shadow-xs'
                : 'bg-white hover:bg-slate-50/80 border-slate-200/90 shadow-2xs'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  c === 'BATTERY' ? 'bg-amber-50 text-amber-700' :
                  c === 'STAND' ? 'bg-indigo-50 text-indigo-700' :
                  c === 'DOCK' ? 'bg-sky-50 text-sky-700' :
                  c === 'SB_ADAPTOR' ? 'bg-purple-50 text-purple-700' :
                  'bg-slate-100 text-slate-700'
                }`}>
                  <IconComp className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-800 truncate">{materialName(c)}</span>
              </div>
              {isSelected && (
                <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[#155484] text-white shrink-0">
                  Active
                </span>
              )}
            </div>

            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold font-mono text-slate-700 tabular-nums leading-none">
                {summary.total.toLocaleString()}
              </span>
              <span className="text-[11px] text-slate-500 font-normal">Controlled</span>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-x-1.5 gap-y-0.5 flex-wrap text-[10.5px] text-slate-600 font-normal">
              <span title="Available In Stock (Head Office)" className="whitespace-nowrap">
                In Stock: <span className="font-semibold text-[#002F4A]">{summary.adminStock.toLocaleString()}</span>
              </span>
              <span title="Under Branch Reserve" className="whitespace-nowrap">
                Reserve: <span className="font-semibold text-sky-700">{summary.branchReserve.toLocaleString()}</span>
              </span>
              <span title="Bundled with Device (Serial & MID)" className="whitespace-nowrap">
                Bundled: <span className="font-semibold text-emerald-700">{summary.deployed.toLocaleString()}</span>
              </span>
            </div>
          </button>
        );
      })}
    </div>
  </div>
  );
};

const ProductStockPageComponent: React.FC<{
  group: DeviceGroup;
  role: UserRole;
  branches: Branch[];
  myBranch: string;
  triggerToast: (m: string) => void;
  units?: React.ReactNode;
  renderUnits?: (ctx: {
    stockScopeControl: React.ReactNode;
    materialSummaryStrip: React.ReactNode | null;
    heroControlsContainer?: HTMLElement | null;
  }) => React.ReactNode;
  push?: React.ReactNode;
  pushCount?: number;
  lostCount?: number;
  view: ProductView;
  onViewChange: (v: ProductView) => void;
  onLostChanged?: () => void;
  devices?: Device[];
  users?: User[];
  excludedSerials?: Set<string>;
  hardwareSummary?: HardwareSummaryMetric;
  pipelineBar?: React.ReactNode;
  kpiCards?: React.ReactNode;
}> = ({
  group,
  role,
  branches,
  myBranch,
  triggerToast,
  units,
  renderUnits,
  push,
  pushCount,
  lostCount,
  view,
  onViewChange,
  onLostChanged,
  devices = [],
  users = [],
  excludedSerials,
  hardwareSummary,
  pipelineBar,
  kpiCards,
}) => {
  const Icon = group === 'POS' ? Cpu : Volume2;
  const title = group === 'POS' ? 'POS Terminal' : 'Sound Box';

  const [unitsScope, setUnitsScope] = useState<'HARDWARE' | 'MATERIAL'>('HARDWARE');
  const [selectedMaterialCode, setSelectedMaterialCode] = useState<MaterialCode | 'ALL'>('ALL');
  const [hasExplicitCardSelection, setHasExplicitCardSelection] = useState(false);
  const [materialSnap, setMaterialSnap] = useState<{
    summaries: Partial<Record<MaterialCode, MaterialSummaryMetric>>;
    total: number;
  }>({ summaries: {}, total: 0 });
  const [matPrewarmed, setMatPrewarmed] = useState(false);
  const [heroUnitControlsSlot, setHeroUnitControlsSlot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    setUnitsScope('HARDWARE');
    setSelectedMaterialCode('ALL');
    setHasExplicitCardSelection(false);
    setMatPrewarmed(false);
    const t = setTimeout(() => setMatPrewarmed(true), 60);
    return () => clearTimeout(t);
  }, [group]);

  const handleSummariesChange = useCallback(
    (summaries: Partial<Record<MaterialCode, MaterialSummaryMetric>>, total: number) => {
      setMaterialSnap({ summaries, total });
    },
    []
  );

  const matsForGroup = useMemo(() => productMaterials(group), [group]);

  const viewToggle = (
    <ProductViewToggle
      view={view}
      onViewChange={(next) => {
        if (next === 'UNITS' && view === 'UNITS' && unitsScope === 'MATERIAL') {
          React.startTransition(() => setUnitsScope('HARDWARE'));
          return;
        }
        onViewChange(next);
      }}
      group={group}
      pushCount={pushCount}
      lostCount={lostCount}
      hasPush={Boolean(push)}
    />
  );

  const stockScopeControl = (
    <select
      aria-label="Filter Stock Type or Material"
      value={unitsScope === 'HARDWARE' ? 'HARDWARE' : selectedMaterialCode}
      onChange={(e) => {
        const val = e.target.value;
        React.startTransition(() => {
          if (val === 'HARDWARE') {
            setUnitsScope('HARDWARE');
          } else {
            setSelectedMaterialCode(val as MaterialCode | 'ALL');
            setUnitsScope('MATERIAL');
          }
        });
      }}
      className="px-3 py-2 rounded-xl text-xs font-normal border bg-white border-slate-200/90 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
      title="Filter between Hardware Units and Material stock in-place"
    >
      <option value="HARDWARE">Hardware Units</option>
      <option value="ALL">
        All Material Types{materialSnap.total > 0 ? ` (${materialSnap.total.toLocaleString()})` : ''}
        {lostCount ? ` · ${lostCount} Lost` : ''}
      </option>
      {matsForGroup.map((m) => {
        const s = materialSnap.summaries[m.code];
        return (
          <option key={m.code} value={m.code}>
            {m.name}{s ? ` (${s.total.toLocaleString()})` : ''}
          </option>
        );
      })}
    </select>
  );

  const computedHardwareSummary = useMemo<HardwareSummaryMetric | undefined>(() => {
    if (hardwareSummary) return hardwareSummary;
    const targetType = group === 'POS' ? 'POS Terminal' : 'Sound Box';
    const rows = devices.filter((d) => !d.archived && d.type === targetType);
    return {
      total: rows.length,
      adminStock: rows.filter((d) => d.stage === 'HQ_STOCK').length,
      branchReserve: rows.filter((d) => d.stage === 'BRANCH_RESERVE').length,
      live: rows.filter((d) => d.stage === 'COMPLETE' || d.stage === 'CONFIGURING').length,
    };
  }, [group, hardwareSummary, devices]);

  const materialSummaryStrip = (
    <MaterialSummaryCardsStrip
      embedded
      hardwareGroup={group}
      codes={matsForGroup.map((m) => m.code)}
      summaries={materialSnap.summaries}
      selectedCode={view === 'UNITS' && unitsScope === 'MATERIAL' ? selectedMaterialCode : null}
      hardwareSummary={computedHardwareSummary}
      isHardwareSelected={hasExplicitCardSelection && view === 'UNITS' && unitsScope === 'HARDWARE'}
      onSelectHardware={() => {
        if (view !== 'UNITS') onViewChange('UNITS');
        React.startTransition(() => {
          setHasExplicitCardSelection(true);
          setUnitsScope('HARDWARE');
        });
      }}
      lostCount={lostCount}
      onOpenLostMaterials={() => {
        if (view !== 'UNITS') onViewChange('UNITS');
        React.startTransition(() => {
          setHasExplicitCardSelection(true);
          setSelectedMaterialCode('ALL');
          setUnitsScope('MATERIAL');
        });
      }}
      onSelectCode={(code) => {
        if (view !== 'UNITS') onViewChange('UNITS');
        React.startTransition(() => {
          setHasExplicitCardSelection(true);
          setSelectedMaterialCode(code);
          setUnitsScope('MATERIAL');
        });
      }}
    />
  );

  const hardwareNode = renderUnits
    ? renderUnits({
        stockScopeControl,
        materialSummaryStrip: null,
        heroControlsContainer: view === 'UNITS' && unitsScope === 'HARDWARE' ? heroUnitControlsSlot : null,
      })
    : units;
  const unifiedUnitsNode = (
    <div className="w-full">
      <div hidden={unitsScope !== 'HARDWARE'} className="w-full">
        {hardwareNode}
      </div>
      {(matPrewarmed || unitsScope === 'MATERIAL') && (
        <div hidden={unitsScope !== 'MATERIAL'} className="w-full">
          <MaterialStockPanel
            group={group}
            role={role}
            branches={branches}
            myBranch={myBranch}
            triggerToast={triggerToast}
            onLostChanged={onLostChanged}
            devices={devices}
            users={users}
            excludedSerials={excludedSerials}
            selectedCode={selectedMaterialCode}
            onSelectedCodeChange={setSelectedMaterialCode}
            onSwitchToUnits={() => React.startTransition(() => setUnitsScope('HARDWARE'))}
            onSummariesChange={handleSummariesChange}
            heroControlsContainer={view === 'UNITS' && unitsScope === 'MATERIAL' ? heroUnitControlsSlot : null}
          />
        </div>
      )}
    </div>
  );

  // views opened so far on this product page (a new product page starts again)
  const seenRef = useRef<{ group: DeviceGroup; set: Set<ProductView> }>({ group, set: new Set() });
  if (seenRef.current.group !== group) seenRef.current = { group, set: new Set() };
  const seen = seenRef.current.set;
  seen.add(view);

  // Eagerly pre-warm views so switching is 100% instant with zero delay or flicker
  const [, setPrewarmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      seen.add('UNITS');
      seen.add('PUSH');
      setPrewarmed(true);
    }, 60);
    return () => clearTimeout(t);
  }, [group]);

  const panes: [ProductView, React.ReactNode][] = [
    ['UNITS', unifiedUnitsNode],
    ['PUSH', push || null],
  ];
  const shownView = useRef<ProductView>(view);
  useLayoutEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
  }, [view]);

  return (
    <div className="flex flex-col gap-4 apple-tab-panel">
      {/* Soft Slate Hero Backdrop (matching Push Configuring Hub / KHQR / KPI Performance) */}
      <section
        className="relative overflow-hidden rounded-3xl p-5 sm:p-7 border shadow-sm bg-slate-100 border-slate-200/90 text-slate-900 space-y-5"
        aria-label={`${title} overview`}
      >
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-3 text-slate-900 leading-tight">
              <Icon className={`w-7 h-7 sm:w-8 sm:h-8 shrink-0 ${group === 'POS' ? 'text-[#184e77]' : 'text-[#4F518C]'}`} aria-hidden />
              <span>{title}</span>
            </h1>
            <p className="text-xs sm:text-sm leading-relaxed text-slate-600">
              {group === 'POS'
                ? 'Hardware inventory, controlled accessories, branch reserve, and push configuring across Phnom Penh.'
                : 'Sound Box stock inventory, branch reserve, push configuring queue, and live merchant deployments.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {viewToggle}
          </div>
        </div>

        {/* Stage Pills & Summary Strip stay cleanly anchored inside the backdrop */}
        {pipelineBar}
        {(materialSummaryStrip || kpiCards) && (
          <div className="pt-5 border-t border-slate-200/90 space-y-4">
            {materialSummaryStrip}
            {kpiCards && <div className="[&>.kpi-strip]:mb-0">{kpiCards}</div>}
          </div>
        )}
        {view === 'UNITS' && (
          <div ref={setHeroUnitControlsSlot} className="pt-4 border-t border-slate-200/90 space-y-3" />
        )}
      </section>

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

const PRIMARY_MATERIAL_STEPS: { status: SerialStatus; step: string; label: string }[] = [
  { status: 'HQ_STOCK', step: '1', label: 'Available In Stock' },
  { status: 'BRANCH_RESERVE', step: '2', label: 'Branch Reserve' },
  { status: 'AT_MERCHANT', step: '3', label: 'Bundled (Serial & MID)' },
];
const MATERIAL_STATUS_DISPLAY: Record<SerialStatus, string> = {
  HQ_STOCK: 'Available In Stock',
  IN_TRANSIT: 'In Transit',
  BRANCH_RESERVE: 'Branch Reserve',
  AT_MERCHANT: 'Bundled Live',
  LOST: 'Lost',
  FAULTY: 'Faulty',
  WRITTEN_OFF: 'Written Off',
};

/** Material is Available In Stock whenever it is at Head Office (100) or not yet used for any MID or Serial. */
function effectiveMaterialStatus(s: MaterialSerial, dev?: Device): SerialStatus {
  if (s.status === 'LOST' || s.status === 'FAULTY' || s.status === 'WRITTEN_OFF' || s.status === 'IN_TRANSIT') {
    return s.status;
  }
  const hasMidOrMerchant = Boolean(
    (s.mid && s.mid.trim()) ||
    (s.merchantName && s.merchantName.trim()) ||
    (dev && ((dev.mid && dev.mid.trim()) || (dev.merchantName && dev.merchantName.trim())))
  );
  if (s.status === 'AT_MERCHANT' && !hasMidOrMerchant && !(s.deviceSerial && s.deviceSerial.trim())) {
    return !s.branchId || s.branchId === '100' ? 'HQ_STOCK' : 'BRANCH_RESERVE';
  }
  if (s.status === 'BRANCH_RESERVE' && (!s.branchId || s.branchId === '100') && !hasMidOrMerchant) {
    return 'HQ_STOCK';
  }
  return s.status;
}

const MaterialStockPanelComponent: React.FC<{
  group: DeviceGroup;
  role: UserRole;
  branches: Branch[];
  myBranch: string;
  triggerToast: (m: string) => void;
  onLostChanged?: () => void;
  devices?: Device[];
  users?: User[];
  excludedSerials?: Set<string>;
  hideHero?: boolean;
  viewToggle?: React.ReactNode;
  selectedCode?: MaterialCode | 'ALL';
  onSelectedCodeChange?: (code: MaterialCode | 'ALL') => void;
  onSwitchToUnits?: () => void;
  onSummariesChange?: (summaries: Partial<Record<MaterialCode, MaterialSummaryMetric>>, totalCount: number) => void;
  heroControlsContainer?: HTMLElement | null;
}> = ({
  group, role, branches, myBranch, triggerToast, onLostChanged, devices = [], users = [], excludedSerials, viewToggle,
  selectedCode: selectedCodeProp, onSelectedCodeChange, onSwitchToUnits, onSummariesChange, heroControlsContainer,
}) => {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [cachedStaff, setCachedStaff] = useState<StaffAccount[] | null>(() => getCachedStaff());
  useEffect(() => onStaffList(setCachedStaff), []);
  const ppScope = useMemo(
    () => buildPpDirectoryScope(branches, users, cachedStaff),
    [branches, users, cachedStaff]
  );
  const mats = useMemo(() => productMaterials(group), [group]);
  const codes = useMemo(() => mats.map((m) => m.code), [mats]);

  // Tab & Table Filter States
  const [internalSelectedCode, setInternalSelectedCode] = useState<MaterialCode | 'ALL'>('ALL');
  const selectedCode = selectedCodeProp !== undefined ? selectedCodeProp : internalSelectedCode;
  const setSelectedCode = useCallback(
    (code: MaterialCode | 'ALL') => {
      setInternalSelectedCode(code);
      onSelectedCodeChange?.(code);
    },
    [onSelectedCodeChange]
  );
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
  const [managingItem, setManagingItem] = useState<MaterialSerial | null>(null);

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
  const deviceDerivedItems = useMemo(() => deriveDeviceKitMaterials(devices, group), [devices, group]);

  // Load balances from material_balances
  const load = useCallback(async (force = false, silent = false) => {
    try {
      if (!silent) setLoading(true);
      const b = await fetchMaterialBalances(force);
      setBalances(b || []);
      setErr('');
    } catch (e) {
      const m = cleanMaterialError(e);
      setErr(isMaterialsMissing(m) ? 'SETUP' : m);
    } finally {
      if (!silent) setLoading(false);
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

  useEffect(() => {
    let timer = 0;
    const unsub = onPortalSync(['materials', 'devices', 'requisitions'], () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setCountsKey((k) => k + 1);
        void load(true, true);
        void loadSerials(true);
      }, 350);
    });
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, [load, loadSerials]);

  const changed = () => {
    clearMaterialsCache();
    setCountsKey((k) => k + 1);
    load(true);
    loadSerials(true);
    onLostChanged?.();
  };

  const handleManageSave = async (payload: {
    item: MaterialSerial;
    status: SerialStatus;
    branchId: string;
    deviceSerial: string | null;
    note: string | null;
  }) => {
    const { item, status, branchId, deviceSerial, note } = payload;
    const isSerialTracked = materialByCode.get(item.code)?.tracking === 'SERIAL';
    const itemRef = isSerialTracked ? { code: item.code, serial: item.serial } : { code: item.code, qty: 1 };

    try {
      // 1. If previously bundled on a device and either unbundling or moving to another device
      if (item.status === 'AT_MERCHANT' && item.deviceSerial && (status !== 'AT_MERCHANT' || deviceSerial !== item.deviceSerial)) {
        const result: 'RETURNED' | 'LOST' | 'FAULTY' =
          status === 'LOST' ? 'LOST' : status === 'FAULTY' || status === 'WRITTEN_OFF' ? 'FAULTY' : 'RETURNED';
        await kitReturn({
          device_serial: item.deviceSerial,
          items: [{ ...itemRef, result, remark: note || `Moved to ${MATERIAL_STATUS_DISPLAY[status]}` }],
        });
      }

      // 2. If bundling onto a device
      if (status === 'AT_MERCHANT' && deviceSerial) {
        if (item.status !== 'AT_MERCHANT' || item.deviceSerial !== deviceSerial) {
          await kitAdd({
            device_serial: deviceSerial,
            from_stock: item.status === 'HQ_STOCK' || item.status === 'BRANCH_RESERVE',
            items: [{ ...itemRef, note: note || undefined }],
          });
        }
      } else if (isSerialTracked && (status === 'HQ_STOCK' || status === 'BRANCH_RESERVE' || status === 'FAULTY' || status === 'WRITTEN_OFF')) {
        // 3. Direct stock/reserve/status adjustment for serial-tracked items (e.g. Battery)
        await materialAdjust({
          code: item.code,
          branch_id: status === 'HQ_STOCK' ? '100' : branchId,
          serial: item.serial,
          status,
          reason: note || `Moved to ${MATERIAL_STATUS_DISPLAY[status]}`,
        });
      }
    } catch (e) {
      throw new Error(cleanMaterialError(e));
    }

    triggerToast(`${materialName(item.code)} ${item.serial} updated successfully.`);
    changed();
  };

  // Combine DB serials and device-derived items
  const combinedItems = useMemo(() => {
    const list: MaterialSerial[] = [];
    const seen = new Set<string>();
    const rawDb = dbSerials || [];

    for (let i = 0; i < rawDb.length; i++) {
      const r = rawDb[i];
      if (!ppScope.isBranchInScope(r.branchId)) continue;
      if (r.deviceSerial && excludedSerials?.has(r.deviceSerial.toUpperCase())) continue;
      const dev = r.deviceSerial ? deviceMap.get(r.deviceSerial.toUpperCase()) : undefined;
      const normStatus = effectiveMaterialStatus(r, dev);
      seen.add(`${r.code}|${r.serial.toUpperCase()}`);
      if (statusFilter && normStatus !== statusFilter) continue;
      list.push(normStatus === r.status ? r : { ...r, status: normStatus });
    }

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
  }, [dbSerials, deviceDerivedItems, selectedCode, statusFilter, branchFilter, assignmentFilter, search, deviceMap, branches, branchNameMap, ppScope, excludedSerials]);

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
      STAND: { code: 'STAND', name: 'POS Stand', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
      DOCK: { code: 'DOCK', name: 'Charging Dock', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
      BATTERY: { code: 'BATTERY', name: 'Battery', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
      SB_ADAPTOR: { code: 'SB_ADAPTOR', name: 'Sound Box AC Adaptor', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
      SIM: { code: 'SIM', name: 'SIM Card', adminStock: 0, branchReserve: 0, onHand: 0, deployed: 0, inTransit: 0, lost: 0, total: 0 },
    };

    // 1. Accumulate balances from DB material_balances (scoped to Phnom Penh branches)
    for (let i = 0; i < balances.length; i++) {
      const b = balances[i];
      if (b.branchId !== '100' && !ppScope.isBranchInScope(b.branchId)) continue;
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
  }, [balances, deviceDerivedItems, branchFilter, ppScope]);

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

        const total = onHand + deployed;

        if (total > 0) {
          if (statusFilter === 'HQ_STOCK' && !(bId === '100' && onHand > 0)) continue;
          if (statusFilter === 'BRANCH_RESERVE' && !(bId !== '100' && onHand > 0)) continue;
          if (statusFilter === 'AT_MERCHANT' && !(deployed > 0)) continue;

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
  }, [branches, selectedCode, codes, branchFilter, statusFilter, balances, deviceDerivedItems, search]);

  // Status counts across all loaded items
  const dynamicStatusCounts = useMemo(() => {
    const res: Record<SerialStatus, number> = {
      HQ_STOCK: 0, IN_TRANSIT: 0, BRANCH_RESERVE: 0, AT_MERCHANT: 0, LOST: 0, FAULTY: 0, WRITTEN_OFF: 0,
    };
    if (counts) {
      Object.assign(res, counts);
    }
    const seen = new Set<string>();
    const rawDb = dbSerials || [];
    for (let i = 0; i < rawDb.length; i++) {
      const r = rawDb[i];
      seen.add(`${r.code}|${r.serial.toUpperCase()}`);
      if (!statusFilter && !search) {
        const dev = r.deviceSerial ? deviceMap.get(r.deviceSerial.toUpperCase()) : undefined;
        const norm = effectiveMaterialStatus(r, dev);
        if (norm !== r.status) {
          if (res[r.status] > 0) res[r.status]--;
          res[norm]++;
        }
      }
    }
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
  }, [counts, dbSerials, deviceDerivedItems, selectedCode, branchFilter, statusFilter, search, deviceMap]);

  const totalAllItems = useMemo(
    () => Object.values(dynamicStatusCounts).reduce((a, b) => a + b, 0),
    [dynamicStatusCounts]
  );

  // Sync summary metrics upward to the unified Units view when values change (branch/search unfiltered)
  const lastSummarySigRef = useRef('');
  useEffect(() => {
    if (!onSummariesChange || branchFilter || search) return;
    const totalUnfiltered = codes.reduce((acc, c) => acc + (materialSummaries[c]?.total || 0), 0);
    const sig = codes
      .map((c) => {
        const s = materialSummaries[c];
        return s ? `${c}:${s.total}:${s.adminStock}:${s.branchReserve}:${s.deployed}` : c;
      })
      .join('|') + `#${totalUnfiltered}`;
    if (sig !== lastSummarySigRef.current) {
      lastSummarySigRef.current = sig;
      onSummariesChange(materialSummaries, totalUnfiltered);
    }
  }, [onSummariesChange, codes, materialSummaries, branchFilter, search]);

  // Pagination for both ledger views
  const pg = usePager(combinedItems.length, [selectedCode, statusFilter, branchFilter, assignmentFilter, search]);
  const displayedItems = useMemo(
    () => combinedItems.slice(pg.start, pg.drawEnd),
    [combinedItems, pg.start, pg.drawEnd]
  );
  const balPg = usePager(branchBalanceRows.length, [selectedCode, statusFilter, branchFilter, search]);
  const displayedBalanceRows = useMemo(
    () => branchBalanceRows.slice(balPg.start, balPg.drawEnd),
    [branchBalanceRows, balPg.start, balPg.drawEnd]
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
        'Branch Code', 'Branch Name', 'Material Type', 'Available (On Hand)',
        'Bundled Live', 'Total Controlled'
      ],
      branchBalanceRows.map((r) => [
        r.branchId,
        r.branchName,
        r.materialName,
        r.onHand,
        r.deployed,
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

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      {isAdmin && (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.985 }}
          type="button"
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700/20 transition cursor-pointer shadow-xs"
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
          whileTap={{ scale: 0.985 }}
          type="button"
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 transition cursor-pointer shadow-2xs"
          onClick={() => {
            setDlgParams({ code: selectedCode !== 'ALL' ? selectedCode : codes[0], branchId: branchFilter || '100' });
            setDlg('ADJUST');
          }}
        >
          <PencilLine className="w-3.5 h-3.5 text-slate-600" />
          <span>Correct</span>
        </motion.button>
      )}
      {isAdmin && (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.985 }}
          type="button"
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 transition cursor-pointer shadow-2xs"
          onClick={() => setDlg('OPENING')}
        >
          <Upload className="w-3.5 h-3.5 text-slate-600" />
          <span>Opening stock</span>
        </motion.button>
      )}
      <motion.button
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.985 }}
        type="button"
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 transition cursor-pointer shadow-2xs"
        onClick={activeLedgerView === 'BALANCES' ? exportBalancesCsv : exportDetailedInventoryCsv}
      >
        <Download className="w-3.5 h-3.5 text-emerald-600" />
        <span>Export CSV</span>
      </motion.button>
      <motion.button
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.985 }}
        type="button"
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 transition cursor-pointer shadow-2xs"
        onClick={changed}
        aria-label="Refresh"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-slate-600" />}
        <span>Refresh</span>
      </motion.button>
    </div>
  );

  const filterToolbar = (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={group === 'POS' ? 'Search serial, POS, MID...' : 'Search serial, Sound Box, MID...'}
              className="w-full pl-8 pr-3 py-2 rounded-xl text-xs font-semibold border bg-white border-slate-200/90 text-zinc-900 placeholder:text-slate-400 focus:border-zinc-700 outline-none transition shadow-2xs"
            />
          </div>

          <select
            aria-label="Select Material Category"
            value={selectedCode}
            onChange={(e) => {
              if (e.target.value === 'HARDWARE') {
                onSwitchToUnits?.();
              } else {
                setSelectedCode(e.target.value as MaterialCode | 'ALL');
              }
            }}
            className="px-3 py-2 rounded-xl text-xs font-normal border bg-white border-slate-200/90 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs min-w-[165px]"
          >
            {onSwitchToUnits && <option value="HARDWARE">Hardware Units</option>}
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

          <div className="min-w-[175px]">
            {isAdmin ? (
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs font-normal border bg-white border-slate-200/90 text-zinc-800 focus:border-zinc-700 outline-none cursor-pointer shadow-2xs"
              >
                <option value="">All locations</option>
                <option value="100">100 · Head Office</option>
                {branches
                  .filter((b) => b.id !== '100' && b.code !== '100')
                  .map((b) => (
                    <option key={b.code || b.id} value={b.code || b.id}>
                      {b.code || b.id} · {b.name}
                    </option>
                  ))}
              </select>
            ) : (
              <div className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border flex items-center gap-2 bg-white border-slate-200/90 text-zinc-900">
                <Building2 className="w-3.5 h-3.5" />
                <span>Scoped to Branch Code: {myBranch}</span>
              </div>
            )}
          </div>

          <div
            className={CAPSULE_TRACK_COMPACT_CLS}
            role="tablist"
            aria-label="Ledger views"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeLedgerView === 'DEPLOYMENTS'}
              aria-pressed={activeLedgerView === 'DEPLOYMENTS'}
              onClick={() => React.startTransition(() => setActiveLedgerView('DEPLOYMENTS'))}
              className={`relative px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors select-none outline-none inline-flex items-center gap-1.5 ${
                activeLedgerView === 'DEPLOYMENTS' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
              }`}
            >
              {activeLedgerView === 'DEPLOYMENTS' && (
                <PillMotion
                  layoutId={SHARED_LAYOUT_IDS.MATERIAL_LEDGER_PILL}
                  aria-hidden
                  className={CAPSULE_PILL_CLS}
                  transition={SPRING_TAB_PILL}
                />
              )}
              <Package className="relative z-10 w-3.5 h-3.5 shrink-0 text-[#004e75] dark:text-sky-400" aria-hidden />
              <span className="relative z-10">Inventory ({combinedItems.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeLedgerView === 'BALANCES'}
              aria-pressed={activeLedgerView === 'BALANCES'}
              onClick={() => React.startTransition(() => setActiveLedgerView('BALANCES'))}
              className={`relative px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors select-none outline-none inline-flex items-center gap-1.5 ${
                activeLedgerView === 'BALANCES' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
              }`}
            >
              {activeLedgerView === 'BALANCES' && (
                <PillMotion
                  layoutId={SHARED_LAYOUT_IDS.MATERIAL_LEDGER_PILL}
                  aria-hidden
                  className={CAPSULE_PILL_CLS}
                  transition={SPRING_TAB_PILL}
                />
              )}
              <Building2 className="relative z-10 w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <span className="relative z-10">Branch Stock ({branchBalanceRows.length})</span>
            </button>
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

        {heroControlsContainer && actionButtons}
      </div>

      {/* 3-Step Lifecycle & Status Filter Pills */}
      <div className={`${CAPSULE_TRACK_CLS} flex-wrap`} role="tablist" aria-label="Status">
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === ''}
          aria-pressed={statusFilter === ''}
          onClick={() => React.startTransition(() => setStatusFilter(''))}
          className={`relative px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
            statusFilter === '' ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
          }`}
        >
          {statusFilter === '' && (
            <PillMotion
              layoutId="material-step-status-pill"
              aria-hidden
              className={CAPSULE_PILL_CLS}
              transition={SPRING_TAB_PILL}
            />
          )}
          <span className="w-2 h-2 rounded-full bg-[#004e75] relative z-10 shrink-0" aria-hidden />
          <span className="relative z-10">All</span>
          <span className={`relative z-10 text-[10.5px] px-1.5 py-0.2 rounded-full tabular-nums transition-colors ${statusFilter === '' ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
            {totalAllItems?.toLocaleString() ?? '—'}
          </span>
        </button>
        {PRIMARY_MATERIAL_STEPS.map((item) => {
          const active = statusFilter === item.status;
          const stepColor = item.status === 'AT_MERCHANT' ? 'bg-emerald-500' : item.status === 'BRANCH_RESERVE' ? 'bg-amber-500' : 'bg-sky-500';
          return (
            <button
              key={item.status}
              type="button"
              role="tab"
              aria-selected={active}
              aria-pressed={active}
              onClick={() => React.startTransition(() => setStatusFilter(item.status))}
              className={`relative px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                active ? CAPSULE_BTN_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
              }`}
            >
              {active && (
                <PillMotion
                  layoutId="material-step-status-pill"
                  aria-hidden
                  className={CAPSULE_PILL_CLS}
                  transition={SPRING_TAB_PILL}
                />
              )}
              <span className={`relative z-10 w-2 h-2 rounded-full shrink-0 ${stepColor}`} aria-hidden />
              <span className="relative z-10">{item.step}. {item.label}</span>
              <span className={`relative z-10 text-[10.5px] px-1.5 py-0.2 rounded-full tabular-nums transition-colors ${active ? CAPSULE_COUNT_ACTIVE_CLS : CAPSULE_COUNT_INACTIVE_CLS}`}>
                {(dynamicStatusCounts[item.status] ?? 0).toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {heroControlsContainer && createPortal(filterToolbar, heroControlsContainer)}

      {/* Executive Material Inventory Ledger Card */}
      <section
        className="surface-card rounded-2xl overflow-hidden border border-slate-200/90 shadow-sm"
        aria-label={group === 'POS' ? 'POS Materials Inventory Table' : 'Sound Box Materials Inventory Table'}
      >
        {!heroControlsContainer && (
          <>
            <div className="bg-slate-100 border-b border-slate-200/90 px-5 py-4 min-h-[78px] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
                  <Boxes className="w-5 h-5 text-slate-700" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-slate-900">
                    {group === 'POS' ? 'POS Terminal Materials' : 'Sound Box Materials'}
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-slate-200 text-slate-700">
                    {totalAllItems?.toLocaleString() ?? combinedItems.length}
                  </span>
                </div>
              </div>
              {actionButtons}
            </div>
            <div className="p-4 bg-slate-50/70 border-b border-slate-200/90">
              {filterToolbar}
            </div>
          </>
        )}

        {/* Dynamic Table: View 1 (Merchant Deployments) OR View 2 (Multi-Branch Balances) */}
        {activeLedgerView === 'BALANCES' ? (
          /* Clean Grouped Branch Stock Matrix */
          <div className="overflow-x-auto overflow-y-hidden">
            <table className="w-full min-w-[820px] text-sm text-left">
              <thead>
                <tr className="bg-[#155484] text-white text-[10.5px] uppercase tracking-wider font-bold select-none">
                  <th className="px-4 py-3 text-center w-12">No.</th>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Material Type</th>
                  <th className="px-4 py-3 text-right">Available (On Hand)</th>
                  <th className="px-4 py-3 text-right">Bundled Live</th>
                  <th className="px-4 py-3 text-right font-bold">Total</th>
                  {isAdmin && <th className="px-4 py-3 text-center w-44">Action</th>}
                </tr>
              </thead>
              <tbody className="text-xs">
                {displayedBalanceRows.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 6} className="px-4 py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                        <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                          <Boxes className="w-5 h-5 text-slate-400" />
                        </div>
                        <p className="font-bold text-slate-700 text-sm">No branch balances match</p>
                        <p className="text-xs text-slate-500">
                          {branchFilter || statusFilter || selectedCode !== 'ALL' || search
                            ? 'Clear active filters or click "Stock In" to allocate stock.'
                            : 'Click "Stock In" above to allocate accessory units into branch stock.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  displayedBalanceRows.map((r, idx) => {
                    const isFirstForBranch = idx === 0 || displayedBalanceRows[idx - 1].branchId !== r.branchId;
                    return (
                      <tr
                        key={`bal-${r.branchId}-${r.code}-${idx}`}
                        className={`hover:bg-slate-50/90 transition-colors ${
                          idx === 0 ? '' : isFirstForBranch ? 'border-t border-slate-200' : 'border-t border-slate-100/80'
                        }`}
                      >
                        <td className="px-4 py-2.5 text-center font-mono text-slate-400 tabular-nums">
                          {balPg.start + idx + 1}
                        </td>

                        <td className="px-4 py-2.5">
                          {isFirstForBranch ? (
                            <div className="flex items-center gap-2 font-semibold text-slate-900">
                              <Building2 className="w-3.5 h-3.5 text-[#155484] shrink-0" />
                              <span className="truncate">{r.branchName}</span>
                            </div>
                          ) : (
                            <div className="pl-5 text-slate-300 select-none" aria-hidden="true">↳</div>
                          )}
                        </td>

                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {getMaterialBadge(r.code)}
                        </td>

                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                          <span className={r.onHand > 0 ? 'font-semibold text-[#002F4A]' : 'text-slate-300'}>
                            {r.onHand.toLocaleString()}
                          </span>
                        </td>

                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                          <span className={r.deployed > 0 ? 'font-semibold text-emerald-700' : 'text-slate-300'}>
                            {r.deployed.toLocaleString()}
                          </span>
                        </td>

                        <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {r.total.toLocaleString()}
                        </td>

                        {isAdmin && (
                          <td className="px-4 py-2.5 text-center whitespace-nowrap">
                            <div className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition cursor-pointer whitespace-nowrap"
                                onClick={() => {
                                  setDlgParams({ code: r.code, branchId: r.branchId });
                                  setDlg('IN');
                                }}
                              >
                                + Stock In
                              </button>
                              <button
                                type="button"
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 hover:border-[#002F4A] hover:text-[#002F4A] text-slate-700 transition cursor-pointer whitespace-nowrap shadow-2xs"
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
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Merchant Deployments & Itemized Units Ledger */
          <div className="overflow-x-auto overflow-y-hidden">
            <table className="w-full min-w-[900px] text-sm text-left">
              <thead>
                <tr className="bg-[#155484] text-white text-[10.5px] uppercase tracking-wider font-bold select-none">
                  <th className="px-4 py-3 text-center w-12">No.</th>
                  <th className="px-4 py-3">Item Serial</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Material Type</th>
                  <th className="px-4 py-3">
                    {group === 'POS' ? 'Assigned POS Terminal' : 'Assigned Sound Box'}
                  </th>
                  <th className="px-4 py-3">Merchant / MID</th>
                  <th className="px-4 py-3">Deployment Date</th>
                  <th className="px-4 py-3">Branch Staff</th>
                  <th className="px-4 py-3">Branch Name</th>
                  {isAdmin && <th className="px-4 py-3 text-center w-24">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {displayedItems.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 10 : 9} className="px-4 py-12 text-center text-slate-400">
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
                    <tr key={`${s.code}-${s.serial}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
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
                        <StatusPill status={s.status} label={MATERIAL_STATUS_DISPLAY[s.status]} />
                      </td>

                      <td className="px-4 py-2.5">
                        {getMaterialBadge(s.code)}
                      </td>

                      <td className="px-4 py-2.5 font-mono font-normal text-slate-800">
                        {s.deviceSerial ? (
                          <span className="font-semibold text-slate-800">{s.deviceSerial}</span>
                        ) : (
                          <span className="text-slate-300 font-mono select-none" aria-hidden="true">&mdash;</span>
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

                      {isAdmin && (
                        <td className="px-4 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => setManagingItem(s)}
                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 hover:border-[#002F4A] hover:text-[#002F4A] text-slate-700 transition cursor-pointer shadow-2xs"
                          >
                            Manage
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pager */}
        <div className="p-3.5 border-t border-slate-100 bg-slate-50/50">
          <Pager pg={activeLedgerView === 'BALANCES' ? balPg : pg} />
        </div>
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
      <ManageMaterialModal
        item={managingItem}
        isOpen={Boolean(managingItem)}
        onClose={() => setManagingItem(null)}
        branches={branches}
        devices={devices}
        role={role}
        myBranch={myBranch}
        onSave={handleManageSave}
      />
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
    let timer = 0;
    const again = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void load(true); }, 350);
    };
    window.addEventListener('materials-updated', again);
    const unsubSync = onPortalSync(['materials', 'devices'], again);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('materials-updated', again);
      unsubSync();
    };
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
        <div className={`${CAPSULE_TRACK_CLS} text-xs`} role="tablist">
          {([
            { v: 'OPEN', l: 'Open', Icon: AlertTriangle, accent: 'text-amber-500' },
            { v: '', l: 'All', Icon: Boxes, accent: 'text-[#004e75]' },
          ] as const).map(({ v, l, Icon, accent }) => {
            const isSelected = filter === v;
            return (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onFilter(v)}
                className={`relative px-3 py-1 rounded-full cursor-pointer select-none transition-colors duration-150 outline-none inline-flex items-center gap-1.5 ${
                  isSelected ? CAPSULE_BTN_NAVY_ACTIVE_CLS : CAPSULE_BTN_INACTIVE_CLS
                }`}
              >
                {isSelected && (
                  <PillMotion
                    layoutId="active-lost-filter-pill"
                    aria-hidden
                    className={CAPSULE_PILL_CLS}
                    transition={SPRING_TAB_PILL}
                  />
                )}
                <Icon className={`relative z-10 w-3.5 h-3.5 shrink-0 transition-colors ${accent}`} aria-hidden />
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
      const resolvedStatus: SerialStatus = place === '100' && status === 'BRANCH_RESERVE' ? 'HQ_STOCK' : status;
      await materialAdjust(m.tracking === 'QTY' ? { code, branch_id: place, qty: Math.floor(Number(qty)), reason: reason.trim() }
        : { code, branch_id: place, serial, status: resolvedStatus, reason: reason.trim() });
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
      [b, 'POS AC Adaptor', 10, ''], [b, 'POS Stand', 3, ''], [b, 'Charging Dock', 1, ''], [b, 'Sound Box AC Adaptor', 5, ''],
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
