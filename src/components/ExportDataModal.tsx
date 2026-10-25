import { STAGE_META } from '../data/initialData';
import React, { useMemo, useState } from 'react';
import { Device, Requisition, User, ThemeMode, UserRole } from '../types';
import { csvFile } from '../utils/csv';
import { todayPP, stampPP } from '../utils/time';
import { phoneFor } from '../utils/privacy';
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
  Lock,
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
  /** Server-provided role of the signed-in user. Only ADMIN / SUPER_ADMIN may export. Defaults to the safest role. */
  role?: UserRole;
}

/** A staff record without login details or contact numbers (for the JSON snapshot). */
const safeUser = (u: User) => ({
  uid: u.uid,
  empId: u.empId,
  name: u.name,
  accessRole: u.accessRole,
  branchId: u.branchId,
  branchName: u.branchName,
  position: u.position,
  status: u.status,
  updatedAt: u.updatedAt,
});

export const ExportDataModal: React.FC<ExportDataModalProps> = ({
  isOpen,
  onClose,
  devices,
  requisitions,
  users,
  auditLogs,
  theme = 'dark',
  onToast,
  role = 'BRANCH',
}) => {
  const isLight = theme === 'light';
  const canExport = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const counts = useMemo(() => {
    let active = 0;
    const mids = new Set<string>();
    for (const d of devices) {
      if (d.archived) continue;
      active++;
      const mid = (d.mid || '').trim();
      if (d.stage === 'COMPLETE' && mid) mids.add(mid);
    }
    return { active, archived: devices.length - active, uniqueMerchants: mids.size };
  }, [devices]);

  if (!isOpen) return null;

  const triggerDownload = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke after the click has been handled (some browsers cancel the download on an immediate revoke).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const finish = (msg: string) => {
    setTimeout(() => {
      setDownloadingId(null);
      onToast(msg);
    }, 250);
  };

  const handleExportDevicesCsv = () => {
    if (!canExport) return;
    setDownloadingId('devices-csv');
    const headers = [
      'No.',
      'Stock-In Date',
      'Serial Number',
      'Battery Serial',
      'Device Type',
      'Model',
      'Branch Code & Name',
      'Staff',
      'Lifecycle Stage',
      'Merchant Name',
      'Merchant ID (MID)',
      'Terminal ID (TID)',
      'Serial Cycles',
      'Note',
    ];
    const rows = devices.map((d, idx) => {
      const bName = d.branchName || `Branch ${d.branchId}`;
      const branchDisplay = `${d.branchId} · ${bName.replace(' Branch', '')}`;
      const staffDisplay = d.installedByStaff || d.staff || '-';
      const cycleCount = d.redeployCount || 0;
      const cycleDisplay = `${cycleCount} Cycle${cycleCount === 1 ? '' : 's'}`;
      const batteryDisplay = d.batterySerial?.trim() || (d.type === 'POS Terminal' ? 'No battery serial' : '');

      return [
        String(idx + 1),
        d.stockInDate || d.updatedAt || '',
        d.serial,
        batteryDisplay,
        d.type,
        d.model || '',
        branchDisplay,
        staffDisplay,
        STAGE_META[d.stage]?.short || d.stage,
        d.merchantName || 'Unassigned',
        d.mid || '-',
        d.tid || '-',
        cycleDisplay,
        d.note || '',
      ];
    });
    triggerDownload(`Hardware_Inventory_Registry_${todayPP()}.csv`, csvFile([headers, ...rows]));
    finish(`Exported ${devices.length} hardware serial records to CSV`);
  };

  const handleExportMerchantsCsv = () => {
    if (!canExport) return;
    setDownloadingId('merchants-csv');
    // Group active merchant profiles matching Merchants CRM table
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

    for (const d of devices) {
      if (d.archived || d.stage !== 'COMPLETE') continue;
      const mid = (d.mid || '').trim();
      if (!mid) continue;
      const existing = map.get(mid);
      if (!existing) {
        map.set(mid, {
          mid,
          merchantName: d.merchantName || '',
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
        if (!existing.merchantName && d.merchantName) existing.merchantName = d.merchantName;
        if (!existing.merchantPhone && d.merchantPhone) existing.merchantPhone = d.merchantPhone;
        if (!existing.address && d.address) existing.address = d.address;
        existing.serials.push(d.serial);
      }
    }

    const headers = [
      'No.',
      'Merchant ID (MID)',
      'Merchant Name',
      'Staff Name',
      'Branch Code & Name',
      'Device Type',
      'Serial Number',
      'Installed Date',
      'Status',
    ];
    const rows = Array.from(map.values()).map((m, idx) => {
      const branchDisplay = `${m.branchId} · ${m.branchName.replace(' Branch', '')}`;
      const deviceTypeDisplay = [
        m.posCount > 0 ? `POS Terminal${m.posCount > 1 ? ` ×${m.posCount}` : ''}` : '',
        m.sbCount > 0 ? `Sound Box${m.sbCount > 1 ? ` ×${m.sbCount}` : ''}` : '',
      ].filter(Boolean).join(', ') || '-';
      const staffDisplay = (devices.find((d) => d.mid === m.mid)?.installedByStaff) || (devices.find((d) => d.mid === m.mid)?.staff) || '-';
      const installDate = (devices.find((d) => d.mid === m.mid && Boolean(d.deployedDate))?.deployedDate) || '-';

      return [
        String(idx + 1),
        m.mid,
        m.merchantName || '-',
        staffDisplay,
        branchDisplay,
        deviceTypeDisplay,
        m.serials.join(', '),
        installDate,
        'Live',
      ];
    });
    triggerDownload(`Merchant_Deployment_CRM_${todayPP()}.csv`, csvFile([headers, ...rows]));
    finish(`Exported ${rows.length} merchant deployment profiles to CSV`);
  };

  const handleExportRequisitionsCsv = () => {
    if (!canExport) return;
    setDownloadingId('reqs-csv');
    const headers = [
      'No.',
      'Request ID',
      'Date',
      'Branch / Staff',
      'Quantity',
      'Serials',
      'Reason',
      'Status',
    ];
    const rows = requisitions.map((r, idx) => {
      const bName = (r.branchName || `Branch ${r.branchId}`).replace(' Branch', '');
      const branchStaff = `${r.branchId} · ${bName} (${r.staff || '-'})`;
      const qtyFormatted = `POS: ${r.posQty || 0}, SB: ${r.sbQty || 0} (Total: ${(r.posQty || 0) + (r.sbQty || 0)})`;
      const serials = (r.arrangedDevices || []).map((ad) => ad.serial).join(', ') || '-';
      const statusLabel = r.status === 'RECEIVED' ? 'Received' : r.status === 'DISPATCHED' ? 'Dispatched' : r.status === 'REJECTED' ? 'Rejected' : 'Pending';

      return [
        String(idx + 1),
        r.reqId,
        r.date,
        branchStaff,
        qtyFormatted,
        serials,
        r.reason || '-',
        statusLabel,
      ];
    });
    triggerDownload(`Branch_Stock_Requests_${todayPP()}.csv`, csvFile([headers, ...rows]));
    finish(`Exported ${requisitions.length} stock requisitions to CSV`);
  };

  const handleExportUsersCsv = () => {
    if (!canExport) return;
    setDownloadingId('users-csv');
    const headers = [
      'No.',
      'Employee ID',
      'Staff Name',
      'System Role',
      'Branch Code & Name',
      'Location',
      'Account Status',
    ];
    const rows = users.map((u, idx) => {
      const bName = (u.branchName || `Branch ${u.branchId}`).replace(' Branch', '');
      const branchDisplay = `${u.branchId} · ${bName}`;
      return [
        String(idx + 1),
        u.empId,
        u.name,
        u.accessRole || (u as any).role || 'Branch Staff',
        branchDisplay,
        (u as any).location || 'Phnom Penh',
        u.status || 'Active',
      ];
    });
    triggerDownload(`Staff_Access_Directory_${todayPP()}.csv`, csvFile([headers, ...rows]));
    finish(`Exported ${users.length} staff access records to CSV`);
  };

  const handleExportFullJson = () => {
    if (!canExport) return;
    setDownloadingId('full-json');
    const payload = {
      exportMetadata: {
        exportedAt: `${stampPP()} (Phnom Penh)`,
        system: 'POS and Sound Box Stock Inventory',
        totalDevices: counts.active,
        archivedDevices: counts.archived,
        uniqueMerchants: counts.uniqueMerchants,
        totalRequisitions: requisitions.length,
        totalUsers: users.length,
        note: 'Staff records exclude usernames, passwords and contact numbers.',
      },
      devices: devices.map((d) => ({ ...d, merchantPhone: d.merchantPhone ? phoneFor(role, d.merchantPhone) : '' })),
      requisitions,
      users: users.map(safeUser),
      auditLogs,
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    triggerDownload(
      `Inventory_System_Snapshot_${todayPP()}.json`,
      new Blob([jsonStr], { type: 'application/json;charset=utf-8' })
    );
    finish('System snapshot exported to JSON (no login details or staff contacts)');
  };

  const handleExportAuditLogs = () => {
    if (!canExport) return;
    setDownloadingId('audit-logs');
    const text = '\uFEFF' + auditLogs.join('\r\n');
    triggerDownload(`Activity_Audit_Log_${todayPP()}.txt`, new Blob([text], { type: 'text/plain;charset=utf-8' }));
    finish('Exported activity audit logs');
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
                {canExport
                  ? 'Download CSV spreadsheets (open in Excel) or a JSON system snapshot'
                  : 'Data export is limited to Head Office administrators'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export dialog"
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {!canExport ? (
          <div className="p-6 flex flex-col items-center text-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-500/10 text-slate-500 flex items-center justify-center">
              <Lock className="w-5 h-5" aria-hidden="true" />
            </div>
            <p className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Export is not available for branch accounts
            </p>
            <p className="text-xs text-slate-400 max-w-sm">
              Only Head Office administrators can download inventory, merchant, staff or audit data. Please contact
              Head Office if you need a report.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-1 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white cursor-pointer"
            >
              Close
            </button>
          </div>
        ) : (
        /* Content list of exportable data */
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
                  {counts.active} active units
                  {counts.archived > 0 ? ` + ${counts.archived} archived` : ''} · Lifecycle stage, branch, MID/TID,
                  archived flag
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleExportDevicesCsv}
              disabled={downloadingId === 'devices-csv'}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
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
                  {counts.uniqueMerchants} merchants (unique MIDs of installed units) · Contact phones, addresses
                  &amp; bound serials
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleExportMerchantsCsv}
              disabled={downloadingId === 'merchants-csv'}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
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
              type="button"
              onClick={handleExportRequisitionsCsv}
              disabled={downloadingId === 'reqs-csv'}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-1.5 shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
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
                  {users.length} staff accounts · Name, role, branch, position, status
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleExportUsersCsv}
              disabled={downloadingId === 'users-csv'}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{downloadingId === 'users-csv' ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </div>

          {/* 5. Complete JSON & Audit Logs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleExportFullJson}
              disabled={downloadingId === 'full-json'}
              className={`p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-semibold ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  : 'bg-[#18191e] hover:bg-[#252730] text-slate-200 border-white/10'
              }`}
            >
              <FileJson className="w-4 h-4 text-sky-400" aria-hidden="true" />
              <span>Full JSON Snapshot</span>
            </button>

            <button
              type="button"
              onClick={handleExportAuditLogs}
              disabled={downloadingId === 'audit-logs'}
              className={`p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-semibold ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  : 'bg-[#18191e] hover:bg-[#252730] text-slate-200 border-white/10'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span>Audit Log ({auditLogs.length} events)</span>
            </button>
          </div>
        </div>
        )}
      </motion.div>
    </div>
  );
};
