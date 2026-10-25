import React, { useState, useMemo } from 'react';
import { Device, Branch, UserRole, ThemeMode, TelegramRegionalGroup } from '../types';
import { resolveTelegramChatForBranch } from '../utils/errorLogger';
import { motion, AnimatePresence } from 'motion/react';
import {
  SendHorizontal,
  Smartphone,
  Store,
  Building2,
  Users,
  Search,
  Filter,
  CheckCircle2,
  RotateCcw,
  Boxes,
  Clock,
  Sparkles,
  ChevronRight,
  SlidersHorizontal,
  Send,
} from 'lucide-react';

interface PushConfiguringTabProps {
  devices: Device[];
  branches: Branch[];
  role?: UserRole;
  operatorLabel?: string;
  onNotifyConfigReady?: (serialOrSerials: string | string[]) => void;
  onSelectDevice?: (serial: string) => void;
  onCompleteDeployment?: (serial: string) => void;
  onReturnToReserve?: (serial: string, branchId: string, reason?: string) => void;
  regionalGroups?: TelegramRegionalGroup[];
  theme?: ThemeMode;
}

export const PushConfiguringTab: React.FC<PushConfiguringTabProps> = React.memo(({
  devices,
  branches,
  role = 'SUPER_ADMIN',
  operatorLabel = 'System Admin',
  onNotifyConfigReady,
  onSelectDevice,
  onCompleteDeployment,
  onReturnToReserve,
  regionalGroups,
  theme = 'light',
}) => {
  const isLight = theme === 'light';
  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';

  // 1. Filter only devices in CONFIGURING stage
  const configuringDevices = useMemo(() => {
    return devices.filter((d) => d.stage === 'CONFIGURING');
  }, [devices]);

  // 2. Local filter states
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [selectedSns, setSelectedSns] = useState<string[]>([]);

  // 3. Filtered devices in view
  const filteredDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return configuringDevices.filter((d) => {
      if (branchFilter !== 'ALL' && d.branchId !== branchFilter) return false;
      if (typeFilter !== 'ALL' && d.type !== typeFilter) return false;
      if (!q) return true;
      return (
        d.serial.toLowerCase().includes(q) ||
        (d.merchantName || '').toLowerCase().includes(q) ||
        (d.mid || '').toLowerCase().includes(q) ||
        (d.tid || '').toLowerCase().includes(q) ||
        (d.staff || '').toLowerCase().includes(q) ||
        (d.installedByStaff || '').toLowerCase().includes(q) ||
        (d.branchName || '').toLowerCase().includes(q) ||
        d.branchId.toLowerCase().includes(q)
      );
    });
  }, [configuringDevices, search, branchFilter, typeFilter]);

  // 4. Grouped by Assigned Staff / Team
  const teamGroups = useMemo(() => {
    const map = new Map<string, { staff: string; branchId: string; branchName: string; devices: Device[] }>();
    for (const d of configuringDevices) {
      const staffName = d.staff || d.installedByStaff || 'Unassigned Staff';
      const bObj = branches.find((b) => b.code === d.branchId);
      const bName = bObj ? bObj.name : (d.branchName || `Branch ${d.branchId}`);
      const key = `${staffName}__${d.branchId}`;
      if (!map.has(key)) {
        map.set(key, { staff: staffName, branchId: d.branchId, branchName: bName, devices: [] });
      }
      map.get(key)!.devices.push(d);
    }
    return Array.from(map.values()).sort((a, b) => b.devices.length - a.devices.length);
  }, [configuringDevices, branches]);

  // 5. Counts
  const posCount = useMemo(() => configuringDevices.filter((d) => d.type === 'POS Terminal').length, [configuringDevices]);
  const sbCount = useMemo(() => configuringDevices.filter((d) => d.type === 'Sound Box').length, [configuringDevices]);

  // Checkbox helpers
  const handleToggleSelectAll = () => {
    if (selectedSns.length === filteredDevices.length && filteredDevices.length > 0) {
      setSelectedSns([]);
    } else {
      setSelectedSns(filteredDevices.map((d) => d.serial));
    }
  };

  const handleToggleSelectOne = (sn: string) => {
    setSelectedSns((prev) =>
      prev.includes(sn) ? prev.filter((x) => x !== sn) : [...prev, sn]
    );
  };

  return (
    <div className="space-y-6 pb-24">
      {/* 1. HERO HEADER WITH LIVE PIPELINE STATS */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 bg-linear-to-br from-[#00283f] via-[#003857] to-[#004e75] text-white shadow-xl border border-white/10">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Dedicated App Push Pipeline</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <SendHorizontal className="w-8 h-8 text-emerald-400 shrink-0" />
              <span>Push Configuring Hub</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-200/90 leading-relaxed">
              Live deployment queue for merchant hardware setup. Alert field technicians and branch officers to power ON devices, connect to network, and wait for pushing the merchant application.
            </p>
          </div>

          {/* Quick Action Button for Entire Queue */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {isAdminLike && onNotifyConfigReady && (
              <button
                type="button"
                disabled={configuringDevices.length === 0}
                onClick={() => {
                  onNotifyConfigReady(configuringDevices.map((d) => d.serial));
                  setSelectedSns([]);
                }}
                className="px-5 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm tracking-wide shadow-lg hover:shadow-emerald-500/25 transition-all cursor-pointer flex items-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5"
              >
                <Send className="w-4 h-4 text-slate-950 fill-current" />
                <span>Notify All Ready ({configuringDevices.length} Units)</span>
              </button>
            )}
          </div>
        </div>

        {/* KPI Mini-Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/10">
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xs">
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Total Waiting Push</div>
            <div className="text-2xl font-black text-white mt-1">{configuringDevices.length}</div>
            <div className="text-[10px] text-emerald-300 font-medium mt-0.5">High-volume daily queue</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xs">
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              POS Terminals
            </div>
            <div className="text-2xl font-black text-white mt-1">{posCount}</div>
            <div className="text-[10px] text-slate-300 font-medium mt-0.5">Under Configuring</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xs">
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              Sound Boxes
            </div>
            <div className="text-2xl font-black text-white mt-1">{sbCount}</div>
            <div className="text-[10px] text-slate-300 font-medium mt-0.5">Under Configuring</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xs">
            <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-sky-300" />
              Active Teams
            </div>
            <div className="text-2xl font-black text-white mt-1">{teamGroups.length}</div>
            <div className="text-[10px] text-sky-200 font-medium mt-0.5">Assigned branch teams</div>
          </div>
        </div>
      </div>

      {/* 2. ASSIGNED TEAMS QUICK-ACTION CARDS (GROUPED BY CONFIGURE BY) */}
      {teamGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#003857]" />
              <span>Assigned Teams &amp; Branches ({teamGroups.length})</span>
            </h2>
            <span className="text-[11px] text-slate-500">Click &ldquo;Notify Team&rdquo; to alert only that group</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {teamGroups.map((tg) => {
              const teamSerials = tg.devices.map((d) => d.serial);
              const teamChat = resolveTelegramChatForBranch(tg.branchId, regionalGroups, branches);
              return (
                <div
                  key={`${tg.staff}__${tg.branchId}`}
                  className="p-4 rounded-2xl border bg-white border-slate-200 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between gap-3 text-zinc-900"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-black text-[#003857] truncate" title={tg.staff}>
                          {tg.staff}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>Code {tg.branchId} ({tg.branchName})</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                        {tg.devices.length} Units
                      </span>
                    </div>

                    {/* Regional Telegram Group Routing Info */}
                    <div className="flex items-center gap-1.5 text-[10.5px] text-sky-800 bg-sky-50 px-2 py-1 rounded-lg border border-sky-200 mt-2 font-mono">
                      <Send className="w-3 h-3 text-sky-600 shrink-0" />
                      <span className="truncate">
                        Alert: <strong>{teamChat.groupName}</strong> ({teamChat.chatId})
                      </span>
                    </div>

                    <div className="mt-2 text-[10.5px] text-slate-500 font-mono truncate">
                      Sample: {tg.devices.slice(0, 2).map((x) => x.serial).join(', ')}
                      {tg.devices.length > 2 && ` (+${tg.devices.length - 2} more)`}
                    </div>
                  </div>

                  {isAdminLike && onNotifyConfigReady && (
                    <button
                      type="button"
                      onClick={() => onNotifyConfigReady(teamSerials)}
                      className="w-full py-1.5 px-3 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white transition cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                    >
                      <Send className="w-3 h-3" />
                      <span>Notify Team &amp; Group ({tg.devices.length})</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. FILTER & SEARCH TOOLBAR */}
      <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search serial, merchant, MID, TID, staff..."
              className="w-full pl-9 pr-3 py-2 rounded-xl text-xs border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#003857] outline-none text-zinc-900 transition"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 text-zinc-800 outline-none cursor-pointer"
            >
              <option value="ALL">All Device Types</option>
              <option value="POS Terminal">POS Terminal</option>
              <option value="Sound Box">Sound Box</option>
            </select>

            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 text-zinc-800 outline-none cursor-pointer"
            >
              <option value="ALL">All Branches</option>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  Code {b.code} ({b.name})
                </option>
              ))}
            </select>

            {(search || typeFilter !== 'ALL' || branchFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setTypeFilter('ALL');
                  setBranchFilter('ALL');
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 cursor-pointer transition"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4. HARDWARE QUEUE TABLE */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-slate-700">
              Hardware Queue Ready for App Push
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
              {filteredDevices.length}
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            Assigned By: <strong className="text-zinc-900">{operatorLabel}</strong>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={selectedSns.length === filteredDevices.length && filteredDevices.length > 0}
                    onChange={handleToggleSelectAll}
                    aria-label="Select all hardware in queue"
                    className="rounded border-slate-300 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Hardware Serial &amp; Model</th>
                <th className="py-3 px-4">Merchant Name &amp; MID / TID</th>
                <th className="py-3 px-4">Configure By (Staff)</th>
                <th className="py-3 px-4">Branch</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <Boxes className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <div className="text-sm font-bold text-slate-600">No devices in Push Configuring queue</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {search || typeFilter !== 'ALL' || branchFilter !== 'ALL'
                        ? 'Try clearing the search filters above.'
                        : 'When an admin configures a merchant profile on a device, it will appear here.'}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredDevices.map((dev) => {
                  const isSelected = selectedSns.includes(dev.serial);
                  const isPos = dev.type === 'POS Terminal';
                  const bObj = branches.find((b) => b.code === dev.branchId);
                  const bName = bObj ? bObj.name : (dev.branchName || `Branch ${dev.branchId}`);
                  const staffName = dev.staff || dev.installedByStaff || 'Assigned Branch Staff';

                  return (
                    <tr
                      key={dev.serial}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        isSelected ? 'bg-sky-50/50' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectOne(dev.serial)}
                          aria-label={`Select ${dev.serial}`}
                          className="rounded border-slate-300 cursor-pointer"
                        />
                      </td>

                      {/* Serial & Model */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isPos ? 'bg-blue-500' : 'bg-purple-500'
                            }`}
                            title={dev.type}
                          />
                          <span className="font-mono font-bold text-zinc-900">{dev.serial}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 pl-4">
                          {dev.type} {dev.model ? `· ${dev.model}` : ''}
                        </div>
                      </td>

                      {/* Merchant & MID / TID */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-zinc-900 truncate max-w-[200px]" title={dev.merchantName}>
                          {dev.merchantName || 'Merchant Profile Pending'}
                        </div>
                        <div className="text-[10.5px] font-mono text-slate-500 mt-0.5">
                          MID: {dev.mid || '—'} {dev.tid ? `| TID: ${dev.tid}` : ''}
                        </div>
                      </td>

                      {/* Configure By (Staff) */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-zinc-800">{staffName}</div>
                        <div className="text-[10px] text-slate-400">Assigned By: {operatorLabel}</div>
                      </td>

                      {/* Branch */}
                      <td className="py-3 px-4">
                        <div className="text-zinc-800 font-medium">Code {dev.branchId}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[140px]">{bName}</div>
                        <div className="text-[10px] text-sky-700 font-semibold flex items-center gap-1 mt-0.5">
                          <Send className="w-2.5 h-2.5 text-sky-600 shrink-0" />
                          <span className="truncate max-w-[140px]">{resolveTelegramChatForBranch(dev.branchId, regionalGroups, branches).groupName}</span>
                        </div>
                      </td>

                      {/* Row Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {isAdminLike && onNotifyConfigReady && (
                            <button
                              type="button"
                              onClick={() => onNotifyConfigReady(dev.serial)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-2xs transition cursor-pointer flex items-center gap-1"
                              title="Notify handling staff and alert Telegram group to open device"
                            >
                              <Send className="w-3 h-3" />
                              <span>Notify &amp; Push</span>
                            </button>
                          )}

                          {onSelectDevice && (
                            <button
                              type="button"
                              onClick={() => onSelectDevice(dev.serial)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-[11px] transition cursor-pointer"
                              title="Manage hardware profile or complete deployment"
                            >
                              Manage
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. FLOATING BATCH ACTION BAR WHEN ITEMS ARE CHECKED */}
      <AnimatePresence>
        {selectedSns.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3.5 rounded-2xl bg-[#18191e] text-white shadow-2xl border border-zinc-700/80 flex flex-wrap items-center gap-4 max-w-xl w-[90vw]"
          >
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-xl bg-white text-zinc-900 font-mono text-xs font-black shadow-2xs">
                {selectedSns.length}
              </span>
              <span className="text-xs font-bold text-white">Units Selected</span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {isAdminLike && onNotifyConfigReady && (
                <button
                  type="button"
                  onClick={() => {
                    onNotifyConfigReady(selectedSns);
                    setSelectedSns([]);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs transition cursor-pointer flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Notify &amp; Push App ({selectedSns.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedSns([])}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-300 transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
