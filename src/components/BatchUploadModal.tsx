import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Branch, LifecycleStage, Device, ThemeMode, User } from '../types';
import { STAGE_META } from '../data/initialData';
import {
  X,
  FilePlus,
  Upload,
  AlertCircle,
  Cpu,
  Volume2,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
  FileSpreadsheet,
  RotateCcw,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  Building2,
  Layers,
  FileText,
  Ban,
  User as UserIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { normalizeMid, isValidMidForType, midRuleError } from '../utils/display';
import { parseCsv, detectDelimiter, csvFile } from '../utils/csv';
import { todayPP } from '../utils/time';
import { tidFromMid } from '../utils/tid';
import { validateStaffWithBranch } from '../utils/staffUtils';
import { CSV_BATCH_SIZE, CSV_BATCH_DELAY_MS, checkExistingSerialsOnServer } from '../services/supabaseService';

export type IntakeCycle = 'HQ_STOCK' | 'BRANCH_RESERVE' | 'CONFIGURING' | 'COMPLETE';

export interface CycleSchemaCol {
  id: string;
  label: string;
  desc: string;
  req: boolean;
}

export interface CycleSchemaInfo {
  cycle: IntakeCycle;
  name: string;
  tag: string;
  badge: string;
  description: string;
  filename: string;
  columns: CycleSchemaCol[];
  sampleRows: string[][];
}

export const CYCLE_SCHEMAS: Record<IntakeCycle, CycleSchemaInfo> = {
  HQ_STOCK: {
    cycle: 'HQ_STOCK',
    name: 'Admin HQ Stock Intake',
    tag: 'Admin Stock',
    badge: 'No Staff or Merchant required · Stock-In captured dynamically',
    description: 'Bulk intake into central warehouse (Branch 100). Stock-In date is auto-captured dynamically to upload date.',
    filename: 'template_admin_hq_stock.csv',
    columns: [
      { id: 'Serial_SN', label: 'Serial_SN', desc: 'Hardware Serial Number', req: true },
      { id: 'Product_Type', label: 'Product_Type', desc: 'POS Terminal | Sound Box', req: false },
      { id: 'Model', label: 'Model', desc: 'Hardware Model Name', req: false },
      { id: 'Battery_Serial', label: 'Battery_Serial', desc: 'Battery Serial Number', req: false },
      { id: 'Branch_Code', label: 'Branch_Code', desc: 'Branch ID (100 for HQ)', req: false },
      { id: 'Branch_Name', label: 'Branch_Name', desc: 'Head Office', req: false },
      { id: 'Lifecycle_Stage', label: 'Lifecycle_Stage', desc: 'HQ_STOCK', req: false },
    ],
    sampleRows: [
      ['WP5400PQ23200101', 'POS Terminal', 'Wizar POS Q2 Pro', 'BAT-1001', '100', 'Head Office', 'HQ_STOCK'],
      ['SB2026000101', 'Sound Box', 'Q161 Pro', 'BAT-SB-1001', '100', 'Head Office', 'HQ_STOCK'],
    ],
  },
  BRANCH_RESERVE: {
    cycle: 'BRANCH_RESERVE',
    name: 'Branch Staff Reserve Intake',
    tag: 'Branch Staff Reserve',
    badge: 'Staff Assignment REQUIRED · Stock-In captured dynamically',
    description: 'Stock allocated to branch inventory assigned to a staff custodian officer. Stock-In date is auto-captured dynamically to upload date.',
    filename: 'template_branch_staff_reserve.csv',
    columns: [
      { id: 'Serial_SN', label: 'Serial_SN', desc: 'Hardware Serial Number', req: true },
      { id: 'Product_Type', label: 'Product_Type', desc: 'POS Terminal | Sound Box', req: false },
      { id: 'Model', label: 'Model', desc: 'Hardware Model Name', req: false },
      { id: 'Battery_Serial', label: 'Battery_Serial', desc: 'Battery Serial Number', req: false },
      { id: 'Branch_Code', label: 'Branch_Code', desc: 'Branch ID (e.g. 101, 102)', req: true },
      { id: 'Branch_Name', label: 'Branch_Name', desc: 'Branch Location Name', req: false },
      { id: 'Lifecycle_Stage', label: 'Lifecycle_Stage', desc: 'BRANCH_RESERVE', req: false },
      { id: 'Assigned_Staff', label: 'Assigned_Staff', desc: 'Staff Custodian Name / ID (Validated with Directory)', req: true },
    ],
    sampleRows: [
      ['WP5400PQ23200201', 'POS Terminal', 'Wizar POS Q2 Pro', 'BAT-2001', '101', 'Borei Keyla Branch', 'BRANCH_RESERVE', 'KY Vibol (27267)'],
      ['SB2026000201', 'Sound Box', 'Q161 Pro', 'BAT-SB-2001', '101', 'Borei Keyla Branch', 'BRANCH_RESERVE', 'SEOUN Chettra (25490)'],
    ],
  },
  CONFIGURING: {
    cycle: 'CONFIGURING',
    name: 'Under Configuring Intake',
    tag: 'Under Configuring',
    badge: 'Staff & Merchant Info (Name + 15-digit MID) REQUIRED · Stock-In & TID captured dynamically',
    description: 'Hardware undergoing merchant technical setup. Staff & Branch Code are validated with Staff Directory. Stock-In date and TID are auto-captured dynamically.',
    filename: 'template_under_configuring.csv',
    columns: [
      { id: 'Serial_SN', label: 'Serial_SN', desc: 'Hardware Serial Number', req: true },
      { id: 'Product_Type', label: 'Product_Type', desc: 'POS Terminal | Sound Box', req: false },
      { id: 'Model', label: 'Model', desc: 'Hardware Model Name', req: false },
      { id: 'Battery_Serial', label: 'Battery_Serial', desc: 'Battery Serial Number', req: false },
      { id: 'Branch_Code', label: 'Branch_Code', desc: 'Branch ID (e.g. 101)', req: true },
      { id: 'Branch_Name', label: 'Branch_Name', desc: 'Branch Location Name', req: false },
      { id: 'Lifecycle_Stage', label: 'Lifecycle_Stage', desc: 'CONFIGURING', req: false },
      { id: 'Assigned_Staff', label: 'Assigned_Staff', desc: 'Configuring Staff Officer (Validated with Directory)', req: true },
      { id: 'Merchant_Name', label: 'Merchant_Name', desc: 'Merchant Business Name', req: true },
      { id: 'MID', label: 'MID', desc: '15-digit MID (TID auto-derived)', req: true },
    ],
    sampleRows: [
      ['WP5400PQ23200301', 'POS Terminal', 'Wizar POS Q2 Pro', 'BAT-3001', '101', 'Borei Keyla Branch', 'CONFIGURING', 'KY Vibol (27267)', 'Amazon Cafe BKK', '100000000012345'],
      ['SB2026000301', 'Sound Box', 'Q161 Pro', 'BAT-SB-3001', '101', 'Borei Keyla Branch', 'CONFIGURING', 'SEOUN Chettra (25490)', 'Lucky Mart Tuol Kork', '100000000054321'],
    ],
  },
  COMPLETE: {
    cycle: 'COMPLETE',
    name: 'Installed Live Intake',
    tag: 'Live Merchant',
    badge: 'Staff & Merchant Info (Name + 15-digit MID) REQUIRED · Stock-In & TID captured dynamically',
    description: 'Active hardware live at merchant store. Staff & Branch Code are validated with Staff Directory. Stock-In date and TID are auto-captured dynamically.',
    filename: 'template_installed_live.csv',
    columns: [
      { id: 'Serial_SN', label: 'Serial_SN', desc: 'Hardware Serial Number', req: true },
      { id: 'Product_Type', label: 'Product_Type', desc: 'POS Terminal | Sound Box', req: false },
      { id: 'Model', label: 'Model', desc: 'Hardware Model Name', req: false },
      { id: 'Battery_Serial', label: 'Battery_Serial', desc: 'Battery Serial Number', req: false },
      { id: 'Branch_Code', label: 'Branch_Code', desc: 'Branch ID (e.g. 101)', req: true },
      { id: 'Branch_Name', label: 'Branch_Name', desc: 'Branch Location Name', req: false },
      { id: 'Lifecycle_Stage', label: 'Lifecycle_Stage', desc: 'COMPLETE', req: false },
      { id: 'Assigned_Staff', label: 'Assigned_Staff', desc: 'Field Deployment Officer (Validated with Directory)', req: true },
      { id: 'Merchant_Name', label: 'Merchant_Name', desc: 'Active Merchant Store', req: true },
      { id: 'MID', label: 'MID', desc: '15-digit MID (TID auto-derived)', req: true },
    ],
    sampleRows: [
      ['WP5400PQ23200401', 'POS Terminal', 'Wizar POS Q2 Pro', 'BAT-4001', '101', 'Borei Keyla Branch', 'COMPLETE', 'KY Vibol (27267)', 'Lucky Supermarket Monivong', '100000000098765'],
      ['SB2026000401', 'Sound Box', 'Q161 Pro', 'BAT-SB-4001', '101', 'Borei Keyla Branch', 'COMPLETE', 'SEOUN Chettra (25490)', 'Brown Coffee 57', '100000000087654'],
    ],
  },
};

export const SCHEMA_COLUMNS = [
  { id: 'Serial_SN', label: 'Serial_SN', desc: 'Hardware Serial Number', req: true },
  { id: 'Product_Type', label: 'Product_Type', desc: 'POS Terminal | Sound Box', req: false },
  { id: 'Model', label: 'Model', desc: 'Hardware Model Name', req: false },
  { id: 'Battery_Serial', label: 'Battery_Serial', desc: 'Battery Serial Number', req: false },
  { id: 'Branch_Code', label: 'Branch_Code', desc: 'Branch ID (e.g. 100, 101)', req: false },
  { id: 'Branch_Name', label: 'Branch_Name', desc: 'Branch Location Name', req: false },
  { id: 'Lifecycle_Stage', label: 'Lifecycle_Stage', desc: 'Current Stock Stage', req: false },
  { id: 'Assigned_Staff', label: 'Assigned_Staff', desc: 'Staff Directory Officer (Validated with Branch)', req: false },
  { id: 'Merchant_Name', label: 'Merchant_Name', desc: 'Assigned Merchant Business', req: false },
  { id: 'MID', label: 'MID', desc: 'MID (15 digits; TID auto-derived)', req: false },
];

export interface CsvCellValidationError {
  row: number;
  column: number;
  columnName: string;
  category: 'MISSING_REQUIRED' | 'INVALID_TYPE' | 'COLUMN_COUNT' | 'DUPLICATE_IN_FILE' | 'DUPLICATE_IN_DB';
  message: string;
}

export interface StagedItem {
  csvRowNumber?: number;
  serial: string;
  batterySerial: string;
  model: string;
  type: 'POS Terminal' | 'Sound Box';
  branchId: string;
  branchName: string;
  staff: string;
  stage: LifecycleStage;
  stockInDate?: string;
  merchantName?: string;
  mid?: string;
  tid?: string;
  redeployCount?: number;
  isDuplicate: boolean;
  isDuplicateInFile?: boolean;
  isAlreadyInDb?: boolean;
  alreadyInDbMessage?: string;
  stockOrigin?: 'EXISTING_HQ_STOCK' | 'NEW_SERIAL';
  /** Why this row cannot be imported (unknown branch, bad stage/date, column count…); any error halts the upload. */
  error?: string;
  cellErrors?: CsvCellValidationError[];
}

interface BatchUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
  users?: User[];
  existingDevices: Device[];
  onCommitBatch: (newDevices: Partial<Device>[]) => void | Promise<void>;
  activeBranchId: string;
  theme?: ThemeMode;
  /** Signed-in operator's name/label, recorded as the person who stocked the units in. */
  operatorLabel?: string;
}

// Normalize column header for robust matching
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Map a stage text to a LifecycleStage. Blank = the chosen default; text that matches nothing = null (row error). */
function parseStageValue(rawStage: string, fallback: LifecycleStage): LifecycleStage | null {
  const s = rawStage.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return fallback;
  if (s.includes('hq') || s.includes('admin') || s === 'hqstock') return 'HQ_STOCK';
  if (s.includes('reserve') || s === 'branchreserve') return 'BRANCH_RESERVE';
  if (s.includes('config') || s === 'branchconfig') return 'CONFIGURING';
  if (
    s.includes('live') ||
    s.includes('complete') ||
    s.includes('installed') ||
    s.includes('active') ||
    s.includes('deployed')
  ) {
    return 'COMPLETE';
  }
  if (s.includes('faulty') || s.includes('terminate') || s.includes('return')) return 'FAULTY';
  if (s.includes('lost')) return 'LOST';
  return null;
}

// Parse device type from row or serial format; returns null if an explicit non-empty type is invalid
function parseDeviceTypeStrict(rawType: string, serial: string): 'POS Terminal' | 'Sound Box' | null {
  const t = rawType.trim().toLowerCase();
  if (!t) {
    return serial.toUpperCase().startsWith('SB') ? 'Sound Box' : 'POS Terminal';
  }
  if (t.includes('sound') || t.includes('audio') || t.includes('box') || t === 'sb') {
    return 'Sound Box';
  }
  if (t.includes('pos') || t.includes('terminal') || t.includes('wizar')) {
    return 'POS Terminal';
  }
  return null;
}

const isDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** A branch picker you can type into: matches the code or any part of the name. */
const BranchSearch: React.FC<{
  value: string;
  branches: Branch[];
  inputClass: string;
  onChange: (id: string) => void;
}> = ({ value, branches, inputClass, onChange }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = branches.find((b) => b.id === value);
  const label = current ? `${current.id} · ${current.name}` : '';
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return branches.filter((b) => !t || b.id.toLowerCase().includes(t) || b.name.toLowerCase().includes(t)).slice(0, 60);
  }, [branches, q]);
  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label="Fallback branch"
        value={open ? q : label}
        placeholder="Search branch code or name…"
        onFocus={() => { setQ(''); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) { e.preventDefault(); onChange(list[0].id); setOpen(false); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
        className={`w-full rounded-xl px-3 py-1.5 text-xs font-semibold border transition ${inputClass}`}
      />
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white text-slate-900 shadow-lg py-1 text-xs">
          {list.length === 0 && <li className="px-3 py-2 text-slate-500">No branch matches.</li>}
          {list.map((b) => (
            <li key={b.id} role="option" aria-selected={b.id === value}
              onMouseDown={(e) => { e.preventDefault(); onChange(b.id); setOpen(false); }}
              className={`px-3 py-1.5 cursor-pointer hover:bg-slate-100 ${b.id === value ? 'bg-sky-50 font-semibold' : ''}`}>
              <span className="font-mono">{b.id}</span> · {b.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const BatchUploadModal: React.FC<BatchUploadModalProps> = ({
  isOpen,
  onClose,
  branches,
  users = [],
  existingDevices,
  onCommitBatch,
  theme = 'light',
  operatorLabel = '',
}) => {
  const directoryUsers: User[] = useMemo(() => {
    if (users && users.length > 0) return users;
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('crm_pos_users_v20') : null;
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  }, [users]);
  const [batchStep, setBatchStep] = useState<'INPUT' | 'PREVIEW'>('INPUT');
  const [method, setMethod] = useState<'tableCsv' | 'paste'>('tableCsv');

  // Master Table CSV State
  const [tableCsvText, setTableCsvText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showSchemaGuide, setShowSchemaGuide] = useState(false);
  const [copiedHeaders, setCopiedHeaders] = useState(false);
  const [uploadedFileMeta, setUploadedFileMeta] = useState<{ name: string; size: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Target stock destination defaults (used only for rows that give no branch / stage)
  const [defaultBranchId, setDefaultBranchId] = useState('100');
  const [defaultStage, setDefaultStage] = useState<LifecycleStage>('HQ_STOCK');
  const [defaultStaff, setDefaultStaff] = useState<string>('');

  const [isDraggingPos, setIsDraggingPos] = useState(false);
  const [isDraggingSb, setIsDraggingSb] = useState(false);

  const [inspectedCycle, setInspectedCycle] = useState<IntakeCycle | null>(null);
  const activeCycle: IntakeCycle =
    defaultStage === 'HQ_STOCK' || defaultStage === 'BRANCH_RESERVE' || defaultStage === 'CONFIGURING' || defaultStage === 'COMPLETE'
      ? defaultStage
      : 'HQ_STOCK';
  const activeCycleSchema = CYCLE_SCHEMAS[activeCycle];
  const currentInspectCycle = inspectedCycle || activeCycle;
  const currentInspectSchema = CYCLE_SCHEMAS[currentInspectCycle];

  const [stageFilter, setStageFilter] = useState<'ALL' | IntakeCycle>('ALL');

  const handleSelectStage = useCallback(
    (newStage: LifecycleStage | IntakeCycle) => {
      const cycle: IntakeCycle =
        newStage === 'BRANCH_RESERVE' || newStage === 'CONFIGURING' || newStage === 'COMPLETE'
          ? newStage
          : 'HQ_STOCK';
      setDefaultStage(newStage as LifecycleStage);
      setInspectedCycle(cycle);
      setStageFilter('ALL');

      if (newStage === 'HQ_STOCK') {
        setDefaultBranchId('100');
      } else if (newStage === 'BRANCH_RESERVE' && defaultBranchId === '100') {
        const nonHqBranch = branches.find((b) => b.id !== '100');
        if (nonHqBranch) {
          setDefaultBranchId(nonHqBranch.id);
        }
      }
    },
    [defaultBranchId, branches]
  );

  // Field 1: POS Terminal state (Method B: By Hardware Type)
  const [posModel, setPosModel] = useState('Wizar POS Q2 Pro');
  const [posPasteText, setPosPasteText] = useState('');

  // Field 2: Sound Box state (Method B: By Hardware Type)
  const [sbModel, setSbModel] = useState('Q161 Pro');
  const [sbPasteText, setSbPasteText] = useState('');
  const [commitNotice, setCommitNotice] = useState('');
  const [isCommittingBatches, setIsCommittingBatches] = useState(false);
  const [serverExistingSerials, setServerExistingSerials] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; rowsSent: number; totalRows: number } | null>(null);

  // Reset step when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setBatchStep('INPUT');
      setCommitNotice('');
      setIsCommittingBatches(false);
      setBatchProgress(null);
    }
  }, [isOpen]);

  const isLight = theme === 'light';
  const existingSerials = useMemo(() => {
    const set = new Set(existingDevices.map((d) => d.serial.trim().toUpperCase()));
    serverExistingSerials.forEach((s) => set.add(s));
    return set;
  }, [existingDevices, serverExistingSerials]);

  const defaultBranch = useMemo(
    () => branches.find((b) => b.id === defaultBranchId || b.code === defaultBranchId),
    [branches, defaultBranchId]
  );

  // Active staff members for the currently selected fallback branch
  const branchStaffOptions = useMemo(() => {
    if (!defaultBranchId || defaultBranchId === '100') {
      return directoryUsers.filter((u) => u.branchId === '100' && u.status !== 'Suspended');
    }
    const branchUsers = directoryUsers.filter(
      (u) => String(u.branchId).trim() === String(defaultBranchId).trim() && u.status !== 'Suspended'
    );
    const branchObj = branches.find((b) => b.id === defaultBranchId || b.code === defaultBranchId);
    const namesInBranch = new Set(branchUsers.map((u) => u.name.toLowerCase()));
    const extraStaff = (branchObj?.staff || [])
      .filter((s) => !namesInBranch.has(s.toLowerCase()))
      .map((s) => ({
        uid: `synth-${s}`,
        empId: '',
        name: s,
        label: s,
        branchId: defaultBranchId,
        branchName: branchObj?.name || '',
      }));
    return [...branchUsers, ...extraStaff];
  }, [defaultBranchId, directoryUsers, branches]);

  // Keep defaultStaff in sync when defaultBranchId changes
  React.useEffect(() => {
    if (branchStaffOptions.length > 0) {
      const exists = branchStaffOptions.some(
        (s: any) => s.name.toLowerCase() === defaultStaff.toLowerCase() || (s.empId && s.empId === defaultStaff)
      );
      if (!exists) {
        setDefaultStaff(branchStaffOptions[0].name);
      }
    } else {
      setDefaultStaff('');
    }
  }, [defaultBranchId, branchStaffOptions, defaultStaff]);
  const findBranch = (code: string) => branches.find((b) => b.id === code || b.code === code);
  const staffLabel = operatorLabel.trim();

  /** Branch for a row: its own code when given (unknown code = error, never defaulted), otherwise the chosen default. */
  const resolveBranch = (rawCode: string): { branch?: Branch; error?: string } => {
    const code = rawCode.trim();
    if (code) {
      if (!/^\d{3}$/.test(code) && !/^branch\s*\d{3}$/i.test(code)) {
        return { error: `Invalid Branch_Code data type "${code}" (expected 3-digit branch ID like 100, 101)` };
      }
      const digits = (code.match(/\d+/) || [''])[0];
      const b = digits ? findBranch(digits) : undefined;
      return b ? { branch: b } : { error: `Unknown branch code "${code}"` };
    }
    return defaultBranch ? { branch: defaultBranch } : { error: 'Missing required Branch_Code (and no fallback branch selected)' };
  };

  // Master Table CSV Parser with strict Client-Side Pre-Validation (Row & Column error pinpointing)
  const tableCsvBatch = useMemo(() => {
    if (!tableCsvText.trim()) return [];
    const rows = parseCsv(tableCsvText);
    if (rows.length === 0) return [];

    const normalizedTokens = rows[0].map(normalizeHeader);

    // Check if line 0 is a header row
    const hasHeader = normalizedTokens.some((t) =>
      [
        'stockindate',
        'serialsn',
        'serial',
        'sn',
        'producttype',
        'model',
        'branchcode',
        'branchname',
        'stage',
        'lifecyclestage',
        'assignedstaff',
        'staff',
        'merchantname',
        'mid',
        'tid',
      ].some((k) => t.includes(k))
    );

    let colMap: Record<string, number> = {};
    let dataStartIdx = 0;
    const expectedColCount = rows[0].length;
    const headerLabels: string[] = hasHeader
      ? rows[0].map((h, idx) => h.trim() || `Column_${idx + 1}`)
      : expectedColCount >= 6
      ? SCHEMA_COLUMNS.map((c) => c.label)
      : expectedColCount === 3
      ? ['Serial_SN', 'Battery_Serial', 'Branch_Code']
      : ['Serial_SN'];

    if (hasHeader) {
      dataStartIdx = 1;
      normalizedTokens.forEach((token, idx) => {
        if (/stock.*date|date/.test(token) && colMap.stockInDate === undefined) colMap.stockInDate = idx;
        else if (/(battery.*serial|battery.*sn|battery)/.test(token) && colMap.batterySerial === undefined) colMap.batterySerial = idx;
        else if (/(serial.*sn|serial.*num|serial|sn)/.test(token) && !/cycle/.test(token) && colMap.serial === undefined) colMap.serial = idx;
        else if (/(product.*type|hardware.*type|devicetype|type)/.test(token) && colMap.type === undefined) colMap.type = idx;
        else if (/model/.test(token) && colMap.model === undefined) colMap.model = idx;
        else if (/(branch.*code|branch.*id)/.test(token) && colMap.branchCode === undefined) colMap.branchCode = idx;
        else if (/branch.*name/.test(token) && colMap.branchName === undefined) colMap.branchName = idx;
        else if (/branch/.test(token) && colMap.branchCode === undefined) colMap.branchCode = idx;
        else if (/(lifecycle.*stage|stage|status)/.test(token) && colMap.stage === undefined) colMap.stage = idx;
        else if (/(assigned.*staff|staff.*officer|staff.*name|custodian|officer|staff)/.test(token) && colMap.staff === undefined) colMap.staff = idx;
        else if (/(merchant.*name|merchant)/.test(token) && !/merchantid/.test(token) && colMap.merchantName === undefined) colMap.merchantName = idx;
        else if (/(^mid$|merchant.*id)/.test(token) && colMap.mid === undefined) colMap.mid = idx;
        else if (/(^tid$|terminal.*id)/.test(token) && colMap.tid === undefined) colMap.tid = idx;
        else if (/(cycles|redeploy)/.test(token) && colMap.redeployCount === undefined) colMap.redeployCount = idx;
      });
    } else {
      const sample = rows[0];
      if (sample.length >= 6 && /^\d{4}-\d{2}-\d{2}/.test(sample[0])) {
        if (sample.length === 8) {
          colMap = { stockInDate: 0, serial: 1, type: 2, model: 3, batterySerial: 4, branchCode: 5, branchName: 6, stage: 7 };
        } else if (sample.length === 9) {
          colMap = { stockInDate: 0, serial: 1, type: 2, model: 3, batterySerial: 4, branchCode: 5, branchName: 6, stage: 7, staff: 8 };
        } else if (sample.length === 10) {
          colMap = { stockInDate: 0, serial: 1, type: 2, model: 3, batterySerial: 4, branchCode: 5, branchName: 6, stage: 7, staff: 8, merchantName: 9 };
        } else {
          colMap = {
            stockInDate: 0,
            serial: 1,
            type: 2,
            model: 3,
            batterySerial: 4,
            branchCode: 5,
            branchName: 6,
            stage: 7,
            staff: 8,
            merchantName: 9,
            mid: 10,
            tid: 11,
            redeployCount: 12,
          };
        }
      } else if (sample.length === 7) {
        // Exactly 7 columns: Serial_SN, Product_Type, Model, Battery_Serial, Branch_Code, Branch_Name, Lifecycle_Stage
        colMap = {
          serial: 0,
          type: 1,
          model: 2,
          batterySerial: 3,
          branchCode: 4,
          branchName: 5,
          stage: 6,
        };
      } else if (sample.length === 8) {
        // Exactly 8 columns: Serial_SN, Product_Type, Model, Battery_Serial, Branch_Code, Branch_Name, Lifecycle_Stage, Assigned_Staff
        colMap = {
          serial: 0,
          type: 1,
          model: 2,
          batterySerial: 3,
          branchCode: 4,
          branchName: 5,
          stage: 6,
          staff: 7,
        };
      } else if (sample.length === 10) {
        // Exactly 10 columns (TID auto-derived from MID): Serial_SN, Product_Type, Model, Battery_Serial, Branch_Code, Branch_Name, Lifecycle_Stage, Assigned_Staff, Merchant_Name, MID
        colMap = {
          serial: 0,
          type: 1,
          model: 2,
          batterySerial: 3,
          branchCode: 4,
          branchName: 5,
          stage: 6,
          staff: 7,
          merchantName: 8,
          mid: 9,
        };
      } else if (sample.length === 11) {
        // Legacy 11 columns with TID: Serial_SN, Product_Type, Model, Battery_Serial, Branch_Code, Branch_Name, Lifecycle_Stage, Assigned_Staff, Merchant_Name, MID, TID
        colMap = {
          serial: 0,
          type: 1,
          model: 2,
          batterySerial: 3,
          branchCode: 4,
          branchName: 5,
          stage: 6,
          staff: 7,
          merchantName: 8,
          mid: 9,
          tid: 10,
        };
      } else if (sample.length >= 2 && !/^\d{4}-\d{2}-\d{2}/.test(sample[0])) {
        colMap = {
          serial: 0,
          batterySerial: 1,
          branchCode: 2,
        };
      } else {
        colMap = { serial: 0 };
      }
    }

    const colNumber = (key: string, fallbackCol = 1): number =>
      colMap[key] !== undefined ? colMap[key] + 1 : fallbackCol;
    const colLabel = (key: string, fallbackName: string): string =>
      colMap[key] !== undefined && headerLabels[colMap[key]]
        ? headerLabels[colMap[key]]
        : fallbackName;

    const cell = (row: string[], key: string) => (colMap[key] !== undefined ? row[colMap[key]] || '' : '').trim();
    const parsed: StagedItem[] = [];
    const today = todayPP();

    for (let i = dataStartIdx; i < rows.length; i++) {
      const row = rows[i];
      const csvRowNumber = i + 1; // 1-based row number in the CSV file
      // Skip completely blank lines at the end of the file
      if (row.length === 1 && !row[0].trim()) continue;

      const cellErrors: CsvCellValidationError[] = [];
      const addErr = (
        column: number,
        columnName: string,
        category: CsvCellValidationError['category'],
        message: string
      ) => {
        cellErrors.push({ row: csvRowNumber, column, columnName, category, message });
      };

      // 1. Check Column Count consistency
      if (hasHeader && row.length !== expectedColCount) {
        addErr(
          Math.min(row.length, expectedColCount) || 1,
          'Column_Count',
          'COLUMN_COUNT',
          `Incorrect column count: row has ${row.length} column(s), expected ${expectedColCount} matching header row`
        );
      } else if (!hasHeader && ![1, 2, 3, 7, 8, 9, 10, 11, 12, 13].includes(row.length) && row.length !== expectedColCount) {
        addErr(
          row.length || 1,
          'Column_Count',
          'COLUMN_COUNT',
          `Incorrect column count: row has ${row.length} column(s), expected ${expectedColCount} column(s)`
        );
      }

      // 2. Check Required Field: Serial_SN
      const rawSerial = cell(row, 'serial').toUpperCase();
      if (colMap.serial === undefined) {
        addErr(1, 'Serial_SN', 'MISSING_REQUIRED', 'Missing required column "Serial_SN" in CSV header');
      } else if (!rawSerial) {
        addErr(
          colNumber('serial', 2),
          colLabel('serial', 'Serial_SN'),
          'MISSING_REQUIRED',
          'Missing required field Serial_SN (Hardware Serial Number cannot be empty)'
        );
      } else if (!/^[A-Z0-9_-]{3,40}$/.test(rawSerial)) {
        addErr(
          colNumber('serial', 2),
          colLabel('serial', 'Serial_SN'),
          'INVALID_TYPE',
          `Invalid Serial_SN format "${rawSerial}" (expected 3–40 alphanumeric characters)`
        );
      }

      const serial = rawSerial || `MISSING_SN_ROW_${csvRowNumber}`;

      // 3. Check Product_Type data type
      const rawTypeStr = cell(row, 'type');
      const strictType = parseDeviceTypeStrict(rawTypeStr, serial);
      if (rawTypeStr && !strictType) {
        addErr(
          colNumber('type', 3),
          colLabel('type', 'Product_Type'),
          'INVALID_TYPE',
          `Invalid Product_Type "${rawTypeStr}" (must be "POS Terminal" or "Sound Box")`
        );
      }
      const itemType: 'POS Terminal' | 'Sound Box' = strictType || (serial.startsWith('SB') ? 'Sound Box' : 'POS Terminal');
      const isPos = itemType === 'POS Terminal';
      const rawModel = isPos ? cell(row, 'model') || posModel : 'Q161 Pro';
      const rawBattery = cell(row, 'batterySerial');

      // 4. Check Branch_Code data type & existence
      const { branch: targetBranch, error: branchError } = resolveBranch(cell(row, 'branchCode'));
      if (branchError) {
        addErr(
          colNumber('branchCode', 6),
          colLabel('branchCode', 'Branch_Code'),
          'INVALID_TYPE',
          branchError
        );
      }

      // 5. Check Lifecycle_Stage data type
      const rawStage = cell(row, 'stage');
      const fallbackStage: LifecycleStage = defaultStage;
      const stage = parseStageValue(rawStage, fallbackStage);
      if (!stage) {
        addErr(
          colNumber('stage', 8),
          colLabel('stage', 'Lifecycle_Stage'),
          'INVALID_TYPE',
          `Invalid Lifecycle_Stage "${rawStage}"`
        );
      }

      // 6. Check Stock_In_Date data type (YYYY-MM-DD)
      const rawDate = cell(row, 'stockInDate');
      if (rawDate && !isDate(rawDate)) {
        addErr(
          colNumber('stockInDate', 1),
          colLabel('stockInDate', 'Stock_In_Date'),
          'INVALID_TYPE',
          `Invalid Stock_In_Date "${rawDate}" (must be YYYY-MM-DD calendar date)`
        );
      }
      const stockInDate = isDate(rawDate) ? rawDate : today;

      // Effective stage determination:
      const effectiveStage = stage || fallbackStage;

      // 7. Check Assigned_Staff based on intake cycle & validate strictly with Staff Directory
      const rawStaff = cell(row, 'staff');
      const isStaffRequired =
        effectiveStage === 'CONFIGURING' ||
        effectiveStage === 'COMPLETE' ||
        effectiveStage === 'BRANCH_RESERVE';

      const stageDisplay =
        effectiveStage === 'CONFIGURING'
          ? 'Under Configuring'
          : effectiveStage === 'COMPLETE'
          ? 'Installed Live (COMPLETE)'
          : effectiveStage === 'BRANCH_RESERVE'
          ? 'Branch Staff Reserve'
          : 'HQ Stock';

      if (isStaffRequired && !rawStaff) {
        addErr(
          colNumber('staff', 8),
          colLabel('staff', 'Assigned_Staff'),
          'MISSING_REQUIRED',
          `Missing required Assigned_Staff for ${stageDisplay} device (must match a registered staff in the Staff Directory)`
        );
      }

      let assignedStaff = effectiveStage === 'HQ_STOCK'
        ? (rawStaff || '')
        : (rawStaff || staffLabel);

      if (rawStaff) {
        const staffVal = validateStaffWithBranch(rawStaff, targetBranch, directoryUsers, branches);
        if (!staffVal.valid && staffVal.error) {
          addErr(
            colNumber('staff', 8),
            colLabel('staff', 'Assigned_Staff'),
            'INVALID_TYPE',
            staffVal.error
          );
        } else {
          assignedStaff = staffVal.resolvedStaffName;
        }
      }

      // 8. Check Merchant Information (Merchant_Name, MID, TID) based on cycle
      const rawMerchantName = cell(row, 'merchantName');
      const rawMidInput = cell(row, 'mid');
      const normalizedMidVal = normalizeMid(rawMidInput);
      const rawTidInput = cell(row, 'tid');

      if (rawMidInput && !isValidMidForType(normalizedMidVal, itemType)) {
        addErr(
          colNumber('mid', 11),
          colLabel('mid', 'MID'),
          'INVALID_TYPE',
          midRuleError(normalizedMidVal, itemType) || `Invalid MID "${rawMidInput}"`
        );
      }
      if (rawTidInput && !/^[A-Za-z0-9_-]{4,16}$/.test(rawTidInput)) {
        addErr(
          colNumber('tid', 12),
          colLabel('tid', 'TID'),
          'INVALID_TYPE',
          `Invalid TID "${rawTidInput}" (must be 4–16 alphanumeric characters)`
        );
      }

      if (effectiveStage === 'CONFIGURING' || effectiveStage === 'COMPLETE') {
        // "and if under configuring and live should have merchant information."
        const stageLabel = effectiveStage === 'CONFIGURING' ? 'Under Configuring' : 'Installed Live (COMPLETE)';
        if (!rawMerchantName) {
          addErr(
            colNumber('merchantName', 10),
            colLabel('merchantName', 'Merchant_Name'),
            'MISSING_REQUIRED',
            `Missing required Merchant_Name for ${stageLabel} device`
          );
        }
        if (!rawMidInput) {
          addErr(
            colNumber('mid', 11),
            colLabel('mid', 'MID'),
            'MISSING_REQUIRED',
            `Missing required 15-digit MID for ${stageLabel} device`
          );
        }
      }

      // 9. Check Serial_Cycles_Count data type (non-negative integer)
      const rawCyclesStr = cell(row, 'redeployCount');
      let redeployCount = 0;
      if (rawCyclesStr) {
        if (!/^\d+$/.test(rawCyclesStr)) {
          addErr(
            colNumber('redeployCount', 13),
            colLabel('redeployCount', 'Serial_Cycles_Count'),
            'INVALID_TYPE',
            `Invalid Serial_Cycles_Count "${rawCyclesStr}" (must be a non-negative integer)`
          );
        } else {
          redeployCount = parseInt(rawCyclesStr, 10);
        }
      }

      parsed.push({
        csvRowNumber,
        serial,
        batterySerial: rawBattery,
        model: rawModel,
        type: itemType,
        branchId: targetBranch?.id || cell(row, 'branchCode'),
        branchName: targetBranch?.name || cell(row, 'branchName'),
        staff: assignedStaff,
        stage: effectiveStage,
        stockInDate,
        merchantName: (effectiveStage === 'CONFIGURING' || effectiveStage === 'COMPLETE') ? rawMerchantName : (rawMerchantName || ''),
        mid: (effectiveStage === 'CONFIGURING' || effectiveStage === 'COMPLETE') ? normalizedMidVal : (normalizedMidVal || ''),
        tid: (effectiveStage === 'CONFIGURING' || effectiveStage === 'COMPLETE') ? tidFromMid(normalizedMidVal, rawTidInput) : (rawTidInput || tidFromMid(normalizedMidVal)),
        redeployCount,
        isDuplicate: false,
        error: cellErrors.map((ce) => `Row ${ce.row}, Col ${ce.column} (${ce.columnName}): ${ce.message}`).join('; ') || undefined,
        cellErrors,
      });
    }

    return parsed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableCsvText, branches, defaultBranch, defaultStage, posModel, sbModel, staffLabel, directoryUsers]);

  // Method B: Parse dual fields for POS Terminal & Sound Box
  const pastedBatch = useMemo(() => {
    const parsed: StagedItem[] = [];
    const today = todayPP();

    const parseLinesForType = (
      raw: string,
      fixedType: 'POS Terminal' | 'Sound Box',
      selectedModel: string
    ) => {
      if (!raw.trim()) return;
      const rows = parseCsv(raw, detectDelimiter(raw.split(/\r?\n/)[0] || ''));

      rows.forEach((parts, rowIdx) => {
        const csvRowNumber = rowIdx + 1;
        const first = (parts[0] || '').trim().toLowerCase();
        if (first.startsWith('serial') || first.startsWith('stock')) return;

        let serial = (parts[0] || '').trim().toUpperCase();
        let batterySerial = '';
        let modelPart = parts[1] || '';
        let branchPart = parts[2] || '';

        if (isDate(parts[0] || '') && parts.length > 1) {
          serial = (parts[1] || '').toUpperCase();
          modelPart = parts[3] || '';
          batterySerial = parts[4] || '';
          branchPart = parts[5] || '';
        } else if (modelPart.toUpperCase().startsWith('BAT-') || modelPart.toUpperCase().startsWith('160525A') || modelPart.toUpperCase().startsWith('SB-BAT')) {
          batterySerial = modelPart.toUpperCase();
          modelPart = parts[2] || '';
          branchPart = parts[3] || '';
        } else if (/^\d{3}$/.test(modelPart)) {
          branchPart = modelPart;
          modelPart = '';
        }

        if (!serial && parts.every((p) => !p.trim())) return;

        const cellErrors: CsvCellValidationError[] = [];
        if (!serial) {
          cellErrors.push({
            row: csvRowNumber,
            column: 1,
            columnName: 'Serial_SN',
            category: 'MISSING_REQUIRED',
            message: 'Missing required Serial_SN',
          });
        }

        const { branch: curBranch, error: branchError } = resolveBranch(branchPart);
        if (branchError && branchPart) {
          cellErrors.push({
            row: csvRowNumber,
            column: 3,
            columnName: 'Branch_Code',
            category: 'INVALID_TYPE',
            message: branchError,
          });
        }

        const targetBranchId = curBranch?.id || defaultBranchId;
        const targetBranchObj = curBranch || defaultBranch;
        const targetStage = defaultStage;

        // Dynamic stock lookup: is this unit currently available in existing stock?
        const inStockDev = existingDevices.find((d) => d.serial.trim().toUpperCase() === serial);
        const isAvailableHqStock = inStockDev && inStockDev.stage === 'HQ_STOCK';

        // Staff assignment: use selected default receiving staff or operator
        const assignedStaff = targetStage === 'BRANCH_RESERVE'
          ? (defaultStaff || staffLabel)
          : (staffLabel);

        // If target stage is BRANCH_RESERVE, validate receiving staff
        if (targetStage === 'BRANCH_RESERVE') {
          if (!assignedStaff) {
            cellErrors.push({
              row: csvRowNumber,
              column: 8,
              columnName: 'Assigned_Staff',
              category: 'MISSING_REQUIRED',
              message: 'Missing required Assigned Receiving Staff for Branch Reserve allocation',
            });
          } else {
            const staffVal = validateStaffWithBranch(assignedStaff, targetBranchObj, directoryUsers, branches);
            if (!staffVal.valid && staffVal.error) {
              cellErrors.push({
                row: csvRowNumber,
                column: 8,
                columnName: 'Assigned_Staff',
                category: 'INVALID_TYPE',
                message: staffVal.error,
              });
            }
          }
        }

        parsed.push({
          csvRowNumber,
          serial: serial || `MISSING_SN_ROW_${csvRowNumber}`,
          batterySerial: inStockDev?.batterySerial || batterySerial,
          model: inStockDev?.model || (fixedType === 'Sound Box' ? 'Q161 Pro' : modelPart || selectedModel),
          type: inStockDev?.type || fixedType,
          branchId: targetBranchId,
          branchName: targetBranchObj?.name || '',
          staff: assignedStaff,
          stage: targetStage,
          stockInDate: today,
          stockOrigin: isAvailableHqStock ? 'EXISTING_HQ_STOCK' : 'NEW_SERIAL',
          isDuplicate: false,
          error: cellErrors.map((ce) => `Row ${ce.row}, Col ${ce.column} (${ce.columnName}): ${ce.message}`).join('; ') || undefined,
          cellErrors,
        });
      });
    };

    parseLinesForType(posPasteText, 'POS Terminal', posModel);
    parseLinesForType(sbPasteText, 'Sound Box', sbModel);

    return parsed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posPasteText, sbPasteText, posModel, sbModel, defaultBranch, defaultStage, defaultBranchId, defaultStaff, branches, staffLabel, existingDevices, directoryUsers]);

  const processCsvFile = (file: File) => {
    const sizeKb = (file.size / 1024).toFixed(1);
    setUploadedFileMeta({ name: file.name, size: `${sizeKb} KB` });
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = (evt.target?.result as string) || '';
      setTableCsvText(text);
    };
    reader.onerror = (err) => {
      console.error('Error reading file:', err);
    };
    reader.readAsText(file);
  };

  const handleTableCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processCsvFile(file);
    if (e.target) e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    let file: File | null = null;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      file = e.dataTransfer.files[0];
    } else if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const item = e.dataTransfer.items[0];
      if (item.kind === 'file') {
        file = item.getAsFile();
      }
    }
    if (!file) return;

    processCsvFile(file);
  };

  const handleClearCsv = () => {
    setTableCsvText('');
    setUploadedFileMeta(null);
  };

  const handleCopyHeaders = (cycleToCopy?: IntakeCycle) => {
    const cycle = cycleToCopy || currentInspectCycle;
    const schema = CYCLE_SCHEMAS[cycle] || CYCLE_SCHEMAS.HQ_STOCK;
    const headerLine = schema.columns.map((c) => c.label).join(',');
    navigator.clipboard.writeText(headerLine);
    setCopiedHeaders(true);
    setTimeout(() => setCopiedHeaders(false), 2000);
  };

  const handleFileUploadForType = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'POS' | 'SB'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = (evt.target?.result as string) || '';
      if (target === 'POS') {
        setPosPasteText((prev) => (prev ? `${prev}\n${content}` : content));
      } else {
        setSbPasteText((prev) => (prev ? `${prev}\n${content}` : content));
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  /** Download sample CSV template tailored strictly for the chosen intake cycle */
  const handleDownloadTemplate = (cycleToDownload?: IntakeCycle) => {
    const cycle = cycleToDownload || activeCycle;
    const schema = CYCLE_SCHEMAS[cycle] || CYCLE_SCHEMAS.HQ_STOCK;
    const rows = [
      schema.columns.map((c) => c.label),
      ...schema.sampleRows,
    ];
    const blob = csvFile(rows);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = schema.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * The rows for the chosen method, with duplicates flagged against the CURRENT inventory and within the batch,
   * recording exact Row & Column numbers for every duplicate or validation issue.
   */
  const rawStagedItems = method === 'tableCsv' ? tableCsvBatch : pastedBatch;

  // When the database has more rows than the in-memory page (e.g. up to 500,000 rows), query the primary-key B-Tree index
  // for candidate CSV serials so duplicates against the full 500K-row database are flagged with exact Row & Column numbers.
  React.useEffect(() => {
    if (!isOpen || rawStagedItems.length === 0 || existingDevices.length < 10000) {
      setServerExistingSerials(new Set());
      return;
    }
    let cancelled = false;
    const candidates = rawStagedItems
      .map((i) => i.serial.trim().toUpperCase())
      .filter((s) => s && !s.startsWith('MISSING_SN_ROW_'));
    if (candidates.length === 0) return;

    const timer = setTimeout(() => {
      checkExistingSerialsOnServer(candidates).then((found) => {
        if (!cancelled) {
          setServerExistingSerials(found);
        }
      });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, rawStagedItems, existingDevices.length]);

  const activeStagedBatch = useMemo(() => {
    const raw = method === 'tableCsv' ? tableCsvBatch : pastedBatch;
    const firstSeenRowBySerial = new Map<string, number>();

    return raw.map((item, idx) => {
      const rowNum = item.csvRowNumber || idx + 1;
      const key = item.serial.trim().toUpperCase();
      const inStockDev = existingDevices.find((d) => d.serial.trim().toUpperCase() === key);
      const isAvailableInHqStock = inStockDev && inStockDev.stage === 'HQ_STOCK';
      const isAllocatingToBranch = item.stage === 'BRANCH_RESERVE' || (item.branchId && item.branchId !== '100');
      const isValidHqStockAllocation = isAvailableInHqStock && isAllocatingToBranch;

      const inDb = existingSerials.has(key) && !isValidHqStockAllocation;
      const firstRowInFile = firstSeenRowBySerial.get(key);
      const inFileDup = firstRowInFile !== undefined;
      if (!inFileDup && !key.startsWith('MISSING_SN_ROW_')) {
        firstSeenRowBySerial.set(key, rowNum);
      }

      const isDuplicate = inDb || inFileDup;
      const baseCellErrors = item.cellErrors ? [...item.cellErrors] : [];

      if (inFileDup) {
        baseCellErrors.push({
          row: rowNum,
          column: method === 'tableCsv' ? 2 : 1,
          columnName: 'Serial_SN',
          category: 'DUPLICATE_IN_FILE',
          message: `Duplicate serial number "${key}" within batch (first seen at Row ${firstRowInFile})`,
        });
      } else if (inDb) {
        if (!baseCellErrors.some((ce) => ce.category === 'DUPLICATE_IN_DB')) {
          const reserveDetail = inStockDev
            ? `already in ${STAGE_META[inStockDev.stage]?.short || inStockDev.stage} at ${inStockDev.branchName}${inStockDev.merchantName ? ` (${inStockDev.merchantName})` : ''}`
            : 'already in inventory database';
          baseCellErrors.push({
            row: rowNum,
            column: method === 'tableCsv' ? 2 : 1,
            columnName: 'Serial_SN',
            category: 'DUPLICATE_IN_DB',
            message: `Hardware serial "${key}" is ${reserveDetail}`,
          });
        }
      }

      const alreadyInDbMessage = inDb
        ? inStockDev
          ? `Already in ${STAGE_META[inStockDev.stage]?.short || inStockDev.stage} at ${inStockDev.branchName}${inStockDev.merchantName ? ` (${inStockDev.merchantName})` : ''}`
          : 'Already exists in inventory database'
        : undefined;

      const syntaxErrorsOnly = baseCellErrors.filter((ce) => ce.category !== 'DUPLICATE_IN_DB');
      const combinedError =
        syntaxErrorsOnly.map((ce) => `Row ${ce.row}, Col ${ce.column} (${ce.columnName}): ${ce.message}`).join('; ') ||
        (item.error && !item.error.includes('already in') ? item.error : undefined);

      return {
        ...item,
        csvRowNumber: rowNum,
        stockOrigin: item.stockOrigin || (isAvailableInHqStock ? 'EXISTING_HQ_STOCK' : 'NEW_SERIAL'),
        isDuplicate,
        isDuplicateInFile: inFileDup,
        isAlreadyInDb: inDb,
        alreadyInDbMessage,
        error: combinedError,
        cellErrors: baseCellErrors,
      };
    });
  }, [method, tableCsvBatch, pastedBatch, existingSerials, existingDevices]);

  /** Flatten all row/column validation issues across the staged batch. */
  const allValidationIssues = useMemo(() => {
    const list: CsvCellValidationError[] = [];
    for (const item of activeStagedBatch) {
      if (item.cellErrors && item.cellErrors.length > 0) {
        list.push(...item.cellErrors);
      }
    }
    return list;
  }, [activeStagedBatch]);

  /** Hard halting validation issues: only intra-batch duplicates and syntax/missing column errors halt upload. Serials already in reserve do NOT halt upload. */
  const haltingValidationIssues = useMemo(() => {
    return allValidationIssues.filter((issue) => issue.category !== 'DUPLICATE_IN_DB');
  }, [allValidationIssues]);

  const isStaffColVisible = useMemo(() => {
    return (
      activeCycle === 'BRANCH_RESERVE' ||
      activeCycle === 'CONFIGURING' ||
      activeCycle === 'COMPLETE' ||
      activeStagedBatch.some((i) => !!i.staff)
    );
  }, [activeCycle, activeStagedBatch]);

  const isMerchantColVisible = useMemo(() => {
    return (
      activeCycle === 'CONFIGURING' ||
      activeCycle === 'COMPLETE' ||
      activeStagedBatch.some((i) => !!i.merchantName || !!i.mid)
    );
  }, [activeCycle, activeStagedBatch]);

  const displayedStagedBatch = useMemo(() => {
    if (stageFilter === 'ALL') return activeStagedBatch;
    return activeStagedBatch.filter((item) => item.stage === stageFilter);
  }, [activeStagedBatch, stageFilter]);

  const {
    validItems,
    fileDupCount,
    alreadyInDbCount,
    syntaxErrorCount,
    validPosCount,
    validSbCount,
    isUploadHalted,
  } = useMemo(() => {
    const valid = activeStagedBatch.filter(
      (i) => !i.isDuplicateInFile && !i.isAlreadyInDb && !i.error
    );
    const fileDups = activeStagedBatch.filter((i) => i.isDuplicateInFile).length;
    const inDbDups = activeStagedBatch.filter((i) => i.isAlreadyInDb).length;
    const syntaxErrs = activeStagedBatch.filter(
      (i) => !i.isDuplicateInFile && !i.isAlreadyInDb && !!i.error
    ).length;

    // Strict Client-Side Pre-Validation: Only hard syntax errors and intra-file duplicates halt upload completely.
    // Serials already in branch reserve / inventory do NOT halt upload; they are simply marked "Validation: Not OK" in the table.
    const halted = activeStagedBatch.length > 0 && haltingValidationIssues.length > 0;

    return {
      validItems: valid,
      fileDupCount: fileDups,
      alreadyInDbCount: inDbDups,
      syntaxErrorCount: syntaxErrs,
      validPosCount: valid.filter((i) => i.type === 'POS Terminal').length,
      validSbCount: valid.filter((i) => i.type === 'Sound Box').length,
      isUploadHalted: halted,
    };
  }, [activeStagedBatch, haltingValidationIssues]);

  const handleCommit = async () => {
    // Strict Pre-Validation Gate: Never ping the database if any error or duplicate exists in the batch
    if (validItems.length === 0 || isUploadHalted || isCommittingBatches) return;

    if (existingDevices.length >= 10000) {
      const candidatesToCheck = validItems
        .filter((i) => i.stockOrigin !== 'EXISTING_HQ_STOCK')
        .map((i) => i.serial);
      if (candidatesToCheck.length > 0) {
        const serverDups = await checkExistingSerialsOnServer(candidatesToCheck);
        if (serverDups.size > 0) {
          setServerExistingSerials((prev) => {
            const next = new Set(prev);
            serverDups.forEach((s) => next.add(s));
            return next;
          });
          setCommitNotice(
            `${serverDups.size} new serial(s) already exist in the 500K-row inventory database. Review the highlighted Row & Column duplicate alert above before uploading.`
          );
          return;
        }
      }
    }

    const stillEligible = validItems.filter((i) => {
      const key = i.serial.trim().toUpperCase();
      if (i.stockOrigin === 'EXISTING_HQ_STOCK') {
        const dev = existingDevices.find((d) => d.serial.trim().toUpperCase() === key);
        return dev && dev.stage === 'HQ_STOCK';
      }
      return !existingSerials.has(key);
    });
    if (stillEligible.length !== validItems.length) {
      setCommitNotice(
        `${validItems.length - stillEligible.length} serial(s) were modified or added to the inventory by someone else while you were reviewing. Please review staged items before uploading.`
      );
      return;
    }

    const cleanPayload = stillEligible.map(
      ({
        isDuplicate: _d,
        isDuplicateInFile: _df,
        isAlreadyInDb: _db,
        alreadyInDbMessage: _adm,
        error: _e,
        cellErrors: _ce,
        csvRowNumber: _r,
        stockOrigin: _so,
        ...rest
      }) => ({
        ...rest,
        serial: rest.serial.trim().toUpperCase(),
      })
    );

    setIsCommittingBatches(true);
    const totalBatches = Math.max(1, Math.ceil(cleanPayload.length / CSV_BATCH_SIZE));

    try {
      for (let bIdx = 0; bIdx < totalBatches; bIdx++) {
        const start = bIdx * CSV_BATCH_SIZE;
        const chunk = cleanPayload.slice(start, start + CSV_BATCH_SIZE);
        setBatchProgress({
          current: bIdx + 1,
          total: totalBatches,
          rowsSent: Math.min(start + chunk.length, cleanPayload.length),
          totalRows: cleanPayload.length,
        });
        await Promise.resolve(onCommitBatch(chunk));
        if (bIdx + 1 < totalBatches) {
          await new Promise((r) => setTimeout(r, CSV_BATCH_DELAY_MS));
        }
      }

      setTableCsvText('');
      setUploadedFileMeta(null);
      setPosPasteText('');
      setSbPasteText('');
      setCommitNotice('');
      onClose();
    } finally {
      setIsCommittingBatches(false);
      setBatchProgress(null);
    }
  };

  const posStats = useMemo(() => {
    if (!posPasteText.trim()) return { total: 0, inHqStock: 0, newSerials: 0, busy: 0 };
    const items = activeStagedBatch.filter((i) => i.type === 'POS Terminal');
    const inHq = items.filter((i) => i.stockOrigin === 'EXISTING_HQ_STOCK' && !i.isAlreadyInDb).length;
    const busy = items.filter((i) => i.isAlreadyInDb).length;
    const news = items.filter((i) => i.stockOrigin === 'NEW_SERIAL' && !i.isAlreadyInDb && !i.error).length;
    return { total: items.length, inHqStock: inHq, newSerials: news, busy };
  }, [posPasteText, activeStagedBatch]);

  const sbStats = useMemo(() => {
    if (!sbPasteText.trim()) return { total: 0, inHqStock: 0, newSerials: 0, busy: 0 };
    const items = activeStagedBatch.filter((i) => i.type === 'Sound Box');
    const inHq = items.filter((i) => i.stockOrigin === 'EXISTING_HQ_STOCK' && !i.isAlreadyInDb).length;
    const busy = items.filter((i) => i.isAlreadyInDb).length;
    const news = items.filter((i) => i.stockOrigin === 'NEW_SERIAL' && !i.isAlreadyInDb && !i.error).length;
    return { total: items.length, inHqStock: inHq, newSerials: news, busy };
  }, [sbPasteText, activeStagedBatch]);

  const modalBoxClass = isLight
    ? 'bg-white/95 text-slate-800 backdrop-blur-xl'
    : 'bg-[#11141e]/95 text-slate-100 backdrop-blur-xl';

  const inputClass = isLight
    ? 'bg-white border-slate-300 text-slate-900'
    : 'bg-[#181c26] border-slate-700 text-white';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xl flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 14 }}
        transition={{ type: 'spring', damping: 32, stiffness: 480, mass: 0.6 }}
        className={`${modalBoxClass} border-0 rounded-3xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] transform-gpu will-change-gpu gpu-modal-container`}
      >
        {/* Header (Signature Navy Bar) */}
        <div className="navy-header-bar rounded-t-3xl px-6 py-4 flex items-center justify-between text-white">
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              <FilePlus className="w-5 h-5 text-[#7cc4ed]" />
              Batch Hardware Stock Intake — {method === 'tableCsv' ? 'Table CSV Import' : 'By Hardware Type'}
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Strict client-side pre-validation &amp; batched 100-row database inserts
            </p>
          </div>
          <motion.button
            whileTap={{ scale: 0.94 }}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-300 hover:text-white p-1 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Stepper Progress Bar */}
        <div
          className={`px-6 py-2.5 border-b flex items-center justify-between text-xs ${
            isLight
              ? 'bg-slate-50 border-slate-200 text-slate-700'
              : 'bg-[#151922] border-slate-800 text-slate-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBatchStep('INPUT')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                batchStep === 'INPUT'
                  ? 'bg-[#004953] text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">
                1
              </span>
              <span>Stage &amp; Pre-Validate Serials</span>
            </button>

            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />

            <button
              type="button"
              onClick={() => {
                if (validItems.length > 0 && !isUploadHalted) setBatchStep('PREVIEW');
              }}
              disabled={validItems.length === 0 || isUploadHalted}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition ${
                batchStep === 'PREVIEW'
                  ? 'bg-[#004953] text-white shadow-xs'
                  : validItems.length > 0 && !isUploadHalted
                  ? 'text-slate-600 hover:text-slate-900 cursor-pointer'
                  : 'text-slate-400 opacity-60 cursor-not-allowed'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">
                2
              </span>
              <span>Intake Verification &amp; Batch Write (100/Batch)</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-[#1e5b88]" />
            <span>Client-Side Pre-Validation Active</span>
          </div>
        </div>

        {batchStep === 'INPUT' ? (
          <>
            {/* Method Switcher & Intake Metric Strip */}
            <div
              className={`px-6 py-2.5 flex items-center justify-between flex-wrap gap-3 border-b ${
                isLight
                  ? 'bg-slate-50/80 border-slate-200/80'
                  : 'bg-[#131722] border-slate-800/80'
              }`}
            >
              <div className="inline-flex p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800/90 gap-1 border border-slate-200 dark:border-slate-700/60 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setMethod('tableCsv')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    method === 'tableCsv'
                      ? 'bg-white dark:bg-slate-900 text-[#1e5b88] dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#1e5b88] dark:text-sky-400" />
                  <span>Method A: Table CSV Import</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('paste')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    method === 'paste'
                      ? 'bg-white dark:bg-slate-900 text-[#1e5b88] dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Method B: By Hardware Type</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 text-sky-800 dark:text-sky-300 font-mono font-bold text-[11px]">
                  <Cpu className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                  <span>{validPosCount} POS</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 text-indigo-800 dark:text-indigo-300 font-mono font-bold text-[11px]">
                  <Volume2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                  <span>{validSbCount} Sound Box</span>
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 font-mono font-bold text-[11px]">
                  <span>Total: {validItems.length}</span>
                </span>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-col gap-3.5 flex flex-1">
              {/* STRICT CLIENT-SIDE PRE-VALIDATION HALT ALERT */}
              {isUploadHalted && (
                <div
                  role="alert"
                  className="p-4 rounded-2xl border-2 border-rose-500/80 bg-rose-50/95 dark:bg-rose-950/50 text-rose-900 dark:text-rose-100 shadow-md flex flex-col gap-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <Ban className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                          Upload Halted by Client-Side Pre-Validation ({haltingValidationIssues.length} Error{haltingValidationIssues.length === 1 ? '' : 's'} Found)
                        </div>
                        <p className="text-[11px] text-rose-800 dark:text-rose-200 mt-0.5">
                          To protect the database and prevent incomplete batch uploads, no API calls have been made to Supabase. Fix the exact row and column errors listed below in your CSV and re-upload:
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="max-h-36 overflow-y-auto rounded-xl bg-white/90 dark:bg-slate-900/80 border border-rose-200 dark:border-rose-800/80 p-2.5 font-mono text-[11px] space-y-1">
                    {haltingValidationIssues.slice(0, 50).map((issue, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-rose-700 dark:text-rose-300">
                        <span className="px-1.5 py-0.2 rounded bg-rose-100 dark:bg-rose-900/60 font-bold shrink-0">
                          Row {issue.row}, Column {issue.column} ({issue.columnName})
                        </span>
                        <span className="font-sans font-medium">{issue.message}</span>
                      </div>
                    ))}
                    {haltingValidationIssues.length > 50 && (
                      <div className="text-rose-600 font-bold pt-1">
                        …and {haltingValidationIssues.length - 50} more validation error(s).
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Target Fallback Stock Location & Stage Bar */}
              <div
                className={`p-3 rounded-2xl border transition-all ${
                  isLight
                    ? 'bg-slate-50/90 border-slate-200/90 shadow-2xs'
                    : 'bg-slate-900/60 border-slate-800 shadow-2xs'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                    <Building2 className="w-3.5 h-3.5 text-[#1e5b88] dark:text-sky-400" />
                    <span>Default Target Location &amp; Stage</span>
                    <span className="text-[10px] font-normal text-slate-500">
                      (Applied automatically when omitted in CSV row)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                      Fallback Branch
                    </label>
                    <BranchSearch
                      value={defaultBranchId}
                      branches={branches}
                      inputClass={inputClass}
                      onChange={(nextId) => {
                        setDefaultBranchId(nextId);
                        setDefaultStage(nextId === '100' ? 'HQ_STOCK' : 'BRANCH_RESERVE');
                      }}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                      Fallback Lifecycle Stage
                    </label>
                    <select
                      value={defaultStage}
                      onChange={(e) =>
                        handleSelectStage(e.target.value as LifecycleStage)
                      }
                      className={`w-full rounded-xl px-3 py-1.5 text-xs font-semibold border transition ${inputClass}`}
                    >
                      <option value="HQ_STOCK">Admin HQ Stock (Branch Code 100)</option>
                      <option value="BRANCH_RESERVE">Branch Reserve (Stock-In / Allocation)</option>
                      <option value="CONFIGURING">Under Configuring (Merchant Setup)</option>
                      <option value="COMPLETE">Installed Live (Active Store)</option>
                      <option value="LOST">Device Lost / Missing</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        Assigned Receiving Staff
                      </label>
                      {defaultStage === 'BRANCH_RESERVE' && (
                        <span className="text-[9px] font-bold text-rose-500 bg-rose-500/10 px-1 rounded">
                          REQUIRED
                        </span>
                      )}
                    </div>
                    <select
                      value={defaultStaff}
                      onChange={(e) => setDefaultStaff(e.target.value)}
                      className={`w-full rounded-xl px-3 py-1.5 text-xs font-semibold border transition ${inputClass}`}
                    >
                      <option value="">-- Select Receiving Staff --</option>
                      {branchStaffOptions.map((s: any) => (
                        <option key={s.uid || s.name} value={s.name}>
                          {s.name} {s.empId ? `(${s.empId})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Dynamic Cycle Rule Callout Banner */}
                <div
                  className={`mt-1 p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs transition-all ${
                    activeCycle === 'HQ_STOCK'
                      ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-200/90 dark:border-blue-900/60 text-blue-950 dark:text-blue-200'
                      : activeCycle === 'BRANCH_RESERVE'
                      ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200/90 dark:border-amber-900/60 text-amber-950 dark:text-amber-200'
                      : 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200/90 dark:border-emerald-900/60 text-emerald-950 dark:text-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-extrabold shrink-0">{activeCycleSchema.name}:</span>
                    <span className="text-[11px] opacity-90 truncate">{activeCycleSchema.description}</span>
                  </div>
                  <span className="shrink-0 self-start sm:self-auto px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-white/80 dark:bg-white/10 border border-current/25 shadow-2xs">
                    {activeCycleSchema.badge}
                  </span>
                </div>
              </div>

              {/* METHOD A: TABLE CSV FILE UPLOAD & TEMPLATE */}
              {method === 'tableCsv' && (
                <div className="flex flex-col gap-3">
                  {/* Drag and Drop Zone + Action Bar */}
                  <div
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative overflow-hidden p-4 rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col sm:flex-row items-center justify-between gap-3.5 select-none ${
                      isDragging
                        ? 'border-[#003857] dark:border-sky-400 bg-sky-50 dark:bg-sky-950/40 ring-4 ring-sky-500/20 scale-[1.01]'
                        : isLight
                        ? 'border-slate-300/90 bg-slate-50/70 hover:bg-slate-100/80 hover:border-[#003857]/60 shadow-2xs'
                        : 'border-slate-700/90 bg-slate-900/40 hover:bg-slate-900/70 hover:border-sky-500/60 shadow-2xs'
                    }`}
                  >
                    {/* Active Drag Overlay */}
                    {isDragging && (
                      <div className="absolute inset-0 z-20 flex items-center justify-center gap-3 bg-[#003857]/90 dark:bg-[#002a42]/95 text-white backdrop-blur-xs font-bold text-sm pointer-events-none animate-in fade-in duration-150">
                        <Upload className="w-6 h-6 animate-bounce text-sky-300" />
                        <span>Drop your CSV or TXT file here to upload</span>
                      </div>
                    )}

                    <div className={`flex items-center gap-3 w-full sm:w-auto ${isDragging ? 'pointer-events-none' : ''}`}>
                      <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#1e5b88] to-[#246da1] text-white shadow-xs shrink-0">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>Upload Table CSV File</span>
                          {uploadedFileMeta && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-[10px] font-mono font-medium">
                              <FileText className="w-3 h-3" />
                              <span className="truncate max-w-[140px]">{uploadedFileMeta.name}</span>
                              <span className="opacity-60">({uploadedFileMeta.size})</span>
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Drag and drop <code>.csv</code> file here, or click to browse. Parsed locally in browser before any database call.
                        </p>
                      </div>
                    </div>

                    <div
                      className={`flex items-center gap-2 flex-wrap shrink-0 w-full sm:w-auto justify-end ${
                        isDragging ? 'pointer-events-none' : ''
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.txt"
                        onChange={handleTableCsvFileUpload}
                        className="hidden"
                      />
                      <motion.button
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs transition cursor-pointer flex items-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Browse File</span>
                      </motion.button>

                      <motion.button
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadTemplate(activeCycle);
                        }}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 shadow-2xs transition cursor-pointer flex items-center gap-1.5"
                        title={`Download ${activeCycleSchema.name} CSV template (${activeCycleSchema.columns.length} columns)`}
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>Download {activeCycleSchema.tag} Template</span>
                        <span className="text-[10px] font-mono opacity-60">({activeCycleSchema.columns.length} Cols)</span>
                      </motion.button>

                      {tableCsvText && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClearCsv();
                          }}
                          className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition cursor-pointer flex items-center gap-1"
                          title="Clear CSV Content"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Clear</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Format Reference Banner with Cycle Tabs & Collapsible Schema Guide */}
                  <div
                    className={`rounded-2xl border transition-all ${
                      isLight
                        ? 'bg-slate-50/90 border-slate-200/90 text-slate-700'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="p-3 flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-[#1e5b88]/10 text-[#1e5b88] dark:text-sky-300">
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                        </span>
                        <div>
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            CSV Cycle Schemas
                          </span>
                          <span className="text-[11px] text-slate-500 ml-1.5 hidden sm:inline">
                            {currentInspectSchema.name} ({currentInspectSchema.columns.length} columns)
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyHeaders(currentInspectCycle)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-[#1e5b88] transition flex items-center gap-1 cursor-pointer shadow-2xs"
                          title={`Copy ${currentInspectSchema.tag} column headers to clipboard`}
                        >
                          {copiedHeaders ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-500" />
                              <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-slate-400" />
                              <span>Copy Headers</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowSchemaGuide(!showSchemaGuide)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[#1e5b88] dark:text-sky-400 hover:border-[#1e5b88] transition flex items-center gap-1 cursor-pointer shadow-2xs"
                        >
                          <span>{showSchemaGuide ? 'Hide Columns' : `View ${currentInspectSchema.columns.length} Columns`}</span>
                          {showSchemaGuide ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Collapsible Column Guide View */}
                    {showSchemaGuide && (
                      <div className="px-3 pb-3 pt-2 border-t border-slate-200/60 dark:border-slate-800/80 flex flex-col gap-2.5">
                        {/* Cycle Switcher Tabs */}
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
                          {(['HQ_STOCK', 'BRANCH_RESERVE', 'CONFIGURING', 'COMPLETE'] as IntakeCycle[]).map((cKey) => {
                            const cDef = CYCLE_SCHEMAS[cKey];
                            const isSelected = activeCycle === cKey;
                            return (
                              <button
                                key={cKey}
                                type="button"
                                onClick={() => handleSelectStage(cKey)}
                                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                                  isSelected
                                    ? 'tab-active-blue text-white shadow-2xs ring-2 ring-[#004e75]/30'
                                    : isLight
                                    ? 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                                }`}
                              >
                                <span>{cDef.tag}</span>
                                <span className="text-[10px] opacity-75">({cDef.columns.length} Cols)</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Cycle Description & Quick Action */}
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 bg-slate-100/70 dark:bg-slate-800/50 p-2 rounded-xl">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-slate-800 dark:text-slate-200 shrink-0">{currentInspectSchema.name}:</span>
                            <span className="truncate">{currentInspectSchema.description}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDownloadTemplate(currentInspectCycle)}
                            className="text-[11px] font-bold text-[#1e5b88] dark:text-sky-400 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <FileSpreadsheet className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            <span>Download {currentInspectSchema.tag} CSV</span>
                          </button>
                        </div>

                        {/* Columns Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 font-mono text-[10px]">
                          {currentInspectSchema.columns.map((col, idx) => (
                            <div
                              key={col.id}
                              className="p-1.5 rounded-lg bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 flex flex-col gap-0.5"
                            >
                              <div className="flex items-center justify-between text-slate-900 dark:text-white font-bold">
                                <span className="truncate">{idx + 1}. {col.label}</span>
                                {col.req ? (
                                  <span className="text-[9px] font-sans font-extrabold text-rose-600 dark:text-rose-400">
                                    REQUIRED
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-sans text-slate-400">
                                    OPTIONAL
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] font-sans text-slate-400 truncate">
                                {col.desc}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* METHOD B: 2 DEDICATED FIELDS (POS Terminal & Sound Box) */}
              {method === 'paste' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Field 1: POS Terminal */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingPos(true);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingPos(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingPos(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingPos(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          const content = (evt.target?.result as string) || '';
                          setPosPasteText((prev) => (prev ? `${prev}\n${content}` : content));
                        };
                        reader.readAsText(file);
                      }
                    }}
                    className={`relative p-4 rounded-2xl border transition-all ${
                      isDraggingPos
                        ? 'border-sky-500 bg-sky-500/10 ring-2 ring-sky-500/40 shadow-lg'
                        : 'border-[#133e5e]/25 bg-[#133e5e]/[0.03]'
                    } flex flex-col gap-3`}
                  >
                    {isDraggingPos && (
                      <div className="absolute inset-0 z-20 rounded-2xl bg-sky-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center border-2 border-dashed border-sky-400">
                        <Upload className="w-8 h-8 text-sky-400 animate-bounce mb-1" />
                        <span className="text-xs font-bold text-white">Drop POS Serials / CSV File Here</span>
                        <span className="text-[10px] text-sky-200">Auto-populates serials into Field 1</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-[#133e5e] text-white">
                          <Cpu className="w-4 h-4" />
                        </span>
                        <div>
                          <div className="text-xs font-extrabold text-[#133e5e]">
                            Field 1: POS Terminal Serials
                          </div>
                          <div className="text-[10px] text-slate-500">
                            Type: POS Terminal
                          </div>
                        </div>
                      </div>
                      <label className="cursor-pointer text-[11px] font-bold text-[#133e5e] hover:underline flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                        <Upload className="w-3 h-3" />
                        <span>Upload File</span>
                        <input
                          type="file"
                          accept=".csv,.txt"
                          onChange={(e) => handleFileUploadForType(e, 'POS')}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        POS Terminal Model
                      </label>
                      <select
                        value={posModel}
                        onChange={(e) => setPosModel(e.target.value)}
                        className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-bold border ${inputClass}`}
                      >
                        <option value="Wizar POS Q2 Pro">Wizar POS Q2 Pro</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Enter POS Terminal Serials (1 per line or table row)
                      </label>
                      <textarea
                        rows={4}
                        value={posPasteText}
                        onChange={(e) => setPosPasteText(e.target.value)}
                        placeholder={'WP5400PQ23200297\nWP5400PQ23200298, 160525A0005710, 100'}
                        className={`w-full rounded-xl p-3 text-xs font-mono placeholder-slate-400 focus:outline-none focus:border-[#133e5e] border ${inputClass}`}
                      />
                    </div>

                    {posPasteText.trim() && (
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold flex-wrap pt-0.5">
                        <span className="text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <strong>{posStats.inHqStock}</strong> in HQ Stock
                        </span>
                        <span className="text-sky-700 dark:text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded-md border border-sky-500/20 flex items-center gap-1">
                          <FilePlus className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                          <strong>{posStats.newSerials}</strong> New Serials
                        </span>
                        {posStats.busy > 0 && (
                          <span className="text-amber-700 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                            <strong>{posStats.busy}</strong> In Another Stage
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Field 2: Sound Box */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingSb(true);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingSb(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingSb(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingSb(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          const content = (evt.target?.result as string) || '';
                          setSbPasteText((prev) => (prev ? `${prev}\n${content}` : content));
                        };
                        reader.readAsText(file);
                      }
                    }}
                    className={`relative p-4 rounded-2xl border transition-all ${
                      isDraggingSb
                        ? 'border-sky-500 bg-sky-500/10 ring-2 ring-sky-500/40 shadow-lg'
                        : 'border-[#1e5b88]/25 bg-[#1e5b88]/[0.03]'
                    } flex flex-col gap-3`}
                  >
                    {isDraggingSb && (
                      <div className="absolute inset-0 z-20 rounded-2xl bg-sky-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center border-2 border-dashed border-sky-400">
                        <Upload className="w-8 h-8 text-sky-400 animate-bounce mb-1" />
                        <span className="text-xs font-bold text-white">Drop Sound Box Serials / CSV File Here</span>
                        <span className="text-[10px] text-sky-200">Auto-populates serials into Field 2</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-[#1e5b88] text-white">
                          <Volume2 className="w-4 h-4" />
                        </span>
                        <div>
                          <div className="text-xs font-extrabold text-[#154360]">
                            Field 2: Sound Box Serials
                          </div>
                          <div className="text-[10px] text-slate-500">
                            Type: Sound Box
                          </div>
                        </div>
                      </div>
                      <label className="cursor-pointer text-[11px] font-bold text-[#133e5e] hover:underline flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                        <Upload className="w-3 h-3" />
                        <span>Upload File</span>
                        <input
                          type="file"
                          accept=".csv,.txt"
                          onChange={(e) => handleFileUploadForType(e, 'SB')}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        Sound Box Model
                      </label>
                      <select
                        value={sbModel}
                        onChange={(e) => setSbModel(e.target.value)}
                        className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-bold border ${inputClass}`}
                      >
                        <option value="Q161 Pro">Q161 Pro</option>
                        <option value="SB-Max">SB-Max</option>
                        <option value="SB-Standard">SB-Standard</option>
                        <option value="SB-Mini">SB-Mini</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Enter Sound Box Serials (1 per line or table row)
                      </label>
                      <textarea
                        rows={4}
                        value={sbPasteText}
                        onChange={(e) => setSbPasteText(e.target.value)}
                        placeholder={'SB-00071\nSB-00072, BAT-SB-00072, 100'}
                        className={`w-full rounded-xl p-3 text-xs font-mono placeholder-slate-400 focus:outline-none focus:border-[#133e5e] border ${inputClass}`}
                      />
                    </div>

                    {sbPasteText.trim() && (
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold flex-wrap pt-0.5">
                        <span className="text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <strong>{sbStats.inHqStock}</strong> in HQ Stock
                        </span>
                        <span className="text-sky-700 dark:text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded-md border border-sky-500/20 flex items-center gap-1">
                          <FilePlus className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                          <strong>{sbStats.newSerials}</strong> New Serials
                        </span>
                        {sbStats.busy > 0 && (
                          <span className="text-amber-700 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                            <strong>{sbStats.busy}</strong> In Another Stage
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Staged Output Table (Matches Inventory Table Format) */}
              <div
                onDragEnter={method === 'tableCsv' ? handleDragEnter : undefined}
                onDragOver={method === 'tableCsv' ? handleDragOver : undefined}
                onDragLeave={method === 'tableCsv' ? handleDragLeave : undefined}
                onDrop={method === 'tableCsv' ? handleDrop : undefined}
                className={`border rounded-2xl overflow-hidden shadow-2xs transition-all ${
                  isDragging && method === 'tableCsv' ? 'ring-2 ring-[#003857] border-[#003857]' : ''
                } ${
                  isLight ? 'border-slate-200/90' : 'border-slate-800'
                }`}
              >
                <div
                  className={`px-4 py-2 border-b flex items-center justify-between text-xs flex-wrap gap-2 ${
                    isLight
                      ? 'bg-slate-50 border-slate-200 text-slate-800'
                      : 'bg-slate-900 border-slate-800 text-white'
                  }`}
                >
                  <div className="font-bold flex items-center gap-2 flex-wrap">
                    <FileSpreadsheet className="w-4 h-4 text-[#1e5b88] dark:text-sky-400" />
                    <span>
                      Staged Inventory Table Live Preview
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#003857]/10 dark:bg-sky-400/10 text-[#003857] dark:text-sky-300 border border-[#003857]/20 dark:border-sky-400/20">
                      {activeCycleSchema.tag} Schema ({activeCycleSchema.columns.length} Cols)
                    </span>
                    <span className="text-[11px] font-normal text-slate-500 font-mono">
                      ({validItems.length} valid: {validPosCount} POS, {validSbCount} Sound Box
                      {activeStagedBatch.some((i) => i.stockOrigin === 'EXISTING_HQ_STOCK') && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold ml-1">
                          · {activeStagedBatch.filter((i) => i.stockOrigin === 'EXISTING_HQ_STOCK').length} in HQ Stock
                        </span>
                      )}
                      {activeStagedBatch.some((i) => i.stockOrigin === 'NEW_SERIAL') && (
                        <span className="text-sky-600 dark:text-sky-400 font-bold ml-1">
                          · {activeStagedBatch.filter((i) => i.stockOrigin === 'NEW_SERIAL').length} new
                        </span>
                      )}
                      {' '}· {activeStagedBatch.length} row{activeStagedBatch.length === 1 ? '' : 's'} read)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {activeStagedBatch.length > 0 && (
                      <div className="flex items-center gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setStageFilter('ALL')}
                          className={`px-2 py-0.5 rounded-md font-semibold transition cursor-pointer ${
                            stageFilter === 'ALL'
                              ? 'tab-active-blue text-white'
                              : isLight
                              ? 'bg-slate-200/70 hover:bg-slate-200 text-slate-700'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                          }`}
                        >
                          All ({activeStagedBatch.length})
                        </button>
                        {(['HQ_STOCK', 'BRANCH_RESERVE', 'CONFIGURING', 'COMPLETE'] as IntakeCycle[]).map((cKey) => {
                          const count = activeStagedBatch.filter((i) => i.stage === cKey).length;
                          if (count === 0) return null;
                          const cDef = CYCLE_SCHEMAS[cKey];
                          const isActive = stageFilter === cKey;
                          return (
                            <button
                              key={cKey}
                              type="button"
                              onClick={() => setStageFilter(cKey)}
                              className={`px-2 py-0.5 rounded-md font-semibold transition cursor-pointer ${
                                isActive
                                  ? 'tab-active-blue text-white'
                                  : isLight
                                  ? 'bg-slate-200/70 hover:bg-slate-200 text-slate-700'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                              }`}
                            >
                              {cDef.tag} ({count})
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {fileDupCount > 0 && (
                      <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1 text-[11px] bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {fileDupCount} duplicate(s) in batch halt upload
                      </span>
                    )}
                    {syntaxErrorCount > 0 && (
                      <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1 text-[11px] bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {syntaxErrorCount} syntax error(s) halt upload
                      </span>
                    )}
                    {alreadyInDbCount > 0 && (
                      <span className="text-amber-700 dark:text-amber-300 font-semibold flex items-center gap-1 text-[11px] bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        {alreadyInDbCount} already in inventory (Validation: Not OK)
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-auto min-h-[240px] max-h-[62vh]">
                  <table className="w-full text-left text-xs min-w-[700px]">
                    <thead className="glass-table-thead text-[10px] uppercase font-extrabold text-white sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">Row</th>
                        <th className="py-2.5 px-3">Serial Number</th>
                        <th className="py-2.5 px-3">Device Type</th>
                        <th className="py-2.5 px-3">Model</th>
                        <th className="py-2.5 px-3">Battery Serial</th>
                        <th className="py-2.5 px-3">Branch Code &amp; Name</th>
                        <th className="py-2.5 px-3">Lifecycle Stage</th>
                        {isStaffColVisible && <th className="py-2.5 px-3">Assigned Staff</th>}
                        {isMerchantColVisible && <th className="py-2.5 px-3">Merchant / MID</th>}
                        <th className="py-2.5 px-3 text-right">Pre-Validation</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isLight ? 'divide-slate-100 bg-white' : 'divide-slate-800/60 bg-[#12151e]'
                      }`}
                    >
                      {displayedStagedBatch.map((item, idx) => (
                        <tr
                          key={`${item.serial}-${idx}`}
                          className={
                            item.error || item.isDuplicateInFile
                              ? 'bg-rose-50/60 dark:bg-rose-950/20'
                              : item.isAlreadyInDb
                              ? 'bg-rose-50/40 dark:bg-rose-950/15'
                              : isLight
                              ? 'hover:bg-slate-50'
                              : 'hover:bg-slate-800/30'
                          }
                        >
                          <td className="py-1.5 px-3 font-mono text-slate-400">
                            #{item.csvRowNumber || idx + 1}
                          </td>
                          <td
                            className={`py-1.5 px-3 font-mono font-bold whitespace-nowrap ${
                              isLight ? 'text-slate-900' : 'text-white'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span>{item.serial}</span>
                              {item.stockOrigin === 'EXISTING_HQ_STOCK' && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded font-sans font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                                  ✓ In HQ Stock
                                </span>
                              )}
                              {item.stockOrigin === 'NEW_SERIAL' && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded font-sans font-bold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/25">
                                  + New
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-1.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {item.type === 'POS Terminal' ? (
                                <Cpu className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                              ) : (
                                <Volume2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                              )}
                              <span
                                className={`font-bold text-xs ${
                                  isLight ? 'text-slate-800' : 'text-slate-200'
                                }`}
                              >
                                {item.type}
                              </span>
                            </div>
                          </td>
                          <td
                            className={`py-1.5 px-3 font-semibold whitespace-nowrap ${
                              isLight ? 'text-slate-800' : 'text-slate-300'
                            }`}
                          >
                            {item.model}
                          </td>
                          <td className="py-1.5 px-3 font-mono font-semibold text-[#003857] dark:text-sky-300 whitespace-nowrap">
                            {item.batterySerial || '—'}
                          </td>
                          <td
                            className={`py-1.5 px-3 whitespace-nowrap ${
                              isLight ? 'text-slate-700' : 'text-slate-300'
                            }`}
                          >
                            <span className="font-mono font-bold">Code {item.branchId}</span>
                            <span className="text-slate-400 ml-1 text-[11px]">
                              ({item.branchName})
                            </span>
                          </td>
                          <td className="py-1.5 px-3 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                              item.stage === 'HQ_STOCK'
                                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60'
                                : item.stage === 'BRANCH_RESERVE'
                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60'
                                : item.stage === 'CONFIGURING'
                                ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200/80 dark:border-purple-800/60'
                                : item.stage === 'COMPLETE'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}>
                              {STAGE_META[item.stage]?.short || item.stage}
                            </span>
                          </td>
                          {isStaffColVisible && (
                            <td className="py-1.5 px-3 whitespace-nowrap">
                              {item.staff ? (
                                <div className="flex items-center gap-1 text-slate-800 dark:text-slate-200 font-semibold">
                                  <UserIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                  <span>{item.staff}</span>
                                </div>
                              ) : item.stage === 'BRANCH_RESERVE' || item.stage === 'CONFIGURING' || item.stage === 'COMPLETE' ? (
                                <span className="text-rose-600 dark:text-rose-400 font-bold text-[11px] flex items-center gap-1 bg-rose-500/10 px-1.5 py-0.5 rounded-md border border-rose-500/20">
                                  <AlertCircle className="w-3 h-3" /> Missing Staff
                                </span>
                              ) : (
                                <span className="text-slate-400 italic text-[11px]">Unassigned (HQ Stock)</span>
                              )}
                            </td>
                          )}
                          {isMerchantColVisible && (
                            <td className="py-1.5 px-3 whitespace-nowrap text-slate-500">
                              {item.merchantName ? (
                                <div className="flex flex-col">
                                  <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[140px]">
                                    {item.merchantName}
                                  </span>
                                  {item.mid && (
                                    <span className="text-[10px] font-mono text-slate-400">
                                      MID: {item.mid}
                                    </span>
                                  )}
                                </div>
                              ) : (item.stage === 'CONFIGURING' || item.stage === 'COMPLETE') ? (
                                <span className="text-rose-600 dark:text-rose-400 font-bold text-[11px] flex items-center gap-1 bg-rose-500/10 px-1.5 py-0.5 rounded-md border border-rose-500/20">
                                  <AlertCircle className="w-3 h-3" /> Missing Merchant
                                </span>
                              ) : (
                                <span className="text-slate-400 italic text-[11px]">Unassigned (Stock)</span>
                              )}
                            </td>
                          )}
                          <td className="py-1.5 px-3 text-right whitespace-nowrap">
                            {item.isAlreadyInDb ? (
                              <span
                                title={item.alreadyInDbMessage}
                                className="text-rose-600 dark:text-rose-400 font-bold text-[10px] px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 inline-flex items-center gap-1 max-w-[340px] truncate align-middle"
                              >
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span className="truncate">
                                  Validation: Not OK — {item.alreadyInDbMessage || 'Already in Branch Reserve'}
                                </span>
                              </span>
                            ) : item.isDuplicateInFile ? (
                              <span
                                title="Duplicate serial within uploaded batch"
                                className="text-rose-600 dark:text-rose-400 font-bold text-[10px] px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 inline-flex items-center gap-1"
                              >
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span>Validation: Not OK — Duplicate in batch</span>
                              </span>
                            ) : item.error ? (
                              <span
                                title={item.error}
                                className="text-rose-600 dark:text-rose-400 font-bold text-[10px] px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 inline-flex items-center gap-1 max-w-[340px] truncate align-middle"
                              >
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span className="truncate">Validation: Not OK — {item.error}</span>
                              </span>
                            ) : (
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                                <span>Validated OK</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}

                      {displayedStagedBatch.length === 0 && (
                        <tr>
                          <td
                            colSpan={7 + (isStaffColVisible ? 1 : 0) + (isMerchantColVisible ? 1 : 0) + 1}
                            className="py-12 text-center text-slate-400 text-xs"
                          >
                            <div className="flex flex-col items-center justify-center gap-2">
                              <Upload className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                              <p className="font-semibold text-slate-600 dark:text-slate-300">
                                {activeStagedBatch.length > 0
                                  ? `No entries staged matching ${activeCycleSchema.name}`
                                  : `No entries staged yet for ${activeCycleSchema.name}`}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                {activeStagedBatch.length > 0
                                  ? 'Switch filters above to view other staged intake records'
                                  : method === 'tableCsv'
                                  ? `Drag and drop your ${activeCycleSchema.tag} CSV file above or click Browse to stage serials`
                                  : 'Paste serial numbers in the text areas above to stage inventory'}
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Step 1 Footer */}
            <div
              className={`border-t px-6 py-3 flex items-center justify-between text-xs ${
                isLight
                  ? 'bg-slate-50/90 border-slate-200/80'
                  : 'bg-[#0e111a] border-slate-800/80'
              }`}
            >
              <div className="flex items-center gap-2">
                {isUploadHalted ? (
                  <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-bold text-xs bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/20">
                    <Ban className="w-3.5 h-3.5" />
                    <span>Upload halted: fix {haltingValidationIssues.length} row/column error(s) in CSV to proceed</span>
                  </span>
                ) : validItems.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold text-xs bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {validItems.length} pre-validated serials ready ({Math.ceil(validItems.length / CSV_BATCH_SIZE)} batch{Math.ceil(validItems.length / CSV_BATCH_SIZE) === 1 ? '' : 'es'} of {CSV_BATCH_SIZE})
                    </span>
                    {alreadyInDbCount > 0 && (
                      <span className="text-amber-700 dark:text-amber-300 font-medium ml-1">
                        ({alreadyInDbCount} already in reserve skipped)
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-slate-400 text-xs">
                    0 valid serials ready for intake staging
                    {alreadyInDbCount > 0 && ` (${alreadyInDbCount} already in reserve skipped)`}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={onClose}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                    isLight
                      ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                      : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'
                  }`}
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={() => {
                    if (validItems.length > 0 && !isUploadHalted) setBatchStep('PREVIEW');
                  }}
                  disabled={validItems.length === 0 || isUploadHalted}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white disabled:opacity-50 disabled:cursor-not-allowed transition shadow-xs cursor-pointer flex items-center gap-2"
                >
                  <span>Review Intake Batch (Step 2 Preview)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </motion.button>
              </div>
            </div>
          </>
        ) : (
          /* STEP 2: INTAKE VERIFICATION & DATABASE WRITE PREVIEW */
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="p-6 overflow-y-auto flex flex-col gap-4 text-xs">
              {/* Alert Banner */}
              <div
                className={`p-4 rounded-2xl border flex items-start gap-3.5 ${
                  isLight
                    ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                    : 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                }`}
              >
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-extrabold text-xs block">
                    Double-Step Safeguard: Batched Database Insert ({CSV_BATCH_SIZE} Rows / Batch, {CSV_BATCH_DELAY_MS}ms Delay)
                  </span>
                  <p className="text-[11px] mt-0.5 opacity-90 leading-relaxed">
                    All <strong>{validItems.length} hardware items</strong> passed strict client-side pre-validation and will be inserted into Supabase in <strong>{Math.ceil(validItems.length / CSV_BATCH_SIZE)} batch(es) of {CSV_BATCH_SIZE} rows</strong> with a {CSV_BATCH_DELAY_MS}ms pause between batches to protect connection pools.
                  </p>
                </div>
              </div>

              {batchProgress && (
                <div className="p-3.5 rounded-2xl border border-sky-300 bg-sky-50 text-sky-900 flex items-center justify-between gap-3">
                  <span className="font-bold">
                    Uploading Batch {batchProgress.current} of {batchProgress.total} ({batchProgress.rowsSent} / {batchProgress.totalRows} rows)...
                  </span>
                  <span className="font-mono font-bold">
                    {Math.round((batchProgress.rowsSent / Math.max(1, batchProgress.totalRows)) * 100)}%
                  </span>
                </div>
              )}

              {/* Breakdown Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div
                  className={`p-3 rounded-xl border ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#181c26] border-slate-700'
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                    Total Serials To Write
                  </span>
                  <span className="font-bold text-sm text-[#1e5b88] dark:text-sky-300 mt-0.5 block">
                    {validItems.length} Units
                  </span>
                </div>

                <div
                  className={`p-3 rounded-xl border ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#181c26] border-slate-700'
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                    Hardware Breakdown
                  </span>
                  <span className="font-bold text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                    {validPosCount} POS · {validSbCount} Sound Box
                  </span>
                </div>

                <div
                  className={`p-3 rounded-xl border ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#181c26] border-slate-700'
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                    Target Branches
                  </span>
                  <span className="font-bold text-xs mt-0.5 block truncate">
                    {Array.from(new Set(validItems.map((i) => `Code ${i.branchId}`))).join(', ') || 'Code 100'}
                  </span>
                </div>

                <div
                  className={`p-3 rounded-xl border ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#181c26] border-slate-700'
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                    Batch Schedule
                  </span>
                  <span className="font-bold text-xs text-slate-600 dark:text-slate-300 mt-0.5 block">
                    {Math.ceil(validItems.length / CSV_BATCH_SIZE)} × {CSV_BATCH_SIZE} rows ({CSV_BATCH_DELAY_MS}ms)
                  </span>
                </div>
              </div>

              {/* Staged Items Preview Table Aligned with Table Format */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold uppercase tracking-wider text-[11px] text-slate-600 dark:text-slate-400">
                    Validated Table Entries To Register ({validItems.length})
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    Scroll horizontally/vertically to review
                  </span>
                </div>
                <div
                  className={`overflow-x-auto max-h-64 border rounded-2xl ${
                    isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-[#12151e]'
                  }`}
                >
                  <table className="w-full text-left text-xs min-w-[750px]">
                    <thead className="glass-table-thead text-[10px] uppercase font-extrabold text-white">
                      <tr>
                        <th className="py-2.5 px-3">No.</th>
                        <th className="py-2.5 px-3">Serial Number</th>
                        <th className="py-2.5 px-3">Device Type</th>
                        <th className="py-2.5 px-3">Model</th>
                        <th className="py-2.5 px-3">Battery Serial</th>
                        <th className="py-2.5 px-3">Stock Location</th>
                        <th className="py-2.5 px-3">Initial Stage</th>
                        {isStaffColVisible && <th className="py-2.5 px-3">Assigned Staff</th>}
                        {isMerchantColVisible && <th className="py-2.5 px-3">Merchant / MID</th>}
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isLight ? 'divide-slate-200/80' : 'divide-slate-800'
                      }`}
                    >
                      {validItems.map((item, idx) => (
                        <tr
                          key={idx}
                          className={isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/40'}
                        >
                          <td className="py-1.5 px-3 font-mono font-bold text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="py-1.5 px-3 font-mono font-bold text-[#1e5b88] dark:text-sky-300">
                            {item.serial}
                          </td>
                          <td className="py-1.5 px-3 font-semibold">{item.type}</td>
                          <td className="py-1.5 px-3 text-slate-500">{item.model}</td>
                          <td className="py-1.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                            {item.batterySerial || '—'}
                          </td>
                          <td className="py-1.5 px-3 font-medium text-slate-600 dark:text-slate-300">
                            Code {item.branchId} ({item.branchName})
                          </td>
                          <td className="py-1.5 px-3 font-medium">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                              item.stage === 'HQ_STOCK'
                                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60'
                                : item.stage === 'BRANCH_RESERVE'
                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60'
                                : item.stage === 'CONFIGURING'
                                ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200/80 dark:border-purple-800/60'
                                : item.stage === 'COMPLETE'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}>
                              {STAGE_META[item.stage]?.short || item.stage}
                            </span>
                          </td>
                          {isStaffColVisible && (
                            <td className="py-1.5 px-3 text-slate-600 dark:text-slate-300">
                              {item.staff ? (
                                <div className="flex items-center gap-1">
                                  <UserIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                  <span>{item.staff}</span>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">Unassigned</span>
                              )}
                            </td>
                          )}
                          {isMerchantColVisible && (
                            <td className="py-1.5 px-3 text-slate-500">
                              {item.merchantName ? (
                                <span>
                                  {item.merchantName} {item.mid ? `(${item.mid})` : ''}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">Unassigned</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>
                  Each item is inserted in batches of {CSV_BATCH_SIZE} rows with {CSV_BATCH_DELAY_MS}ms spacing and error-only failure telemetry.
                </span>
              </div>
            </div>

            {/* Step 2 Footer */}
            <div
              className={`border-t px-6 py-3.5 flex items-center justify-between text-xs ${
                isLight
                  ? 'bg-slate-50 border-slate-200/80'
                  : 'bg-[#0e111a] border-slate-800/80'
              }`}
            >
              <motion.button
                whileTap={{ scale: 0.94 }}
                type="button"
                disabled={isCommittingBatches}
                onClick={() => setBatchStep('INPUT')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
                  isLight
                    ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                    : 'bg-[#181c26] hover:bg-[#202534] text-slate-300 border-slate-700'
                }`}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Edit Intake</span>
              </motion.button>

              {commitNotice && (
                <span role="alert" className="flex-1 mx-3 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  {commitNotice}
                </span>
              )}

              <motion.button
                whileTap={{ scale: 0.94 }}
                type="button"
                onClick={() => void handleCommit()}
                disabled={validItems.length === 0 || isUploadHalted || isCommittingBatches}
                className="px-6 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white transition shadow-md cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>
                  {isCommittingBatches
                    ? `Uploading Batch ${batchProgress?.current || 1}/${batchProgress?.total || 1}...`
                    : `Confirm & Commit ${validItems.length} Entries to Database`}
                </span>
              </motion.button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
