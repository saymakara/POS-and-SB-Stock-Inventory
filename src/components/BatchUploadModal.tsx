import React, { useState, useMemo, useRef } from 'react';
import { Branch, LifecycleStage, Device, ThemeMode } from '../types';
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
  FileDown,
  FileSpreadsheet,
  RotateCcw,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  Building2,
  Layers,
  FileText,
  Sparkles,
} from 'lucide-react';
import { motion } from 'motion/react';
import { normalizeMid } from '../utils/display';
import { parseCsv, detectDelimiter, csvFile } from '../utils/csv';
import { todayPP } from '../utils/time';

export const SCHEMA_COLUMNS = [
  { id: 'Stock_In_Date', label: 'Stock_In_Date', desc: 'Date (YYYY-MM-DD)', req: false },
  { id: 'Serial_SN', label: 'Serial_SN', desc: 'Hardware Serial Number', req: true },
  { id: 'Product_Type', label: 'Product_Type', desc: 'POS Terminal | Sound Box', req: false },
  { id: 'Model', label: 'Model', desc: 'Hardware Model Name', req: false },
  { id: 'Battery_Serial', label: 'Battery_Serial', desc: 'Battery Serial Number', req: false },
  { id: 'Branch_Code', label: 'Branch_Code', desc: 'Branch ID (e.g. 100, 101)', req: false },
  { id: 'Branch_Name', label: 'Branch_Name', desc: 'Branch Location Name', req: false },
  { id: 'Lifecycle_Stage', label: 'Lifecycle_Stage', desc: 'Current Stock Stage', req: false },
  { id: 'Merchant_Name', label: 'Merchant_Name', desc: 'Assigned Merchant Business', req: false },
  { id: 'MID', label: 'MID', desc: 'Merchant ID (15 digits)', req: false },
  { id: 'TID', label: 'TID', desc: 'Terminal ID (8 digits)', req: false },
  { id: 'Serial_Cycles_Count', label: 'Serial_Cycles_Count', desc: 'Redeployment Count', req: false },
];

export interface StagedItem {
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
  /** Why this row cannot be imported (unknown branch, bad stage/date…); rows with an error are not committed. */
  error?: string;
}

interface BatchUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
  existingDevices: Device[];
  onCommitBatch: (newDevices: Partial<Device>[]) => void;
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

// Parse device type from row or serial format
function parseDeviceType(rawType: string, serial: string): 'POS Terminal' | 'Sound Box' {
  const t = rawType.trim().toLowerCase();
  if (t.includes('sound') || t.includes('audio') || t.includes('box') || t === 'sb') {
    return 'Sound Box';
  }
  if (t.includes('pos') || t.includes('terminal') || t.includes('wizar') || t.includes('pax')) {
    return 'POS Terminal';
  }
  if (serial.toUpperCase().startsWith('SB')) {
    return 'Sound Box';
  }
  return 'POS Terminal';
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

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
  existingDevices,
  onCommitBatch,
  theme = 'light',
  operatorLabel = '',
}) => {
  const [batchStep, setBatchStep] = useState<'INPUT' | 'PREVIEW'>('INPUT');
  const [method, setMethod] = useState<'tableCsv' | 'paste' | 'range'>('tableCsv');

  // Master Table CSV State
  const [tableCsvText, setTableCsvText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showSchemaGuide, setShowSchemaGuide] = useState(false);
  const [copiedHeaders, setCopiedHeaders] = useState(false);
  const [uploadedFileMeta, setUploadedFileMeta] = useState<{ name: string; size: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Target stock destination defaults (used only for rows that give no branch / stage)
  const [defaultBranchId, setDefaultBranchId] = useState('100');
  const [defaultStage, setDefaultStage] = useState<LifecycleStage>('HQ_STOCK');

  // Field 1: POS Terminal state (Method B / C). Range inputs start empty: serials come from the carton label.
  const [posModel, setPosModel] = useState('Wizar POS Q2 Pro');
  const [posPasteText, setPosPasteText] = useState('');
  const [posPrefix, setPosPrefix] = useState('');
  const [posStartNum, setPosStartNum] = useState('');
  const [posPadding, setPosPadding] = useState(8);
  const [posQty, setPosQty] = useState(0);

  // Field 2: Sound Box state (Method B / C)
  const [sbModel, setSbModel] = useState('Q161 Pro');
  const [sbPasteText, setSbPasteText] = useState('');
  const [sbPrefix, setSbPrefix] = useState('');
  const [sbStartNum, setSbStartNum] = useState('');
  const [sbPadding, setSbPadding] = useState(5);
  const [sbQty, setSbQty] = useState(0);

  const [generatedRangeBatch, setGeneratedRangeBatch] = useState<StagedItem[]>([]);
  const [rangeError, setRangeError] = useState('');
  const [commitNotice, setCommitNotice] = useState('');

  // Reset step when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setBatchStep('INPUT');
      setCommitNotice('');
    }
  }, [isOpen]);

  // A generated range is only valid for the inputs it was made from: changing any of them clears it.
  React.useEffect(() => {
    setGeneratedRangeBatch([]);
  }, [posPrefix, posStartNum, posPadding, posQty, posModel, sbPrefix, sbStartNum, sbPadding, sbQty, sbModel, defaultBranchId, defaultStage]);

  const isLight = theme === 'light';
  const existingSerials = useMemo(
    () => new Set(existingDevices.map((d) => d.serial.trim().toUpperCase())),
    [existingDevices]
  );

  const defaultBranch = useMemo(
    () => branches.find((b) => b.id === defaultBranchId || b.code === defaultBranchId),
    [branches, defaultBranchId]
  );
  const findBranch = (code: string) => branches.find((b) => b.id === code || b.code === code);
  const staffLabel = operatorLabel.trim();

  /** Branch for a row: its own code when given (unknown code = error, never defaulted), otherwise the chosen default. */
  const resolveBranch = (rawCode: string): { branch?: Branch; error?: string } => {
    const code = rawCode.trim();
    if (code) {
      const digits = (code.match(/\d+/) || [''])[0];
      const b = digits ? findBranch(digits) : undefined;
      return b ? { branch: b } : { error: `Unknown branch code "${code}"` };
    }
    return defaultBranch ? { branch: defaultBranch } : { error: 'Choose the default branch' };
  };

  // Master Table CSV Parser: Parses files formatted exactly as the inventory table
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
        'merchantname',
        'mid',
        'tid',
      ].some((k) => t.includes(k))
    );

    let colMap: Record<string, number> = {};
    let dataStartIdx = 0;

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
        else if (/(merchant.*name|merchant)/.test(token) && !/merchantid/.test(token) && colMap.merchantName === undefined) colMap.merchantName = idx;
        else if (/(^mid$|merchant.*id)/.test(token) && colMap.mid === undefined) colMap.mid = idx;
        else if (/(^tid$|terminal.*id)/.test(token) && colMap.tid === undefined) colMap.tid = idx;
        else if (/(cycles|redeploy)/.test(token) && colMap.redeployCount === undefined) colMap.redeployCount = idx;
      });
    } else {
      // No header: detect column order based on column count and date presence
      const sample = rows[0];
      if (sample.length >= 6 && /^\d{4}-\d{2}-\d{2}/.test(sample[0])) {
        // Standard table export order:
        // 0: Stock_In_Date, 1: Serial_SN, 2: Product_Type, 3: Model, 4: Battery_Serial, 5: Branch_Code, 6: Branch_Name, 7: Lifecycle_Stage, 8: Merchant_Name, 9: MID, 10: TID, 11: Serial_Cycles_Count
        colMap = {
          stockInDate: 0,
          serial: 1,
          type: 2,
          model: 3,
          batterySerial: 4,
          branchCode: 5,
          branchName: 6,
          stage: 7,
          merchantName: 8,
          mid: 9,
          tid: 10,
          redeployCount: 11,
        };
      } else if (sample.length >= 2 && !/^\d{4}-\d{2}-\d{2}/.test(sample[0])) {
        // Serial, BatterySerial, BranchCode
        colMap = {
          serial: 0,
          batterySerial: 1,
          branchCode: 2,
        };
      } else {
        colMap = { serial: 0 };
      }
    }

    const cell = (row: string[], key: string) => (colMap[key] !== undefined ? row[colMap[key]] || '' : '').trim();
    const parsed: StagedItem[] = [];
    const today = todayPP();

    for (let i = dataStartIdx; i < rows.length; i++) {
      const row = rows[i];
      const serial = cell(row, 'serial').toUpperCase();
      if (!serial || serial === 'SERIAL' || serial === 'SERIAL_SN' || serial === 'SERIAL NUMBER (SN)') {
        continue;
      }
      const errors: string[] = [];

      const itemType = parseDeviceType(cell(row, 'type'), serial);
      const isPos = itemType === 'POS Terminal';
      const rawModel = isPos ? cell(row, 'model') || posModel : 'Q161 Pro';   // the only Sound Box model
      // Battery serial only as written in the file (blank when the file has none).
      const rawBattery = cell(row, 'batterySerial');

      const { branch: targetBranch, error: branchError } = resolveBranch(cell(row, 'branchCode'));
      if (branchError) errors.push(branchError);

      const rawStage = cell(row, 'stage');
      const fallbackStage: LifecycleStage = targetBranch?.id === '100' ? 'HQ_STOCK' : defaultStage;
      const stage = parseStageValue(rawStage, fallbackStage);
      if (!stage) errors.push(`Unknown stage "${rawStage}"`);

      const rawDate = cell(row, 'stockInDate');
      if (rawDate && !isDate(rawDate)) errors.push(`Stock-in date "${rawDate}" is not YYYY-MM-DD`);
      const stockInDate = isDate(rawDate) ? rawDate : today;

      const rawCycles = colMap.redeployCount !== undefined ? parseInt(row[colMap.redeployCount], 10) : 0;
      const redeployCount = isNaN(rawCycles) ? 0 : Math.max(0, rawCycles);

      parsed.push({
        serial,
        batterySerial: rawBattery,
        model: rawModel,
        type: itemType,
        branchId: targetBranch?.id || cell(row, 'branchCode'),
        branchName: targetBranch?.name || cell(row, 'branchName'),
        staff: staffLabel,
        stage: stage || fallbackStage,
        stockInDate,
        merchantName: cell(row, 'merchantName'),
        mid: normalizeMid(cell(row, 'mid')),
        tid: cell(row, 'tid'),
        redeployCount,
        isDuplicate: false,
        error: errors.join('; ') || undefined,
      });
    }

    return parsed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableCsvText, branches, defaultBranch, defaultStage, posModel, sbModel, staffLabel]);

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
      // parseCsv keeps empty fields, so "SN,,105" still puts 105 in the branch column.
      const rows = parseCsv(raw, detectDelimiter(raw.split(/\r?\n/)[0] || ''));

      rows.forEach((parts) => {
        const first = (parts[0] || '').toLowerCase();
        if (first.startsWith('serial') || first.startsWith('stock')) return;

        // Auto-detect if line is table-formatted: [date, serial, type, model, battery, branch]
        let serial = (parts[0] || '').toUpperCase();
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
          // Serial, BranchCode
          branchPart = modelPart;
          modelPart = '';
        }

        if (!serial) return;

        const { branch: curBranch, error: branchError } = resolveBranch(branchPart);
        parsed.push({
          serial,
          batterySerial,
          model: fixedType === 'Sound Box' ? 'Q161 Pro' : modelPart || selectedModel,
          type: fixedType,
          branchId: curBranch?.id || branchPart,
          branchName: curBranch?.name || '',
          staff: staffLabel,
          stage: curBranch?.id === '100' ? 'HQ_STOCK' : defaultStage,
          stockInDate: today,
          isDuplicate: false,
          error: branchError,
        });
      });
    };

    parseLinesForType(posPasteText, 'POS Terminal', posModel);
    parseLinesForType(sbPasteText, 'Sound Box', sbModel);

    return parsed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posPasteText, sbPasteText, posModel, sbModel, defaultBranch, defaultStage, branches, staffLabel]);

  /**
   * Method C: consecutive serials from a range the operator types from the carton label (prefix + start number +
   * quantity). Nothing is pre-filled, and battery serials are left blank (they are not part of a range).
   */
  const handleGenerateDualRange = () => {
    setRangeError('');
    if (!defaultBranch) {
      setRangeError('Choose the default branch first.');
      return;
    }
    const safePosQty = Math.min(200, Math.max(0, posQty));
    const safeSbQty = Math.min(200, Math.max(0, sbQty));
    const posStart = parseInt(posStartNum, 10);
    const sbStart = parseInt(sbStartNum, 10);
    const problems: string[] = [];
    if (safePosQty > 0 && (!posPrefix.trim() || isNaN(posStart))) problems.push('enter the POS prefix and start number');
    if (safeSbQty > 0 && (!sbPrefix.trim() || isNaN(sbStart))) problems.push('enter the Sound Box prefix and start number');
    if (safePosQty + safeSbQty === 0) problems.push('enter a quantity');
    if (problems.length) {
      setRangeError(`To generate a range, ${problems.join(' and ')}.`);
      setGeneratedRangeBatch([]);
      return;
    }
    const stage: LifecycleStage = defaultBranch.id === '100' ? 'HQ_STOCK' : defaultStage;
    const today = todayPP();
    const generated: StagedItem[] = [];
    const push = (serial: string, type: 'POS Terminal' | 'Sound Box', model: string) =>
      generated.push({
        serial,
        batterySerial: '',
        model,
        type,
        branchId: defaultBranch.id,
        branchName: defaultBranch.name,
        staff: staffLabel,
        stage,
        stockInDate: today,
        isDuplicate: false,
      });

    for (let i = 0; i < safePosQty; i++) {
      push(`${posPrefix.trim().toUpperCase()}${String(posStart + i).padStart(posPadding, '0')}`, 'POS Terminal', posModel);
    }
    for (let i = 0; i < safeSbQty; i++) {
      push(`${sbPrefix.trim().toUpperCase()}${String(sbStart + i).padStart(sbPadding, '0')}`, 'Sound Box', sbModel);
    }

    setGeneratedRangeBatch(generated);
  };

  const handleTableCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeKb = (file.size / 1024).toFixed(1);
    setUploadedFileMeta({ name: file.name, size: `${sizeKb} KB` });
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = (evt.target?.result as string) || '';
      setTableCsvText(content);
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const sizeKb = (file.size / 1024).toFixed(1);
    setUploadedFileMeta({ name: file.name, size: `${sizeKb} KB` });
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = (evt.target?.result as string) || '';
      setTableCsvText(content);
    };
    reader.readAsText(file);
  };

  const handleClearCsv = () => {
    setTableCsvText('');
    setUploadedFileMeta(null);
  };

  const handleCopyHeaders = () => {
    const headerLine = SCHEMA_COLUMNS.map((c) => c.label).join(',');
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

  /** Header row only: sample rows with made-up serials/MIDs could be uploaded by mistake as real stock. */
  const handleDownloadTemplate = () => {
    const blob = csvFile([SCHEMA_COLUMNS.map((c) => c.label)]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inventory_table_upload_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  /** The rows for the chosen method, with duplicates flagged against the CURRENT inventory and within the batch. */
  const activeStagedBatch = useMemo(() => {
    const raw = method === 'tableCsv' ? tableCsvBatch : method === 'paste' ? pastedBatch : generatedRangeBatch;
    const seen = new Set<string>();
    return raw.map((item) => {
      const key = item.serial.trim().toUpperCase();
      const isDuplicate = existingSerials.has(key) || seen.has(key);
      seen.add(key);
      return item.isDuplicate === isDuplicate ? item : { ...item, isDuplicate };
    });
  }, [method, tableCsvBatch, pastedBatch, generatedRangeBatch, existingSerials]);

  const { validItems, dupCount, errorCount, validPosCount, validSbCount } = useMemo(() => {
    const valid = activeStagedBatch.filter((i) => !i.isDuplicate && !i.error);
    const dups = activeStagedBatch.filter((i) => i.isDuplicate).length;
    return {
      validItems: valid,
      dupCount: dups,
      errorCount: activeStagedBatch.filter((i) => !i.isDuplicate && i.error).length,
      validPosCount: valid.filter((i) => i.type === 'POS Terminal').length,
      validSbCount: valid.filter((i) => i.type === 'Sound Box').length,
    };
  }, [activeStagedBatch]);

  const handleCommit = () => {
    if (validItems.length === 0) return;
    // Final re-check against the inventory as it is now: an existing serial is never sent (so never overwritten).
    const stillNew = validItems.filter((i) => !existingSerials.has(i.serial.trim().toUpperCase()));
    if (stillNew.length !== validItems.length) {
      setCommitNotice(
        `${validItems.length - stillNew.length} serial(s) were added to the inventory by someone else while you were reviewing. They are now marked as duplicates; review the list and confirm again.`
      );
      return;
    }
    onCommitBatch(
      stillNew.map(({ isDuplicate: _d, error: _e, ...rest }) => ({ ...rest, serial: rest.serial.trim().toUpperCase() }))
    );
    setTableCsvText('');
    setUploadedFileMeta(null);
    setPosPasteText('');
    setSbPasteText('');
    setGeneratedRangeBatch([]);
    setCommitNotice('');
    onClose();
  };

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
        transition={{ type: 'spring', damping: 28, stiffness: 350, mass: 0.75 }}
        className={`${modalBoxClass} border-0 rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] transform-gpu will-change-gpu gpu-modal-container`}
      >
        {/* Header (Signature Navy Bar) */}
        <div className="navy-header-bar rounded-t-3xl px-6 py-4 flex items-center justify-between text-white">
          <div>
            <h3 className="text-base font-bold flex items-center gap-2">
              <FilePlus className="w-5 h-5 text-[#7cc4ed]" />
              Batch Hardware Stock Intake — Table CSV Import
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Upload CSV formatted identically to the inventory table or intake hardware serials into multi-branch reserve
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
              <span>Stage &amp; Prepare Serials</span>
            </button>

            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />

            <button
              type="button"
              onClick={() => {
                if (validItems.length > 0) setBatchStep('PREVIEW');
              }}
              disabled={validItems.length === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition ${
                batchStep === 'PREVIEW'
                  ? 'bg-[#004953] text-white shadow-xs'
                  : validItems.length > 0
                  ? 'text-slate-600 hover:text-slate-900 cursor-pointer'
                  : 'text-slate-400 opacity-60 cursor-not-allowed'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black">
                2
              </span>
              <span>Intake Verification &amp; Write</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-[#1e5b88]" />
            <span>Double-Step Safeguard</span>
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
                <button
                  type="button"
                  onClick={() => setMethod('range')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    method === 'range'
                      ? 'bg-white dark:bg-slate-900 text-[#1e5b88] dark:text-sky-300 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Method C: Range Generator</span>
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
                      (Applied automatically when omitted or unmapped in CSV row)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                        setDefaultStage(e.target.value as LifecycleStage)
                      }
                      className={`w-full rounded-xl px-3 py-1.5 text-xs font-semibold border transition ${inputClass}`}
                    >
                      <option value="HQ_STOCK">Admin HQ Stock (Branch Code 100)</option>
                      <option value="BRANCH_RESERVE">Branch Reserve (Stock-In)</option>
                      <option value="CONFIGURING">Configuring</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* METHOD A: TABLE CSV FILE UPLOAD & TEMPLATE */}
              {method === 'tableCsv' && (
                <div className="flex flex-col gap-3">
                  {/* Drag and Drop Zone + Action Bar */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`p-4 rounded-2xl border-2 border-dashed transition-all flex flex-col sm:flex-row items-center justify-between gap-3.5 ${
                      isDragging
                        ? 'border-[#1e5b88] bg-sky-50 dark:bg-sky-950/30'
                        : isLight
                        ? 'border-slate-300/80 bg-slate-50/60 hover:bg-slate-50'
                        : 'border-slate-700/80 bg-slate-900/30 hover:bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 w-full sm:w-auto">
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
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Drag and drop <code>.csv</code> file, or click Browse to import inventory table records.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap shrink-0 w-full sm:w-auto justify-end">
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
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs transition cursor-pointer flex items-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Browse File</span>
                      </motion.button>

                      <motion.button
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        type="button"
                        onClick={handleDownloadTemplate}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 shadow-2xs transition cursor-pointer flex items-center gap-1.5"
                        title="Download sample CSV formatted identically to the inventory table"
                      >
                        <FileDown className="w-3.5 h-3.5 text-[#1e5b88] dark:text-sky-400" />
                        <span>Download Template</span>
                      </motion.button>

                      {tableCsvText && (
                        <button
                          type="button"
                          onClick={handleClearCsv}
                          className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white transition cursor-pointer flex items-center gap-1"
                          title="Clear CSV Content"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Clear</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Format Reference Banner with Collapsible Schema Guide */}
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
                            Table CSV Schema
                          </span>
                          <span className="text-[11px] text-slate-500 ml-1.5 hidden sm:inline">
                            Exact 12-column layout matching inventory export
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleCopyHeaders}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-[#1e5b88] transition flex items-center gap-1 cursor-pointer shadow-2xs"
                          title="Copy column header line to clipboard"
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
                          <span>{showSchemaGuide ? 'Hide Columns' : 'View 12 Columns'}</span>
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
                      <div className="px-3 pb-3 pt-1 border-t border-slate-200/60 dark:border-slate-800/80">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 font-mono text-[10px]">
                          {SCHEMA_COLUMNS.map((col, idx) => (
                            <div
                              key={col.id}
                              className="p-1.5 rounded-lg bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 flex flex-col gap-0.5"
                            >
                              <div className="flex items-center justify-between text-slate-900 dark:text-white font-bold">
                                <span>{idx + 1}. {col.label}</span>
                                {col.req && (
                                  <span className="text-[9px] font-sans font-extrabold text-amber-600 dark:text-amber-400">
                                    REQ
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
                  <div className="p-4 rounded-2xl border border-[#133e5e]/25 bg-[#133e5e]/[0.03] flex flex-col gap-3">
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
                        <option value="PAX A920 Pro">PAX A920 Pro</option>
                        <option value="Verifone V200c">Verifone V200c</option>
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
                  </div>

                  {/* Field 2: Sound Box */}
                  <div className="p-4 rounded-2xl border border-[#1e5b88]/25 bg-[#1e5b88]/[0.03] flex flex-col gap-3">
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
                  </div>
                </div>
              )}

              {/* METHOD C: SEQUENTIAL RANGE GENERATOR */}
              {method === 'range' && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Field 1: POS Terminal Range */}
                    <div className="p-4 rounded-2xl border border-[#133e5e]/25 bg-[#133e5e]/[0.03] space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-[#133e5e] text-white">
                          <Cpu className="w-4 h-4" />
                        </span>
                        <div>
                          <div className="text-xs font-extrabold text-[#133e5e]">
                            Field 1: POS Terminal Generator
                          </div>
                          <div className="text-[10px] text-slate-500">
                            Type: POS Terminal
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="col-span-2">
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            POS Model
                          </label>
                          <select
                            value={posModel}
                            onChange={(e) => setPosModel(e.target.value)}
                            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-bold border ${inputClass}`}
                          >
                            <option value="Wizar POS Q2 Pro">Wizar POS Q2 Pro</option>
                            <option value="PAX A920 Pro">PAX A920 Pro</option>
                            <option value="Verifone V200c">Verifone V200c</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            POS Prefix
                          </label>
                          <input
                            type="text"
                            value={posPrefix}
                            placeholder="e.g. prefix on the label"
                            aria-label="POS serial prefix"
                            onChange={(e) => setPosPrefix(e.target.value)}
                            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono border ${inputClass}`}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            POS Qty
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={200}
                            value={posQty}
                            onChange={(e) =>
                              setPosQty(Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono border ${inputClass}`}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            Start Number
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={posStartNum}
                            placeholder="From carton label"
                            aria-label="POS start number"
                            onChange={(e) => setPosStartNum(e.target.value)}
                            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono border ${inputClass}`}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            Zero Padding
                          </label>
                          <input
                            type="number"
                            value={posPadding}
                            onChange={(e) =>
                              setPosPadding(parseInt(e.target.value, 10) || 5)
                            }
                            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono border ${inputClass}`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Field 2: Sound Box Range */}
                    <div className="p-4 rounded-2xl border border-[#1e5b88]/25 bg-[#1e5b88]/[0.03] space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-[#1e5b88] text-white">
                          <Volume2 className="w-4 h-4" />
                        </span>
                        <div>
                          <div className="text-xs font-extrabold text-[#154360]">
                            Field 2: Sound Box Generator
                          </div>
                          <div className="text-[10px] text-slate-500">
                            Type: Sound Box
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="col-span-2">
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
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            Sound Box Prefix
                          </label>
                          <input
                            type="text"
                            value={sbPrefix}
                            placeholder="e.g. prefix on the label"
                            aria-label="Sound Box serial prefix"
                            onChange={(e) => setSbPrefix(e.target.value)}
                            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono border ${inputClass}`}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            Sound Box Qty
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={200}
                            value={sbQty}
                            onChange={(e) =>
                              setSbQty(Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono border ${inputClass}`}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            Start Number
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={sbStartNum}
                            placeholder="From carton label"
                            aria-label="Sound Box start number"
                            onChange={(e) => setSbStartNum(e.target.value)}
                            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono border ${inputClass}`}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">
                            Zero Padding
                          </label>
                          <input
                            type="number"
                            value={sbPadding}
                            onChange={(e) =>
                              setSbPadding(parseInt(e.target.value, 10) || 5)
                            }
                            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono border ${inputClass}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3">
                    {rangeError && (
                      <span role="alert" className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                        {rangeError}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleGenerateDualRange}
                      className="px-4 py-2 rounded-xl text-xs font-extrabold bg-[#003857] hover:bg-[#002a42] text-white transition shadow-xs cursor-pointer"
                    >
                      Generate POS Terminal &amp; Sound Box Serials
                    </button>
                  </div>
                </div>
              )}

              {/* Staged Output Table (Matches Inventory Table Format) */}
              <div
                className={`border rounded-2xl overflow-hidden shadow-2xs ${
                  isLight ? 'border-slate-200/90' : 'border-slate-800'
                }`}
              >
                <div
                  className={`px-4 py-2 border-b flex items-center justify-between text-xs ${
                    isLight
                      ? 'bg-slate-50 border-slate-200 text-slate-800'
                      : 'bg-slate-900 border-slate-800 text-white'
                  }`}
                >
                  <span className="font-bold flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-[#1e5b88] dark:text-sky-400" />
                    <span>
                      Staged Inventory Table Live Preview
                    </span>
                    <span className="text-[11px] font-normal text-slate-500 font-mono">
                      ({validItems.length} valid: {validPosCount} POS, {validSbCount} Sound Box · {activeStagedBatch.length} row{activeStagedBatch.length === 1 ? '' : 's'} read)
                    </span>
                  </span>
                  {(dupCount > 0 || errorCount > 0) && (
                    <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1 text-[11px] bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {dupCount > 0 && `${dupCount} duplicate(s) skipped`}
                      {dupCount > 0 && errorCount > 0 && ' · '}
                      {errorCount > 0 && `${errorCount} row(s) with errors`}
                    </span>
                  )}
                </div>

                <div className="overflow-auto min-h-[240px] max-h-[62vh]">
                  <table className="w-full text-left text-xs min-w-[800px]">
                    <thead className="glass-table-thead text-[10px] uppercase font-extrabold text-white sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">No.</th>
                        <th className="py-2.5 px-3">Stock-In Date</th>
                        <th className="py-2.5 px-3">Serial Number</th>
                        <th className="py-2.5 px-3">Device Type</th>
                        <th className="py-2.5 px-3">Model</th>
                        <th className="py-2.5 px-3">Battery Serial</th>
                        <th className="py-2.5 px-3">Branch Code &amp; Name</th>
                        <th className="py-2.5 px-3">Lifecycle Stage</th>
                        <th className="py-2.5 px-3">Merchant / MID</th>
                        <th className="py-2.5 px-3 text-right">Validation</th>
                      </tr>
                    </thead>
                    <tbody
                      className={`divide-y ${
                        isLight ? 'divide-slate-100 bg-white' : 'divide-slate-800/60 bg-[#12151e]'
                      }`}
                    >
                      {activeStagedBatch.map((item, idx) => (
                        <tr
                          key={`${item.serial}-${idx}`}
                          className={
                            isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/30'
                          }
                        >
                          <td className="py-1.5 px-3 font-mono text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="py-1.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                            {item.stockInDate || '—'}
                          </td>
                          <td
                            className={`py-1.5 px-3 font-mono font-bold whitespace-nowrap ${
                              isLight ? 'text-slate-900' : 'text-white'
                            }`}
                          >
                            {item.serial}
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
                            {item.batterySerial}
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
                          <td className="py-1.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap font-medium">
                            {STAGE_META[item.stage]?.short || item.stage}
                          </td>
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
                            ) : (
                              <span className="text-slate-400 italic">Unassigned</span>
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-right whitespace-nowrap">
                            {item.isDuplicate ? (
                              <span className="text-rose-600 font-bold text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20">
                                {existingSerials.has(item.serial.trim().toUpperCase())
                                  ? 'Already in inventory (Skipped)'
                                  : 'Repeated in file (Skipped)'}
                              </span>
                            ) : item.error ? (
                              <span
                                title={item.error}
                                className="text-rose-600 font-bold text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 inline-block max-w-[220px] truncate align-middle"
                              >
                                Error: {item.error}
                              </span>
                            ) : (
                              <span className="text-emerald-600 font-bold text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                                Ready to Import
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}

                      {activeStagedBatch.length === 0 && (
                        <tr>
                          <td
                            colSpan={10}
                            className="py-8 text-center text-slate-400 text-xs"
                          >
                            No entries staged yet. Upload a CSV file or enter serials above.
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
                {validItems.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold text-xs bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{validItems.length} valid serials ready for intake staging</span>
                  </span>
                ) : (
                  <span className="text-slate-400 text-xs">
                    0 valid serials ready for intake staging
                  </span>
                )}
                {(dupCount > 0 || errorCount > 0) && (
                  <span className="text-amber-600 dark:text-amber-400 text-[11px] font-medium hidden sm:inline">
                    ({dupCount} duplicates skipped{errorCount > 0 ? `, ${errorCount} rows with errors not imported` : ''})
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
                    if (validItems.length > 0) setBatchStep('PREVIEW');
                  }}
                  disabled={validItems.length === 0}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white disabled:opacity-50 transition shadow-xs cursor-pointer flex items-center gap-2"
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
                    Double-Step Safeguard: Verify Stock Intake Batch Before Database Write
                  </span>
                  <p className="text-[11px] mt-0.5 opacity-90 leading-relaxed">
                    You are about to register and write <strong>{validItems.length} new hardware items</strong> into the multi-branch inventory database from your table CSV import. Inspect the entries and branch allocation below before confirming.
                  </p>
                </div>
              </div>

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
                    Duplicates Filtered
                  </span>
                  <span className="font-bold text-xs text-slate-500 mt-0.5 block">
                    {dupCount} Skipped{errorCount > 0 ? ` · ${errorCount} with errors` : ''}
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
                  <table className="w-full text-left text-xs min-w-[850px]">
                    <thead className="glass-table-thead text-[10px] uppercase font-extrabold text-white">
                      <tr>
                        <th className="py-2.5 px-3">No.</th>
                        <th className="py-2.5 px-3">Stock-In Date</th>
                        <th className="py-2.5 px-3">Serial Number</th>
                        <th className="py-2.5 px-3">Device Type</th>
                        <th className="py-2.5 px-3">Model</th>
                        <th className="py-2.5 px-3">Battery Serial</th>
                        <th className="py-2.5 px-3">Stock Location</th>
                        <th className="py-2.5 px-3">Initial Stage</th>
                        <th className="py-2.5 px-3">Merchant / MID</th>
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
                          <td className="py-1.5 px-3 font-mono text-slate-500">
                            {item.stockInDate || '—'}
                          </td>
                          <td className="py-1.5 px-3 font-mono font-bold text-[#1e5b88] dark:text-sky-300">
                            {item.serial}
                          </td>
                          <td className="py-1.5 px-3 font-semibold">{item.type}</td>
                          <td className="py-1.5 px-3 text-slate-500">{item.model}</td>
                          <td className="py-1.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                            {item.batterySerial}
                          </td>
                          <td className="py-1.5 px-3 font-medium text-slate-600 dark:text-slate-300">
                            Code {item.branchId} ({item.branchName})
                          </td>
                          <td className="py-1.5 px-3 font-medium">
                            {STAGE_META[item.stage]?.short || item.stage}
                          </td>
                          <td className="py-1.5 px-3 text-slate-500">
                            {item.merchantName ? (
                              <span>
                                {item.merchantName} {item.mid ? `(${item.mid})` : ''}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Unassigned</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>
                  Each item will be registered with tamper-evident audit logging, branch notification, and battery lifecycle tracking.
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
                onClick={() => setBatchStep('INPUT')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 ${
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
                onClick={handleCommit}
                disabled={validItems.length === 0}
                className="px-6 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white transition shadow-md cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Confirm &amp; Commit {validItems.length} Entries to Database</span>
              </motion.button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
