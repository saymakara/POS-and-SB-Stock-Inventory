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
import { motion, AnimatePresence } from 'motion/react';

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
}

interface BatchUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
  existingDevices: Device[];
  onCommitBatch: (newDevices: Partial<Device>[]) => void;
  activeBranchId: string;
  theme?: ThemeMode;
}

// Split CSV row while respecting double quotes
function splitCsvRow(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Detect delimiter (comma, semicolon, tab)
function detectDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) || []).length;
  const tabs = (headerLine.match(/\t/g) || []).length;
  const semicolons = (headerLine.match(/;/g) || []).length;
  if (tabs > commas && tabs > semicolons) return '\t';
  if (semicolons > commas && semicolons > tabs) return ';';
  return ',';
}

// Normalize column header for robust matching
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Map various string representations to LifecycleStage enum
function parseStageValue(rawStage: string, branchId: string): LifecycleStage {
  const s = rawStage.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return branchId === '100' ? 'HQ_STOCK' : 'BRANCH_RESERVE';
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
  return branchId === '100' ? 'HQ_STOCK' : 'BRANCH_RESERVE';
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

export const BatchUploadModal: React.FC<BatchUploadModalProps> = ({
  isOpen,
  onClose,
  branches,
  existingDevices,
  onCommitBatch,
  theme = 'light',
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

  // Target stock destination defaults
  const [defaultBranchId, setDefaultBranchId] = useState('100');
  const [defaultStage, setDefaultStage] = useState<LifecycleStage>('HQ_STOCK');

  // Field 1: POS Terminal state (Method B)
  const [posModel, setPosModel] = useState('Wizar POS Q2 Pro');
  const [posPasteText, setPosPasteText] = useState('');
  const [posPrefix, setPosPrefix] = useState('WP5400PQ');
  const [posStartNum, setPosStartNum] = useState(23200316);
  const [posPadding, setPosPadding] = useState(8);
  const [posQty, setPosQty] = useState(5);

  // Field 2: Sound Box state (Method B)
  const [sbModel, setSbModel] = useState('SB-Pro');
  const [sbPasteText, setSbPasteText] = useState('');
  const [sbPrefix, setSbPrefix] = useState('SB-');
  const [sbStartNum, setSbStartNum] = useState(310);
  const [sbPadding, setSbPadding] = useState(5);
  const [sbQty, setSbQty] = useState(5);

  const [generatedRangeBatch, setGeneratedRangeBatch] = useState<StagedItem[]>([]);

  // Reset step when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setBatchStep('INPUT');
    }
  }, [isOpen]);

  const isLight = theme === 'light';
  const existingSerials = useMemo(
    () => new Set(existingDevices.map((d) => d.serial.toUpperCase())),
    [existingDevices]
  );

  const buildAutoBatterySerial = (serial: string, isPos: boolean) => {
    if (isPos) {
      const match = serial.match(/\d+$/);
      const offset = match ? Math.max(0, parseInt(match[0].slice(-4), 10) - 297) : 0;
      return `160525A${String(5709 + offset).padStart(7, '0')}`;
    }
    const clean = serial.replace(/^(POS-|SB-)/i, '');
    return `SB-BAT-${clean}`;
  };

  // Master Table CSV Parser: Parses files formatted exactly as the inventory table
  const tableCsvBatch = useMemo(() => {
    if (!tableCsvText.trim()) return [];
    const lines = tableCsvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const delimiter = detectDelimiter(lines[0]);
    const firstLineTokens = splitCsvRow(lines[0], delimiter);
    const normalizedTokens = firstLineTokens.map(normalizeHeader);

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
        else if (/(serial.*sn|serial.*num|serial|sn)/.test(token) && colMap.serial === undefined) colMap.serial = idx;
        else if (/(product.*type|hardware.*type|devicetype|type)/.test(token) && colMap.type === undefined) colMap.type = idx;
        else if (/model/.test(token) && colMap.model === undefined) colMap.model = idx;
        else if (/(battery.*serial|battery.*sn|battery)/.test(token) && colMap.batterySerial === undefined) colMap.batterySerial = idx;
        else if (/(branch.*code|branch.*id)/.test(token) && colMap.branchCode === undefined) colMap.branchCode = idx;
        else if (/branch.*name/.test(token) && colMap.branchName === undefined) colMap.branchName = idx;
        else if (/branch/.test(token) && colMap.branchCode === undefined) colMap.branchCode = idx;
        else if (/(lifecycle.*stage|stage|status)/.test(token) && colMap.stage === undefined) colMap.stage = idx;
        else if (/(merchant.*name|merchant)/.test(token) && colMap.merchantName === undefined) colMap.merchantName = idx;
        else if (/(^mid$|merchant.*id)/.test(token) && colMap.mid === undefined) colMap.mid = idx;
        else if (/(^tid$|terminal.*id)/.test(token) && colMap.tid === undefined) colMap.tid = idx;
        else if (/(cycles|redeploy)/.test(token) && colMap.redeployCount === undefined) colMap.redeployCount = idx;
      });
    } else {
      // No header: detect column order based on column count and date presence
      const sample = splitCsvRow(lines[0], delimiter);
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

    const fallbackBranch: Branch = {
      id: '100',
      code: '100',
      name: 'Head Office (In-Store MS Unit)',
      staff: ['SAY Chanmakara (8986)'],
      staffDetails: [],
    };
    const defaultBranch =
      branches.find((b) => b.id === defaultBranchId || b.code === defaultBranchId) ||
      branches[0] ||
      fallbackBranch;
    const seenInBatch = new Set<string>();
    const parsed: StagedItem[] = [];
    const today = new Date().toISOString().split('T')[0];

    for (let i = dataStartIdx; i < lines.length; i++) {
      const row = splitCsvRow(lines[i], delimiter);
      if (!row || row.length === 0 || (row.length === 1 && !row[0])) continue;

      let rawSerial = (colMap.serial !== undefined ? row[colMap.serial] : row[0]) || '';
      // If colMap.serial wasn't found or pointed to a date, look for token starting with WP or SB or containing alphanumeric
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawSerial) && row.length > 1) {
        rawSerial = row[1] || '';
      }
      const serial = rawSerial.trim().toUpperCase();
      if (!serial || serial === 'SERIAL' || serial === 'SERIAL_SN' || serial === 'SERIAL NUMBER (SN)') {
        continue;
      }

      const rawType = (colMap.type !== undefined ? row[colMap.type] : '') || '';
      const itemType = parseDeviceType(rawType, serial);
      const isPos = itemType === 'POS Terminal';

      let rawModel = (colMap.model !== undefined ? row[colMap.model] : '')?.trim() || '';
      if (!rawModel) {
        rawModel = isPos ? 'Wizar POS Q2 Pro' : 'SB-Pro';
      }

      let rawBattery = (colMap.batterySerial !== undefined ? row[colMap.batterySerial] : '')?.trim() || '';
      if (!rawBattery || rawBattery.toUpperCase().startsWith('BAT-')) {
        rawBattery = buildAutoBatterySerial(serial, isPos);
      }

      const rawBranchCode = (colMap.branchCode !== undefined ? row[colMap.branchCode] : '')?.trim() || '';
      const cleanBranchCode = (rawBranchCode.match(/\d+/) || [defaultBranchId])[0] || defaultBranchId;
      const targetBranch =
        branches.find((b) => b.id === cleanBranchCode || b.code === cleanBranchCode) || defaultBranch;

      const rawBranchName = (colMap.branchName !== undefined ? row[colMap.branchName] : '')?.trim() || targetBranch.name;
      const rawStage = (colMap.stage !== undefined ? row[colMap.stage] : '')?.trim() || '';
      const stage = parseStageValue(rawStage, targetBranch.id);

      const rawDate = (colMap.stockInDate !== undefined ? row[colMap.stockInDate] : '')?.trim() || '';
      const stockInDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today;

      const merchantName = (colMap.merchantName !== undefined ? row[colMap.merchantName] : '')?.trim() || '';
      const mid = (colMap.mid !== undefined ? row[colMap.mid] : '')?.trim() || '';
      const tid = (colMap.tid !== undefined ? row[colMap.tid] : '')?.trim() || '';
      const rawCycles = colMap.redeployCount !== undefined ? parseInt(row[colMap.redeployCount], 10) : 0;
      const redeployCount = isNaN(rawCycles) ? 0 : Math.max(0, rawCycles);

      const isDuplicate = existingSerials.has(serial) || seenInBatch.has(serial);
      seenInBatch.add(serial);

      parsed.push({
        serial,
        batterySerial: rawBattery,
        model: rawModel,
        type: itemType,
        branchId: targetBranch.id,
        branchName: rawBranchName || targetBranch.name,
        staff: (targetBranch.staff && targetBranch.staff[0]) || 'Head Office Admin',
        stage: targetBranch.id === '100' && !rawStage ? 'HQ_STOCK' : stage,
        stockInDate,
        merchantName,
        mid,
        tid,
        redeployCount,
        isDuplicate,
      });
    }

    return parsed;
  }, [tableCsvText, branches, defaultBranchId, existingSerials]);

  // Method B: Parse dual fields for POS Terminal & Sound Box
  const pastedBatch = useMemo(() => {
    const fallbackBranch: Branch = {
      id: '100',
      code: '100',
      name: 'Head Office (In-Store MS Unit)',
      staff: ['SAY Chanmakara (8986)'],
      staffDetails: [],
    };
    const branchObj =
      branches.find((b) => b.id === defaultBranchId) || branches[0] || fallbackBranch;
    const stage = branchObj.id === '100' ? 'HQ_STOCK' : defaultStage;
    const seenInBatch = new Set<string>();
    const parsed: StagedItem[] = [];

    const parseLinesForType = (
      raw: string,
      fixedType: 'POS Terminal' | 'Sound Box',
      selectedModel: string
    ) => {
      if (!raw.trim()) return;
      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      lines.forEach((line) => {
        if (line.toLowerCase().startsWith('serial') || line.toLowerCase().startsWith('stock')) return;
        const parts = line
          .split(/[,\t;]+/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (parts.length === 0) return;

        // Auto-detect if line is table-formatted: [date, serial, ...]
        let serial = (parts[0] || '').toUpperCase();
        let batterySerial = '';
        let modelPart = parts[1] || '';
        let branchPart = parts[2] || '';

        if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) && parts.length > 1) {
          serial = (parts[1] || '').toUpperCase();
          modelPart = parts[3] || '';
          batterySerial = parts[4] || '';
          branchPart = parts[5] || '';
        } else if (modelPart.toUpperCase().startsWith('BAT-') || modelPart.toUpperCase().startsWith('160525A') || modelPart.toUpperCase().startsWith('SB-BAT')) {
          batterySerial = modelPart.toUpperCase();
          modelPart = parts[2] || '';
          branchPart = parts[3] || '';
        } else if (/^\d{3}$/.test(modelPart) && branches.some((b) => b.id === modelPart)) {
          // Serial, BranchCode
          branchPart = modelPart;
          modelPart = '';
        }

        if (!serial) return;

        const model = modelPart || selectedModel;
        const isPos = fixedType === 'POS Terminal';

        if (!batterySerial) {
          batterySerial = buildAutoBatterySerial(serial, isPos);
        }

        const bCode = (branchPart.match(/\d+/) || [defaultBranchId])[0] || defaultBranchId;
        const curBranch = branches.find((b) => b.id === bCode) || branchObj;
        const isDuplicate = existingSerials.has(serial) || seenInBatch.has(serial);
        seenInBatch.add(serial);

        parsed.push({
          serial,
          batterySerial,
          model,
          type: fixedType,
          branchId: curBranch.id,
          branchName: curBranch.name,
          staff: (curBranch.staff && curBranch.staff[0]) || 'Head Office Admin',
          stage: curBranch.id === '100' ? 'HQ_STOCK' : stage,
          stockInDate: new Date().toISOString().split('T')[0],
          isDuplicate,
        });
      });
    };

    parseLinesForType(posPasteText, 'POS Terminal', posModel);
    parseLinesForType(sbPasteText, 'Sound Box', sbModel);

    return parsed;
  }, [
    posPasteText,
    sbPasteText,
    posModel,
    sbModel,
    defaultBranchId,
    defaultStage,
    branches,
    existingSerials,
  ]);

  const handleGenerateDualRange = () => {
    const fallbackBranch: Branch = {
      id: '100',
      code: '100',
      name: 'Head Office (In-Store MS Unit)',
      staff: ['SAY Chanmakara (8986)'],
      staffDetails: [],
    };
    const branchObj =
      branches.find((b) => b.id === defaultBranchId) || branches[0] || fallbackBranch;
    const stage = branchObj.id === '100' ? 'HQ_STOCK' : defaultStage;
    const seenInBatch = new Set<string>();
    const generated: StagedItem[] = [];
    const today = new Date().toISOString().split('T')[0];

    const safePosQty = Math.min(200, Math.max(0, posQty));
    for (let i = 0; i < safePosQty; i++) {
      const numStr = String(posStartNum + i).padStart(posPadding, '0');
      const serial = `${posPrefix.trim().toUpperCase()}${numStr}`;
      const batterySerial = buildAutoBatterySerial(serial, true);
      const isDuplicate = existingSerials.has(serial) || seenInBatch.has(serial);
      seenInBatch.add(serial);

      generated.push({
        serial,
        batterySerial,
        model: posModel,
        type: 'POS Terminal',
        branchId: branchObj.id,
        branchName: branchObj.name,
        staff: (branchObj.staff && branchObj.staff[0]) || 'Head Office Admin',
        stage: branchObj.id === '100' ? 'HQ_STOCK' : stage,
        stockInDate: today,
        isDuplicate,
      });
    }

    const safeSbQty = Math.min(200, Math.max(0, sbQty));
    for (let i = 0; i < safeSbQty; i++) {
      const numStr = String(sbStartNum + i).padStart(sbPadding, '0');
      const serial = `${sbPrefix.trim().toUpperCase()}${numStr}`;
      const batterySerial = buildAutoBatterySerial(serial, false);
      const isDuplicate = existingSerials.has(serial) || seenInBatch.has(serial);
      seenInBatch.add(serial);

      generated.push({
        serial,
        batterySerial,
        model: sbModel,
        type: 'Sound Box',
        branchId: branchObj.id,
        branchName: branchObj.name,
        staff: (branchObj.staff && branchObj.staff[0]) || 'Head Office Admin',
        stage: branchObj.id === '100' ? 'HQ_STOCK' : stage,
        stockInDate: today,
        isDuplicate,
      });
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

  const handleDownloadTemplate = () => {
    const headers = [
      'Stock_In_Date',
      'Serial_SN',
      'Product_Type',
      'Model',
      'Battery_Serial',
      'Branch_Code',
      'Branch_Name',
      'Lifecycle_Stage',
      'Merchant_Name',
      'MID',
      'TID',
      'Serial_Cycles_Count',
    ];
    const today = new Date().toISOString().split('T')[0];
    const sampleRows = [
      [
        today,
        'WP5400PQ23200380',
        'POS Terminal',
        'Wizar POS Q2 Pro',
        '160525A0005790',
        '100',
        'Head Office (In-Store MS Unit)',
        'Admin HQ Stock',
        '',
        '',
        '',
        '0',
      ],
      [
        today,
        'WP5400PQ23200381',
        'POS Terminal',
        'Wizar POS Q2 Pro',
        '160525A0005791',
        '101',
        'Borei Keyla Branch',
        'Branch Reserve',
        '',
        '',
        '',
        '0',
      ],
      [
        today,
        'WP5400PQ23200382',
        'POS Terminal',
        'PAX A920 Pro',
        '160525A0005792',
        '105',
        'Toul Kork Branch',
        'Installed Live',
        'Brown Coffee Toul Kork',
        '100000880105001',
        '00880105',
        '1',
      ],
      [
        today,
        'SB-00380',
        'Sound Box',
        'SB-Pro',
        'SB-BAT-00380',
        '100',
        'Head Office (In-Store MS Unit)',
        'Admin HQ Stock',
        '',
        '',
        '',
        '0',
      ],
      [
        today,
        'SB-00381',
        'Sound Box',
        'SB-Pro',
        'SB-BAT-00381',
        '102',
        'Mao Tse Toung Branch',
        'Installed Live',
        'Lucky Supermarket MTT',
        '100000880102003',
        '00880102',
        '1',
      ],
    ];
    const csvContent = [headers.join(','), ...sampleRows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inventory_table_upload_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const activeStagedBatch = useMemo(() => {
    if (method === 'tableCsv') return tableCsvBatch;
    if (method === 'paste') return pastedBatch;
    return generatedRangeBatch;
  }, [method, tableCsvBatch, pastedBatch, generatedRangeBatch]);

  const validItems = activeStagedBatch.filter((i) => !i.isDuplicate);
  const dupCount = activeStagedBatch.length - validItems.length;
  const validPosCount = validItems.filter((i) => i.type === 'POS Terminal').length;
  const validSbCount = validItems.filter((i) => i.type === 'Sound Box').length;

  const handleCommit = () => {
    if (validItems.length === 0) return;
    onCommitBatch(validItems);
    setTableCsvText('');
    setUploadedFileMeta(null);
    setPosPasteText('');
    setSbPasteText('');
    setGeneratedRangeBatch([]);
    onClose();
  };

  const modalBoxClass = isLight
    ? 'bg-white/95 border-slate-200/80 text-slate-800 backdrop-blur-xl'
    : 'bg-[#11141e]/95 border-slate-800/80 text-slate-100 backdrop-blur-xl';

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
        className={`${modalBoxClass} border rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] transform-gpu will-change-gpu gpu-modal-container`}
      >
        {/* Header (Signature Navy Bar) */}
        <div className="navy-header-bar px-6 py-4 flex items-center justify-between text-white">
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
                    <select
                      value={defaultBranchId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setDefaultBranchId(nextId);
                        setDefaultStage(
                          nextId === '100' ? 'HQ_STOCK' : 'BRANCH_RESERVE'
                        );
                      }}
                      className={`w-full rounded-xl px-3 py-1.5 text-xs font-semibold border transition ${inputClass}`}
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          Branch Code {b.id} — {b.name}
                        </option>
                      ))}
                    </select>
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
                      <option value="COMPLETE">Installed Live (Merchant Assigned)</option>
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
                        className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#18191e] hover:bg-[#252730] text-white shadow-xs transition cursor-pointer flex items-center gap-1.5 border border-white/10"
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

                  {/* Editable CSV Content Area */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                        <span>CSV Raw Data Editor</span>
                        <span className="text-[10px] font-normal text-slate-400">
                          (Paste rows directly or edit uploaded content)
                        </span>
                      </label>
                      <span className="text-[11px] text-[#1e5b88] dark:text-sky-300 font-mono font-bold">
                        {tableCsvBatch.length} row{tableCsvBatch.length === 1 ? '' : 's'} parsed
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      value={tableCsvText}
                      onChange={(e) => setTableCsvText(e.target.value)}
                      placeholder={
                        'Stock_In_Date,Serial_SN,Product_Type,Model,Battery_Serial,Branch_Code,Branch_Name,Lifecycle_Stage,Merchant_Name,MID,TID,Serial_Cycles_Count\n2026-10-18,WP5400PQ23200380,POS Terminal,Wizar POS Q2 Pro,160525A0005790,100,Head Office (In-Store MS Unit),Admin HQ Stock,,,,0\n2026-10-18,SB-00380,Sound Box,SB-Pro,SB-BAT-00380,101,Borei Keyla Branch,Branch Reserve,,,,0'
                      }
                      className={`w-full rounded-xl p-2.5 text-xs font-mono placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#1e5b88] focus:border-[#1e5b88] border transition ${inputClass}`}
                    />
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
                        <option value="SB-Pro">SB-Pro</option>
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
                            value={posStartNum}
                            onChange={(e) =>
                              setPosStartNum(parseInt(e.target.value, 10) || 1)
                            }
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
                            <option value="SB-Pro">SB-Pro</option>
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
                            value={sbStartNum}
                            onChange={(e) =>
                              setSbStartNum(parseInt(e.target.value, 10) || 1)
                            }
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

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleGenerateDualRange}
                      className="px-4 py-2 rounded-xl text-xs font-extrabold bg-[#18191e] hover:bg-[#252730] border border-white/10 text-white transition shadow-xs cursor-pointer"
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
                      ({validItems.length} valid: {validPosCount} POS, {validSbCount} Sound Box)
                    </span>
                  </span>
                  {dupCount > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1 text-[11px] bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {dupCount} duplicate(s) filtered
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto max-h-48 sm:max-h-56">
                  <table className="w-full text-left text-xs min-w-[800px]">
                    <thead className="glass-table-thead text-[10px] uppercase font-extrabold text-white sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Stock-In Date</th>
                        <th className="py-2.5 px-3">Serial Number (SN)</th>
                        <th className="py-2.5 px-3">Product Type</th>
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
                                Duplicate (Skipped)
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
                {dupCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 text-[11px] font-medium hidden sm:inline">
                    ({dupCount} duplicates filtered)
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
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-[#18191e] hover:bg-[#252730] text-white disabled:opacity-50 transition shadow-xs cursor-pointer flex items-center gap-2 border border-white/10"
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
                    {dupCount} Skipped
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
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Stock-In Date</th>
                        <th className="py-2.5 px-3">Serial Number (SN)</th>
                        <th className="py-2.5 px-3">Type</th>
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

              <motion.button
                whileTap={{ scale: 0.94 }}
                type="button"
                onClick={handleCommit}
                className="px-6 py-2 rounded-xl text-xs font-bold bg-[#18191e] hover:bg-[#252730] text-white transition shadow-md cursor-pointer flex items-center gap-2 border border-white/10"
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
