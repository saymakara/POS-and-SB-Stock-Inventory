import React, { useState } from 'react';
import { Device, Requisition, User, ThemeMode } from '../types';
import { escapeCsvCell } from '../utils/crmUtils';
import { motion } from 'motion/react';
import {
  Download,
  X,
  FileSpreadsheet,
  FileJson,
  Boxes,
  ScrollText,
  Users,
  ShieldCheck,
  Store,
} from 'lucide-react';

interface ExportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: Device[];
  requisitions: Requisition[];
  users: User[];
  auditLogs: string[];
  theme?: ThemeMode;
  onToast: (msg: string, type?: 'success' | 'warn' | 'info') => void;
}

export const ExportDataModal: React.FC<ExportDataModalProps> = ({
  isOpen,
  onClose,
  devices,
  requisitions,
  users,
  auditLogs,
  theme = 'dark',
  onToast,
}) => {
  const isLight = theme === 'light';
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const triggerDownload = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportDevicesCsv = () => {
    setDownloadingId('devices-csv');
    const headers = [
      'Serial No',
      'Device Category',
      'Model',
      'Stock-In Date',
      'Lifecycle Stage',
      'Branch Code',
      'Branch Name',
      'Responsible Officer',
      'Installed By Officer',
      'Replaced By Officer',
      'Returned By Officer',
      'Merchant Business Name',
      'Merchant ID (MID)',
      'Terminal ID (TID)',
      'Merchant Phone',
      'Address',
      'Deployed Date',
      'Returned Date',
      'Return Reason',
      'Redeploy Count',
    ];
    const rows = devices.map((d) => [
      escapeCsvCell(d.serial),
      escapeCsvCell(d.type),
      escapeCsvCell(d.model),
      escapeCsvCell(d.stockInDate),
      escapeCsvCell(d.stage),
      escapeCsvCell(d.branchId),
      escapeCsvCell(d.branchName),
      escapeCsvCell(d.staff),
      escapeCsvCell(d.installedByStaff || d.staff || ''),
      escapeCsvCell(d.replacedByStaff || ''),
      escapeCsvCell(d.returnedByStaff || ''),
      escapeCsvCell(d.merchantName || ''),
      escapeCsvCell(d.mid || ''),
      escapeCsvCell(d.tid || ''),
      escapeCsvCell(d.merchantPhone || ''),
      escapeCsvCell(d.address || ''),
      escapeCsvCell(d.deployedDate || ''),
      escapeCsvCell(d.returnedDate || ''),
      escapeCsvCell(d.returnReason || ''),
      d.redeployCount || 0,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    triggerDownload(`Hardware_Inventory_Registry_${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
    setTimeout(() => {
      setDownloadingId(null);
      onToast(`Exported ${devices.length} hardware serial records to CSV`);
    }, 250);
  };

  const handleExportMerchantsCsv = () => {
    setDownloadingId('merchants-csv');
    const map = new Map<
      string,
      {
        mid: string;
        merchantName: string;
        merchantPhone: string;
        address: string;
        branchId: string;
        branchName: string;
        posCount: number;
        sbCount: number;
        serials: string[];
      }
    >();

    devices.forEach((d) => {
      if (!d.mid && !d.merchantName) return;
      const key = (d.mid || d.merchantName || '').trim();
      if (!key) return;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          mid: d.mid || 'PENDING-MID',
          merchantName: d.merchantName || 'Assigned Merchant',
          merchantPhone: d.merchantPhone || '',
          address: d.address || '',
          branchId: d.branchId,
          branchName: d.branchName,
          posCount: d.type === 'POS Terminal' ? 1 : 0,
          sbCount: d.type === 'Sound Box' ? 1 : 0,
          serials: [d.serial],
        });
      } else {
        if (d.type === 'POS Terminal') existing.posCount += 1;
        if (d.type === 'Sound Box') existing.sbCount += 1;
        existing.serials.push(d.serial);
      }
    });

    const headers = [
      'Merchant ID (MID)',
      'Merchant Name',
      'Contact Phone',
      'Branch Code',
      'Branch Name',
      'Store Address',
      'POS Units',
      'Sound Box Units',
      'Assigned Serials',
    ];
    const rows = Array.from(map.values()).map((m) => [
      escapeCsvCell(m.mid),
      escapeCsvCell(m.merchantName),
      escapeCsvCell(m.merchantPhone),
      escapeCsvCell(m.branchId),
      escapeCsvCell(m.branchName),
      escapeCsvCell(m.address),
      m.posCount,
      m.sbCount,
      escapeCsvCell(m.serials.join('; ')),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    triggerDownload(`Merchant_Deployment_CRM_${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
    setTimeout(() => {
      setDownloadingId(null);
      onToast(`Exported ${rows.length} merchant deployment profiles to CSV`);
    }, 250);
  };

  const handleExportRequisitionsCsv = () => {
    setDownloadingId('reqs-csv');
    const headers = [
      'Request ID',
      'Date Time',
      'Branch Code',
      'Branch Name',
      'Officer Name',
      'POS Terminal Qty',
      'Sound Box Qty',
      'Reason & Notes',
      'Request Status',
    ];
    const rows = requisitions.map((r) => [
      escapeCsvCell(r.reqId),
      escapeCsvCell(r.date),
      escapeCsvCell(r.branchId),
      escapeCsvCell(r.branchName),
      escapeCsvCell(r.staff),
      r.posQty,
      r.sbQty,
      escapeCsvCell(r.reason),
      escapeCsvCell(r.status),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    triggerDownload(`Branch_Stock_Requests_${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
    setTimeout(() => {
      setDownloadingId(null);
      onToast(`Exported ${requisitions.length} stock requisitions to CSV`);
    }, 250);
  };

  const handleExportUsersCsv = () => {
    setDownloadingId('users-csv');
    const headers = [
      'Employee ID',
      'Full Name',
      'Access Role',
      'Branch Code',
      'Branch Name',
      'Position',
      'Phone Contact',
      'Account Status',
    ];
    const rows = users.map((u) => [
      escapeCsvCell(u.empId),
      escapeCsvCell(u.name),
      escapeCsvCell(u.accessRole),
      escapeCsvCell(u.branchId),
      escapeCsvCell(u.branchName),
      escapeCsvCell(u.position),
      escapeCsvCell(u.contact || ''),
      escapeCsvCell(u.status),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    triggerDownload(`Staff_Access_Directory_${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
    setTimeout(() => {
      setDownloadingId(null);
      onToast(`Exported ${users.length} staff access records to CSV`);
    }, 250);
  };

  const handleExportFullJson = () => {
    setDownloadingId('full-json');
    const payload = {
      exportMetadata: {
        exportedAt: new Date().toISOString(),
        system: 'POS and Sound Box Stock Inventory',
        totalDevices: devices.length,
        totalRequisitions: requisitions.length,
        totalUsers: users.length,
      },
      devices,
      requisitions,
      users,
      auditLogs,
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    triggerDownload(`Inventory_System_Snapshot_${Date.now()}.json`, jsonStr, 'application/json');
    setTimeout(() => {
      setDownloadingId(null);
      onToast('Complete system snapshot exported to JSON');
    }, 250);
  };

  const handleExportAuditLogs = () => {
    setDownloadingId('audit-logs');
    const text = auditLogs.join('\r\n');
    triggerDownload(`Activity_Audit_Log_${Date.now()}.txt`, text, 'text/plain;charset=utf-8;');
    setTimeout(() => {
      setDownloadingId(null);
      onToast('Exported activity audit logs');
    }, 250);
  };

  const itemClass = `p-3.5 rounded-lg border flex items-center justify-between gap-4 ${
    isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#001d2e] border-[#003857]'
  }`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350, mass: 0.75 }}
        className={`w-full max-w-xl rounded-xl overflow-hidden shadow-2xl border-0 transform-gpu will-change-gpu gpu-modal-container ${
          isLight
            ? 'bg-white text-zinc-900'
            : 'bg-[#18191e] text-slate-100'
        }`}
      >
        {/* Header */}
        <div className="navy-header-bar rounded-t-xl px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/10 text-[#7cc4ed] border border-white/15 flex items-center justify-center">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Export Reports &amp; Data
              </h3>
              <p className="text-xs text-slate-300">
                Download escaped CSV spreadsheets or JSON system snapshots
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list of exportable data */}
        <div className="p-5 flex flex-col gap-2.5 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {/* 1. Master Inventory CSV */}
          <div className={itemClass}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-900/10 text-zinc-900 dark:text-zinc-100 flex items-center justify-center shrink-0">
                <Boxes className="w-4 h-4" />
              </div>
              <div>
                <h4 className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Hardware Serial Registry (CSV)
                </h4>
                <p className="text-[11px] text-slate-400 tabular-nums">
                  {devices.length} serial units · Lifecycle stage, branch, and MID/TID
                </p>
              </div>
            </div>
            <button
              onClick={handleExportDevicesCsv}
              disabled={downloadingId === 'devices-csv'}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-[#18191e] hover:bg-[#252730] border border-white/10 text-white flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{downloadingId === 'devices-csv' ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </div>

          {/* 2. Merchant Deployment CRM Profiles CSV */}
          <div className={itemClass}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-800 dark:bg-white/10 dark:text-slate-200 flex items-center justify-center shrink-0">
                <Store className="w-4 h-4" />
              </div>
              <div>
                <h4 className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Merchant Deployment CRM Profiles (CSV)
                </h4>
                <p className="text-[11px] text-slate-400">
                  Aggregated merchant MIDs, contact phones, addresses &amp; bound serials
                </p>
              </div>
            </div>
            <button
              onClick={handleExportMerchantsCsv}
              disabled={downloadingId === 'merchants-csv'}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-[#18191e] hover:bg-[#252730] border border-white/10 text-white flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{downloadingId === 'merchants-csv' ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </div>

          {/* 3. Stock Requisitions CSV */}
          <div className={itemClass}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
                <ScrollText className="w-4 h-4" />
              </div>
              <div>
                <h4 className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Branch Stock Requests (CSV)
                </h4>
                <p className="text-[11px] text-slate-400 tabular-nums">
                  {requisitions.length} stock transfer orders across branches
                </p>
              </div>
            </div>
            <button
              onClick={handleExportRequisitionsCsv}
              disabled={downloadingId === 'reqs-csv'}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-1.5 shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{downloadingId === 'reqs-csv' ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </div>

          {/* 4. IAM Staff Directory CSV */}
          <div className={itemClass}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h4 className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  Staff Access Directory (CSV)
                </h4>
                <p className="text-[11px] text-slate-400 tabular-nums">
                  {users.length} authorized staff accounts · HO 100 &amp; 32 branches
                </p>
              </div>
            </div>
            <button
              onClick={handleExportUsersCsv}
              disabled={downloadingId === 'users-csv'}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{downloadingId === 'users-csv' ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </div>

          {/* 5. Complete JSON & Audit Logs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              onClick={handleExportFullJson}
              disabled={downloadingId === 'full-json'}
              className={`p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-semibold ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  : 'bg-[#18191e] hover:bg-[#252730] text-slate-200 border-white/10'
              }`}
            >
              <FileJson className="w-4 h-4 text-sky-400" />
              <span>Full JSON Snapshot</span>
            </button>

            <button
              onClick={handleExportAuditLogs}
              disabled={downloadingId === 'audit-logs'}
              className={`p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-semibold ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  : 'bg-[#18191e] hover:bg-[#252730] text-slate-200 border-white/10'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Audit Log ({auditLogs.length} events)</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
