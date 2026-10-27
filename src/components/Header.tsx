import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  UserRole,
  Branch,
  User,
  ThemeMode,
  SystemNotification,
  AppSettings,
  Device,
} from '../types';
import { AppBrandLogo } from './AppBrandLogo';
import { OnlineOperatorPresence } from '../services/supabaseService';
import { STAGE_META } from '../data/initialData';
import { motion, AnimatePresence } from 'motion/react';
import {
  Building2,
  SendHorizontal,
  LayoutDashboard,
  Boxes,
  ScrollText,
  UserCog,
  Download,
  Lock,
  Store,
  Smartphone,
  ChevronLeft,
  ChevronRight,
  Menu,
  UserCircle2,
  History,
  Bell,
  LogOut,
  CheckCheck,
  RotateCcw,
  Settings,
  X,
  ArrowRight,
  Inbox,
  Search,
  Cpu,
  Volume2,
} from 'lucide-react';

interface SidebarProps {
  role?: UserRole;
  activeTab: string;
  onSelectTab: (tab: string, subTab?: string) => void;
  totalDevices: number;
  totalMerchants: number;
  totalHistoricalMerchants?: number;
  webhookCount: number;
  pendingReqs: number;
  totalBranches?: number;
  totalUsers: number;
  configuringCount?: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  theme?: ThemeMode;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  appSettings?: AppSettings;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  role = 'SUPER_ADMIN',
  activeTab,
  onSelectTab,
  totalDevices,
  totalMerchants,
  totalHistoricalMerchants,
  webhookCount,
  pendingReqs,
  totalBranches,
  totalUsers,
  configuringCount = 0,
  collapsed,
  onToggleCollapse,
  mobileOpen = false,
  onCloseMobile,
  appSettings,
}) => {
  const navGroups: Array<{
    heading: string;
    items: Array<{
      id: string;
      label: string;
      icon: React.ElementType;
      count?: number;
      highlight?: boolean;
    }>;
  }> = [
    {
      heading: 'OVERVIEW',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          icon: LayoutDashboard,
        },
        {
          id: 'merchants',
          label: 'Merchant Deployment',
          icon: Store,
        },
        {
          id: 'merchant_history',
          label: 'Merchant History',
          icon: RotateCcw,
        },
        {
          id: 'mobile_sync',
          label: 'Phone App Review',
          icon: Smartphone,
          count: webhookCount > 0 ? webhookCount : undefined,
          highlight: webhookCount > 0,
        },
      ],
    },
    {
      heading: 'OPERATIONS & GOVERNANCE',
      items: [
        {
          id: 'inventory',
          label: 'Stock Inventory',
          icon: Boxes,
        },
        {
          id: 'push_configuring',
          label: 'Push Configuring',
          icon: SendHorizontal,
          count: configuringCount > 0 ? configuringCount : undefined,
          highlight: configuringCount > 0,
        },
        {
          id: 'requisitions',
          label: 'Stock Requests',
          icon: ScrollText,
          count: pendingReqs,
        },
        {
          id: 'branches',
          label: 'Branch Codes',
          icon: Building2,
        },
        {
          id: 'users',
          label: 'Staff Directory',
          icon: UserCog,
        },
        {
          id: 'audit_log',
          label: 'Audit Trail',
          icon: History,
        },
        ...(role === 'SUPER_ADMIN'
          ? [
              {
                id: 'settings',
                label: 'Settings',
                icon: Settings,
              },
            ]
          : []),
      ],
    },
  ];

  const renderNavContent = (isMobileView: boolean) => (
    <>
      <div className="relative z-10">
        {/* Top Brand Anchor */}
        <div
          className={`w-full h-[4.5rem] px-4 flex items-center ${
            !isMobileView && collapsed ? 'justify-center' : 'justify-between'
          } gap-3 text-white border-b border-white/12 bg-white/[0.02]`}
        >
          <motion.button
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            type="button"
            onClick={() => {
              if (role === 'SUPER_ADMIN') {
                onSelectTab('settings', 'brand_logo');
              } else {
                onSelectTab('dashboard');
              }
              if (isMobileView) onCloseMobile?.();
            }}
            className="flex items-center gap-3 cursor-pointer text-left min-w-0"
            title={role === 'SUPER_ADMIN' ? 'Brand & Logo Studio (Settings)' : 'Dashboard'}
          >
            <AppBrandLogo
              logoUrl={appSettings?.customLogoUrl}
              presetId={appSettings?.logoPresetId}
              size="md"
              showGlow
            />

            {(isMobileView || !collapsed) && (
              <div className="leading-tight truncate flex-1">
                <div className="text-[13px] font-bold tracking-tight text-white truncate">
                  {appSettings?.customLogoTitle || 'POS & Sound Box Stock'}
                </div>
                <div className="text-[10.5px] font-normal text-zinc-400 tracking-tight mt-0.5 truncate">
                  {appSettings?.customLogoSubtitle || 'Branch Operations Portal'}
                </div>
              </div>
            )}
          </motion.button>

          {isMobileView && (
            <motion.button
              whileTap={{ scale: 0.92 }}
              type="button"
              onClick={onCloseMobile}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
              title="Close Navigation"
            >
              <X className="w-5 h-5" />
            </motion.button>
          )}

          {/* Mobile Phone Brand Logo (Always visible on mobile/phone screens) */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={() => onSelectTab('dashboard')}
            className="md:hidden flex items-center shrink-0 cursor-pointer p-0.5 rounded-xl hover:opacity-90 active:scale-95 transition"
            title="Dashboard"
          >
            <AppBrandLogo
              logoUrl={appSettings?.customLogoUrl}
              presetId={appSettings?.logoPresetId}
              size="sm"
              showGlow
            />
          </motion.button>
        </div>

        {/* Modern High-Performance Grouped Navigation */}
          <nav className="py-4 px-3 flex flex-col gap-4">
          {navGroups.map((group) => (
            <div key={group.heading} className="flex flex-col gap-1">
              {(isMobileView || !collapsed) && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  {group.heading}
                </div>
              )}
              <div className="flex flex-col gap-1 relative">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectTab(item.id);
                        if (isMobileView) onCloseMobile?.();
                      }}
                      title={!isMobileView && collapsed ? item.label : undefined}
                      className={`group relative w-full ${
                        !isMobileView && collapsed
                          ? 'px-0 justify-center py-2'
                          : 'px-3 justify-between py-2'
                      } rounded-xl flex items-center gap-3 text-left text-[13px] cursor-pointer transition-all duration-150 ease-out z-10 ${
                        isActive
                          ? 'font-medium text-white bg-white/12 border border-white/15 shadow-xs'
                          : 'font-normal text-zinc-300 hover:text-white hover:bg-white/[0.06] hover:border-white/10 border border-transparent'
                      }`}
                    >
                      {/* Left vertical white indicator line */}
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-white/90 shadow-2xs pointer-events-none"
                        />
                      )}

                      <div className="relative flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-150 ${
                            isActive
                              ? 'bg-white/20 text-white shadow-xs border border-white/20'
                              : 'bg-white/[0.05] text-zinc-400 group-hover:text-zinc-100 group-hover:bg-white/[0.08] group-hover:border-white/10 border border-transparent'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        {(isMobileView || !collapsed) && (
                          <span className={`truncate ${isActive ? 'text-white font-medium' : ''}`}>
                            {item.label}
                          </span>
                        )}
                      </div>

                      {/* Subtle Counter Badge (hidden when count is 0 or completely synced) */}
                      {(isMobileView || !collapsed) && item.count !== undefined && item.count > 0 && (
                        <span
                          className={`font-figure text-[10px] px-2 py-0.5 rounded-full tabular-nums shrink-0 transition-all duration-150 ${
                            isActive
                              ? 'bg-white text-zinc-900 font-bold shadow-2xs'
                              : item.highlight
                              ? 'bg-white/15 text-white border border-white/20 font-medium'
                              : 'bg-white/[0.06] text-zinc-300 border border-white/[0.06] group-hover:border-white/15 group-hover:text-white'
                          }`}
                        >
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          </nav>

      </div>

      {/* Bottom Collapse Control (Desktop Only) with Tactile Apple Spring Feedback */}
      {!isMobileView && (
        <div className="relative z-10 p-3 border-t border-white/10 bg-black/10">
          <motion.button
            whileTap={{ scale: 0.94 }}
            whileHover={{ scale: 1.01 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            className="w-full py-2.5 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] active:bg-white/[0.18] text-zinc-300 hover:text-white flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer border border-white/10 transition-colors shadow-xs backdrop-blur-md"
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 text-white" />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 text-white" />
                <span>Collapse Sidebar</span>
              </>
            )}
          </motion.button>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Desktop Sticky Sidebar (>= md) */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 76 : 244 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.55 }}
        style={{ contain: 'layout style', willChange: 'width' }}
        className="sb-sidebar-gradient sticky top-0 left-0 h-screen z-40 text-white shrink-0 hidden md:flex flex-col justify-between select-none overflow-y-auto overflow-x-hidden no-scrollbar relative transform-gpu"
      >
        {renderNavContent(false)}
      </motion.aside>

      {/* Mobile Slide-over Drawer (< md) */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ ease: [0.32, 0.72, 0, 1], duration: 0.26 }}
              onClick={onCloseMobile}
              className="fixed inset-0 bg-black/65 backdrop-blur-xs will-change-gpu"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
              className="sb-sidebar-gradient relative w-72 max-w-[85vw] h-full text-white flex flex-col justify-between select-none overflow-y-auto no-scrollbar z-10 shadow-2xl transform-gpu will-change-transform"
            >
              {renderNavContent(true)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
});

interface HeaderProps {
  appSettings?: AppSettings;
  role: UserRole;
  onSetRole?: (role: UserRole) => void;
  branches: Branch[];
  adminUsers: User[];
  activeAdminStaff: string;
  onChangeAdminStaff: (staff: string) => void;
  activeBranchId: string;
  onChangeBranchId: (id: string) => void;
  activeStaff: string;
  onChangeStaff: (staff: string) => void;
  onOpenBatchModal: () => void;
  onOpenRequestModal: () => void;
  onOpenExportModal: () => void;
  onLockSession: () => void;
  onSignOut: () => void;
  activeTab: string;
  onSelectTab: (tab: string, subTab?: string) => void;
  totalDevices: number;
  totalMerchants: number;
  totalHistoricalMerchants?: number;
  webhookCount: number;
  sseConnected: boolean;
  pendingReqs: number;
  totalUsers: number;
  notifications: SystemNotification[];
  onMarkAllNotificationsRead: () => void;
  onSelectNotification: (notif: SystemNotification) => void;
  theme?: ThemeMode;
  onToggleSidebar?: () => void;
  devices?: Device[];
  onSelectDevice?: (serial: string) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onTrace?: (q: string) => void;
  onlineOperators?: OnlineOperatorPresence[];
  pingMs?: number | null;
}

export const Header: React.FC<HeaderProps> = React.memo(({
  role,
  onSetRole,
  branches,
  adminUsers,
  activeAdminStaff,
  onChangeAdminStaff,
  activeBranchId,
  onChangeBranchId,
  activeStaff,
  onChangeStaff,
  onOpenBatchModal,
  onOpenRequestModal,
  onOpenExportModal,
  onLockSession,
  onSignOut,
  activeTab,
  onSelectTab,
  notifications,
  onMarkAllNotificationsRead,
  onSelectNotification,
  onToggleSidebar,
  devices = [],
  onSelectDevice,
  searchQuery,
  onSearchChange,
  onTrace,
  onlineOperators = [],
  pingMs = null,
}) => {
  const [notifOpen, setNotifOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [notifOpen]);

  const formatNotifTime = (timestamp: string) => {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      if (!isNaN(d.getTime())) {
        let hh = d.getHours();
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ampm = hh >= 12 ? 'PM' : 'AM';
        hh = hh % 12 || 12;
        return `${hh}:${mm} ${ampm}`;
      }
    } catch {
      // fallback to manual string parsing
    }
    const timePart = timestamp.includes(' ')
      ? timestamp.split(' ')[1]
      : timestamp.includes('T')
      ? timestamp.split('T')[1]
      : timestamp;
    const parts = timePart.split(':');
    if (parts.length >= 2) {
      const hh = parseInt(parts[0], 10);
      const mm = parts[1]?.slice(0, 2);
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const hour12 = hh % 12 || 12;
      return `${hour12}:${mm} ${ampm}`;
    }
    return timePart;
  };

  const currentBranch =
    branches.find((b) => b.code === activeBranchId || b.id === activeBranchId) ||
    branches[1] ||
    branches[0] ||
    { id: '105', code: '105', name: 'Branch Office', staff: ['Branch Staff'] };


  const unreadCount = notifications.filter((n) => !n.read).length;

  // Global Quick Search State & Logic
  const [localSearch, setLocalSearch] = useState(searchQuery || '');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchQuery !== undefined && searchQuery !== localSearch) {
      setLocalSearch(searchQuery);
    }
  }, [searchQuery]);

  useEffect(() => {
    function handleClickOutsideSearch(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutsideSearch);
    return () => document.removeEventListener('mousedown', handleClickOutsideSearch);
  }, []);

  // Global Keyboard Shortcut: Cmd/Ctrl + K or Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchFocused(true);
      }
      if (e.key === 'Escape' && isSearchFocused) {
        setIsSearchFocused(false);
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchFocused]);

  // Fast single-pass search across devices & branches
  const searchResults = useMemo(() => {
    const term = localSearch.trim().toLowerCase();
    if (!term) return { devices: [], branches: [] };

    const matchedDevices: Device[] = [];
    if (devices && devices.length > 0) {
      for (let i = 0; i < devices.length; i++) {
        const d = devices[i];
        if (
          d.serial.toLowerCase().includes(term) ||
          (d.mid && d.mid.toLowerCase().includes(term)) ||
          (d.tid && d.tid.toLowerCase().includes(term)) ||
          (d.merchantName && d.merchantName.toLowerCase().includes(term)) ||
          d.branchId === term
        ) {
          matchedDevices.push(d);
          if (matchedDevices.length >= 6) break;
        }
      }
    }

    const matchedBranches: Branch[] = [];
    if (branches && branches.length > 0) {
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        if (
          b.id === term ||
          b.code === term ||
          b.name.toLowerCase().includes(term)
        ) {
          matchedBranches.push(b);
          if (matchedBranches.length >= 3) break;
        }
      }
    }

    return { devices: matchedDevices, branches: matchedBranches };
  }, [devices, branches, localSearch]);

  const mobileTabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'merchants', label: 'Merchant Deployment' },
    { id: 'merchant_history', label: 'Merchant History' },
    { id: 'mobile_sync', label: 'Phone App Review' },
    { id: 'inventory', label: 'Stock Inventory' },
    { id: 'requisitions', label: 'Stock Requests', redPoint: unreadCount > 0 },
    { id: 'branches', label: 'Branch Codes' },
    { id: 'users', label: 'Staff Directory' },
    { id: 'audit_log', label: 'Audit Trail' },
    ...(role === 'SUPER_ADMIN' ? [{ id: 'settings', label: 'Settings' }] : []),
  ];

  // Style #2 Locked In as the #1 Permanent Header Style:
  // Translucent Crystal-White Glass Header with Stock-Request Table-Header Blue (slightly darker: #0f334d / #133e5e)
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md text-zinc-900 border-b border-zinc-200/90 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)] transition-all duration-200">
      <div className="h-[4.5rem] px-4 sm:px-6 flex items-center justify-between gap-3">
        {/* Left: Sidebar Toggle & Global Quick Search Bar */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 max-w-xl">
          {onToggleSidebar && (
            <motion.button
              whileTap={{ scale: 0.92 }}
              type="button"
              onClick={onToggleSidebar}
              className="p-2 rounded-xl cursor-pointer border bg-slate-100 hover:bg-slate-200/80 text-slate-700 border-slate-200/90 shadow-2xs transition shrink-0"
              title="Toggle Sidebar"
            >
              <Menu className="w-4 h-4" />
            </motion.button>
          )}

          {/* Global Quick Search Bar */}
          <div ref={searchContainerRef} className="relative flex-1 min-w-[180px] max-w-[340px] sm:max-w-[420px]">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all duration-150 ${
                isSearchFocused
                  ? 'bg-white border-[#003857] ring-3 ring-[#003857]/15 shadow-sm'
                  : 'bg-slate-100/90 hover:bg-slate-100 border-slate-200/90 hover:border-slate-300 shadow-2xs'
              }`}
            >
              <Search
                className={`w-4 h-4 shrink-0 transition-colors ${
                  isSearchFocused ? 'text-[#003857]' : 'text-slate-400'
                }`}
              />
              <input
                ref={searchInputRef}
                type="text"
                value={localSearch}
                onChange={(e) => {
                  setLocalSearch(e.target.value);
                  setIsSearchFocused(true);
                }}
                onFocus={() => setIsSearchFocused(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSearchChange?.(localSearch.trim());
                    onSelectTab('inventory');
                    setIsSearchFocused(false);
                  }
                }}
                placeholder="Quick search serial, MID, branch..."
                className="w-full text-xs font-medium text-zinc-900 placeholder:text-slate-400 bg-transparent focus:outline-none"
              />
              {localSearch ? (
                <button
                  type="button"
                  onClick={() => {
                    setLocalSearch('');
                    onSearchChange?.('');
                    searchInputRef.current?.focus();
                  }}
                  className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-zinc-700 cursor-pointer shrink-0 transition"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-white border border-slate-200 text-slate-400 shrink-0 shadow-3xs select-none">
                  ⌘K
                </kbd>
              )}
            </div>

            {/* Instant Quick Search Dropdown Results */}
            <AnimatePresence>
              {isSearchFocused && localSearch.trim().length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="absolute left-0 top-full mt-2 w-full min-w-[340px] sm:min-w-[420px] max-w-[500px] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden z-50 divide-y divide-slate-100"
                >
                  {onTrace && localSearch.trim().length >= 4 && (
                    <button
                      type="button"
                      onClick={() => { setIsSearchFocused(false); onTrace(localSearch.trim()); }}
                      className="w-full px-4 py-2.5 text-left text-xs text-[#003857] bg-sky-50 hover:bg-sky-100 flex items-center gap-2 cursor-pointer"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>Show everything about &ldquo;{localSearch.trim()}&rdquo; (status, history, requests, phone records)</span>
                    </button>
                  )}
                  {/* Results List */}
                  <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 custom-scrollbar p-1.5">
                    {searchResults.devices.length === 0 && searchResults.branches.length === 0 ? (
                      <div className="py-8 px-4 text-center">
                        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-2">
                          <Search className="w-4 h-4" />
                        </div>
                        <div className="text-xs font-bold text-zinc-800">No matching records</div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          No hardware serial, MID, or branch found for &ldquo;{localSearch.trim()}&rdquo;
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Matched Devices */}
                        {searchResults.devices.length > 0 && (
                          <div className="py-1">
                            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Hardware Devices ({searchResults.devices.length})
                            </div>
                            {searchResults.devices.map((d) => {
                              const isSB = d.type === 'Sound Box';
                              const meta = STAGE_META[d.stage] || STAGE_META.BRANCH_RESERVE;
                              return (
                                <button
                                  key={d.serial}
                                  type="button"
                                  onClick={() => {
                                    setIsSearchFocused(false);
                                    if (onSelectDevice) {
                                      onSelectDevice(d.serial);
                                    } else {
                                      onSearchChange?.(d.serial);
                                      onSelectTab('inventory');
                                    }
                                  }}
                                  className="w-full px-3 py-2 text-left rounded-xl hover:bg-slate-50 flex items-center gap-2.5 transition cursor-pointer group"
                                >
                                  <div
                                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                                      isSB
                                        ? 'bg-purple-50 text-purple-700 border-purple-200'
                                        : 'bg-blue-50 text-[#003857] border-blue-200'
                                    }`}
                                  >
                                    {isSB ? (
                                      <Volume2 className="w-3.5 h-3.5" />
                                    ) : (
                                      <Cpu className="w-3.5 h-3.5" />
                                    )}
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-bold font-mono text-zinc-900 group-hover:text-[#003857] truncate">
                                        {d.serial}
                                      </span>
                                      <span
                                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                                          meta.badgeClassLight || 'bg-slate-100 text-slate-700 border-slate-200'
                                        }`}
                                      >
                                        {meta.short}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 truncate mt-0.5">
                                      {d.model} · Branch {d.branchId}
                                      {d.merchantName ? ` · ${d.merchantName}` : ''}
                                      {d.mid ? ` (MID: ${d.mid})` : ''}
                                    </div>
                                  </div>

                                  <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-zinc-600 shrink-0 group-hover:translate-x-0.5 transition" />
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Matched Branches */}
                        {searchResults.branches.length > 0 && (
                          <div className="py-1">
                            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Branches ({searchResults.branches.length})
                            </div>
                            {searchResults.branches.map((b) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => {
                                  setIsSearchFocused(false);
                                  // (22 Oct 2026) a branch account never changes its own branch from search
                                  if (role !== 'BRANCH') onChangeBranchId(b.id);
                                  onSelectTab('inventory');
                                }}
                                className="w-full px-3 py-2 text-left rounded-xl hover:bg-slate-50 flex items-center gap-2.5 transition cursor-pointer group"
                              >
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border bg-emerald-50 text-emerald-700 border-emerald-200">
                                  <Building2 className="w-3.5 h-3.5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-bold text-zinc-900 group-hover:text-[#003857] truncate">
                                    Branch Code {b.id} — {b.name}
                                  </div>
                                  <div className="text-[10px] text-slate-500 truncate">
                                    {(b.staff && b.staff.length) || 0} active staff members
                                  </div>
                                </div>
                                <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-zinc-600 shrink-0 group-hover:translate-x-0.5 transition" />
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Dropdown Footer */}
                  <div className="px-3 py-2 bg-slate-50/90 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">
                      Press <kbd className="font-mono font-bold text-slate-600">Enter</kbd> to search all records
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onSearchChange?.(localSearch.trim());
                        onSelectTab('inventory');
                        setIsSearchFocused(false);
                      }}
                      className="font-bold text-[#003857] hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <span>Filter in Inventory</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Branch Assignment Display (Branch Role Only) */}
          {role === 'BRANCH' && (
            <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border bg-white/80 border-zinc-200 text-zinc-900 backdrop-blur-md shrink-0">
              <Building2 className="w-3.5 h-3.5 text-zinc-700 shrink-0" />
              <span className="text-xs font-bold text-zinc-800">
                {currentBranch ? `Branch Code ${currentBranch.id} - ${currentBranch.name.replace(' Branch', '')}` : `Branch Code ${activeBranchId}`}
              </span>
            </div>
          )}

          {/* Live System Presence (Who Is Online Using the System) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setOnlineOpen((o) => !o)}
              title="See who is currently using the system"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold border bg-emerald-50/80 hover:bg-emerald-100 text-emerald-800 border-emerald-200 cursor-pointer transition"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{Math.max(1, onlineOperators.length)} Online</span>
            </button>
            <AnimatePresence>
              {onlineOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.55 }}
                  className="absolute right-0 mt-2 w-80 rounded-2xl shadow-2xl border bg-white border-slate-200 text-zinc-900 overflow-hidden z-50 divide-y divide-slate-100"
                >
                  <div className="px-4 py-2.5 bg-emerald-50/80 flex items-center justify-between">
                    <span className="text-xs font-extrabold text-emerald-900 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      Active System Operators ({Math.max(1, onlineOperators.length)})
                    </span>
                    <button
                      type="button"
                      onClick={() => setOnlineOpen(false)}
                      className="text-xs text-slate-500 hover:text-slate-800 font-bold cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1">
                    {onlineOperators.length > 0 ? (
                      onlineOperators.map((op, idx) => (
                        <div key={op.id || op.empId || op.uid || idx} className="px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="font-bold text-zinc-900 truncate">{op.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {op.role} · Branch {op.branchId} · {op.location || 'Phnom Penh'}
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono text-[10px] font-bold shrink-0">
                            Active
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="px-2.5 py-2 rounded-xl bg-slate-50 flex items-center justify-between gap-2 text-xs">
                        <div>
                          <div className="font-bold text-zinc-900">{role !== 'BRANCH' ? activeAdminStaff : activeStaff} (You)</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {role} · Branch {activeBranchId} · Phnom Penh
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono text-[10px] font-bold">
                          Online
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Request Stock Action Button in Signature Navy Blue */}
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            type="button"
            onClick={onOpenRequestModal}
            className="px-3 py-1.5 rounded-xl text-xs font-extrabold shadow-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 bg-[#003857] hover:bg-[#002a42] text-white transition"
          >
            <SendHorizontal className="w-3.5 h-3.5" />
            <span>Request Stock</span>
          </motion.button>

          {/* Live Alert Notification Bell */}
          <div ref={notifRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              title="Alerts: Branch Staff Stock Requests"
              className={`p-2 rounded-xl cursor-pointer relative border backdrop-blur-md transition ${
                notifOpen
                  ? 'tab-active-blue text-white border-[#004e75]'
                  : unreadCount > 0
                  ? 'bg-zinc-900/10 hover:bg-zinc-900/15 text-zinc-900 border-zinc-300'
                  : 'bg-slate-100/80 hover:bg-slate-200 text-zinc-700 border-zinc-200'
              }`}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white font-mono text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white">
                  {unreadCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {notifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.55 }}
                  className="absolute right-0 mt-2.5 w-[360px] sm:w-[420px] rounded-2xl shadow-2xl border bg-white border-slate-200/90 text-zinc-900 overflow-hidden z-50 divide-y divide-slate-100 transform-gpu will-change-gpu"
                >
                  {/* Clean, Modern Header */}
                  <div className="px-4 py-3 bg-slate-50/80 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-[#003857]/10 text-[#003857] flex items-center justify-center">
                        <Bell className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-extrabold text-zinc-900">
                          Notifications
                        </span>
                        {unreadCount > 0 ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#003857] text-white">
                            {unreadCount} new
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-200/70 text-slate-600">
                            All caught up
                          </span>
                        )}
                      </div>
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={onMarkAllNotificationsRead}
                        className="text-xs font-semibold text-zinc-700 hover:text-zinc-950 flex items-center gap-1 hover:underline cursor-pointer transition"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>Mark all read</span>
                      </button>
                    )}
                  </div>

                  {/* Notification Items List */}
                  <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
                    {notifications.length === 0 ? (
                      <div className="py-12 px-4 text-center flex flex-col items-center justify-center gap-2 text-slate-400">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                          <Inbox className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium">No alerts yet</span>
                        <p className="text-[11px] text-slate-400 max-w-[220px]">
                          Stock requests from branch officers will appear here automatically.
                        </p>
                      </div>
                    ) : (
                      notifications.map((n) => {
                        const cleanTitle = n.title.replace(
                          /^Request from Branch Staff\s*[•·-]\s*/i,
                          ''
                        );
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => {
                              onSelectNotification(n);
                              setNotifOpen(false);
                            }}
                            className={`w-full p-3.5 text-left transition flex items-start gap-3 cursor-pointer relative group ${
                              !n.read
                                ? 'bg-sky-50/50 hover:bg-sky-50/80'
                                : 'bg-white hover:bg-slate-50/80'
                            }`}
                          >
                            {/* Accent left indicator stripe for unread */}
                            {!n.read && (
                              <span className="absolute left-0 top-3 bottom-3 w-1 bg-[#003857] rounded-r" />
                            )}

                            {/* Icon Avatar */}
                            <div
                              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border transition ${
                                !n.read
                                  ? 'bg-[#003857]/10 text-[#003857] border-[#003857]/30 group-hover:bg-[#003857] group-hover:text-white'
                                  : 'bg-slate-100 text-slate-500 border-slate-200'
                              }`}
                            >
                              <SendHorizontal className="w-4 h-4" />
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-xs font-bold text-zinc-900 truncate font-mono">
                                    {cleanTitle}
                                  </span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-900/8 text-zinc-800 border border-zinc-200 shrink-0">
                                    Stock Request
                                  </span>
                                </div>
                                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                                  {formatNotifTime(n.timestamp)}
                                </span>
                              </div>

                              <p className="text-xs text-slate-600 leading-relaxed font-normal">
                                {n.message}
                              </p>

                              <div className="mt-2 flex items-center justify-between text-[11px]">
                                <span className="text-zinc-800 font-semibold flex items-center gap-1 group-hover:underline">
                                  <span>Review request</span>
                                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                                </span>
                                {n.branchId && (
                                  <span className="text-[10px] font-mono text-slate-400">
                                    Branch Code {n.branchId}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-4 py-2.5 bg-slate-50/80 flex items-center justify-between text-xs">
                    <span className="text-slate-500 text-[11px]">
                      {notifications.length} total request{notifications.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTab('requisitions');
                        setNotifOpen(false);
                      }}
                      className="text-xs font-bold text-zinc-800 hover:text-zinc-950 flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <span>Open Stock Requests</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Utility Icons (Export, Lock Session, Sign Out) */}
          <button
            type="button"
            onClick={onOpenExportModal}
            title="Export Reports & Audit Log"
            className="p-2 rounded-xl cursor-pointer shrink-0 border bg-slate-100/80 hover:bg-slate-200 text-zinc-700 border-zinc-200 backdrop-blur-md"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onLockSession}
            title="Lock Operator Session"
            className="p-2 rounded-xl cursor-pointer shrink-0 border bg-slate-100/80 hover:bg-slate-200 text-zinc-700 border-zinc-200 backdrop-blur-md"
          >
            <Lock className="w-3.5 h-3.5" />
          </button>

          {/* User Profile & Sign Out */}
          <div className="hidden lg:flex items-center gap-2.5 pl-3 border-l border-zinc-200 shrink-0">
            <div className="text-right leading-tight">
              <div className="text-xs font-bold text-zinc-800">
                {role !== 'BRANCH' ? activeAdminStaff : activeStaff}
              </div>
              <div className="text-[10px] text-zinc-500 font-semibold">
                {role === 'SUPER_ADMIN'
                  ? 'Super Admin (Head Office)'
                  : role === 'ADMIN'
                  ? 'Admin HQ (Head Office)'
                  : `Branch Code ${currentBranch.id}`}
              </div>
            </div>
            <div className="w-8 h-8 rounded-full border flex items-center justify-center bg-[#003857] text-white border-[#003857]/40 shadow-2xs">
              <UserCircle2 className="w-5 h-5" />
            </div>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            title="Sign Out to Login Page"
            className="p-2 rounded-xl cursor-pointer shrink-0 border bg-slate-100/80 hover:bg-slate-200 text-zinc-700 border-zinc-200 backdrop-blur-md"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Mobile Glass Navigation Bar */}
      <div className="md:hidden bg-[#141519]/95 backdrop-blur-xl border-t border-white/10 px-3 py-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar text-white">
        {mobileTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelectTab(t.id)}
            className={`relative px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === t.id
                ? 'bg-white text-zinc-900 font-extrabold'
                : 'text-white/85 hover:text-white'
            }`}
          >
            <span>{t.label}</span>
            {t.redPoint && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            )}
          </button>
        ))}
      </div>
    </header>
  );
});
