import React, { useState, useRef, useEffect } from 'react';
import {
  UserRole,
  Branch,
  User,
  ThemeMode,
  SystemNotification,
  AppSettings,
} from '../types';
import { AppBrandLogo } from './AppBrandLogo';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert,
  ShieldCheck,
  Building2,
  Users,
  FilePlus,
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
  ChevronDown,
  Menu,
  UserCircle2,
  ClipboardList,
  History,
  Bell,
  LogOut,
  CheckCheck,
  RotateCcw,
  Settings,
  X,
  ArrowRight,
  Inbox,
  Sparkles,
  Palette,
  Check,
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onSelectTab: (tab: string, subTab?: string) => void;
  totalDevices: number;
  totalMerchants: number;
  totalHistoricalMerchants?: number;
  webhookCount: number;
  pendingReqs: number;
  totalBranches?: number;
  totalUsers: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  theme?: ThemeMode;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  appSettings?: AppSettings;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  activeTab,
  onSelectTab,
  totalDevices,
  totalMerchants,
  totalHistoricalMerchants,
  webhookCount,
  pendingReqs,
  totalBranches,
  totalUsers,
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
          label: 'Mobile Sync',
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
          id: 'requisitions',
          label: 'Stock Requests',
          icon: ScrollText,
          count: pendingReqs,
        },
        {
          id: 'branches',
          label: 'Branch Codes',
          icon: Building2,
          count: totalBranches,
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
        {
          id: 'settings',
          label: 'Settings',
          icon: Settings,
        },
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
            transition={{ type: 'spring', stiffness: 450, damping: 25 }}
            type="button"
            onClick={() => {
              onSelectTab('settings', 'brand_logo');
              if (isMobileView) onCloseMobile?.();
            }}
            className="flex items-center gap-3 cursor-pointer text-left min-w-0"
            title="Brand & Logo Studio (Settings)"
          >
            <AppBrandLogo
              logoUrl={appSettings?.customLogoUrl}
              presetId={appSettings?.logoPresetId}
              size="md"
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
        </div>

        {/* Clean Grouped Navigation Items with Apple Tactile Feedback */}
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
                      } rounded-xl flex items-center gap-3 text-left text-[13px] cursor-pointer transition-all duration-150 z-10 ${
                        isActive
                          ? 'font-medium text-white bg-white/12 border border-white/15 shadow-xs'
                          : 'font-normal text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                      }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-white/90" />
                      )}

                      <div className="relative flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                            isActive
                              ? 'bg-white/20 text-white shadow-xs'
                              : 'bg-white/[0.05] text-zinc-400 group-hover:text-zinc-200 group-hover:bg-white/[0.08]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        {(isMobileView || !collapsed) && (
                          <span className="truncate">{item.label}</span>
                        )}
                      </div>

                      {/* Subtle Counter Badge (hidden when count is 0 or completely synced) */}
                      {(isMobileView || !collapsed) && item.count !== undefined && item.count > 0 && (
                        <span
                          className={`font-mono text-[10px] px-2 py-0.5 rounded-full tabular-nums shrink-0 transition-colors ${
                            isActive
                              ? 'bg-white text-zinc-900 font-semibold shadow-2xs'
                              : item.highlight
                              ? 'bg-white/15 text-white border border-white/20 font-medium'
                              : 'bg-white/[0.06] text-zinc-300 border border-white/[0.06]'
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
            transition={{ type: 'spring', stiffness: 450, damping: 25 }}
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
        transition={{ type: 'spring', stiffness: 450, damping: 35, mass: 0.6 }}
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
              transition={{ type: 'spring', stiffness: 360, damping: 32, mass: 0.8 }}
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
}) => {
  const [notifOpen, setNotifOpen] = useState(false);
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

  const operatorName =
    role === 'BRANCH' ? activeStaff : activeAdminStaff.split(' (')[0];

  const unreadCount = notifications.filter((n) => !n.read).length;

  const mobileTabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'merchants', label: 'Merchant Deployment' },
    { id: 'merchant_history', label: 'Merchant History' },
    { id: 'mobile_sync', label: 'Mobile Sync' },
    { id: 'inventory', label: 'Stock Inventory' },
    { id: 'requisitions', label: 'Stock Requests', redPoint: unreadCount > 0 },
    { id: 'branches', label: 'Branch Codes' },
    { id: 'users', label: 'Staff Directory' },
    { id: 'audit_log', label: 'Audit Trail' },
    { id: 'settings', label: 'Settings' },
  ];

  const roleOptions: Array<{
    id: UserRole;
    label: string;
    icon: React.ElementType;
  }> = [
    { id: 'SUPER_ADMIN', label: 'Super Admin', icon: ShieldAlert },
    { id: 'ADMIN', label: 'Admin', icon: ShieldCheck },
    { id: 'BRANCH', label: 'Staff', icon: Building2 },
  ];

  // Style #2 Locked In as the #1 Permanent Header Style:
  // Translucent Crystal-White Glass Header with Stock-Request Table-Header Blue (slightly darker: #0f334d / #133e5e)
  return (
    <header className="sticky top-0 z-40 bg-white/82 backdrop-blur-2xl text-zinc-900 border-b border-zinc-200/80 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)] transition-all duration-200">
      <div className="h-[4.5rem] px-4 sm:px-6 flex items-center justify-between gap-3">
        {/* Left: Sidebar Toggle & Role Switcher */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          {onToggleSidebar && (
            <motion.button
              whileTap={{ scale: 0.92 }}
              type="button"
              onClick={onToggleSidebar}
              className="p-2 rounded-xl cursor-pointer border bg-[#004953]/10 hover:bg-[#004953]/20 text-[#004953] border-[#004953]/30 backdrop-blur-md transition shrink-0"
              title="Toggle Sidebar"
            >
              <Menu className="w-4 h-4" />
            </motion.button>
          )}

          {/* Locked Role Authority Badge Based on Super Admin Assignment */}
          <div className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-200/90 text-slate-900 flex items-center gap-2 shadow-2xs shrink-0 select-none">
            {role === 'SUPER_ADMIN' ? (
              <>
                <div className="w-5 h-5 rounded-md bg-[#003857] text-white flex items-center justify-center shrink-0 shadow-2xs">
                  <ShieldAlert className="w-3.5 h-3.5 text-sky-300" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-black tracking-tight text-[#003857] uppercase leading-none">
                    Super Admin
                  </span>
                  <span className="text-[9px] font-semibold text-slate-500 leading-none mt-0.5">
                    Full Authority
                  </span>
                </div>
              </>
            ) : role === 'ADMIN' ? (
              <>
                <div className="w-5 h-5 rounded-md bg-[#003857] text-white flex items-center justify-center shrink-0 shadow-2xs">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-black tracking-tight text-[#003857] uppercase leading-none">
                    Admin HQ
                  </span>
                  <span className="text-[9px] font-semibold text-slate-500 leading-none mt-0.5">
                    Head Office Stock (Code 100)
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="w-5 h-5 rounded-md bg-[#003857] text-white flex items-center justify-center shrink-0 shadow-2xs">
                  <Building2 className="w-3.5 h-3.5 text-amber-300" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-black tracking-tight text-[#003857] uppercase leading-none">
                    Branch Staff
                  </span>
                  <span className="text-[9px] font-semibold text-slate-500 leading-none mt-0.5">
                    Branch Code {activeBranchId}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Institutional User Identity & Branch Assignment Display */}
          {role !== 'BRANCH' ? (
            <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border bg-white/80 border-zinc-200 text-zinc-900 backdrop-blur-md shrink-0">
              <Users className="w-3.5 h-3.5 text-zinc-700 shrink-0" />
              <span className="text-xs font-bold text-zinc-800">
                {activeAdminStaff}
              </span>
            </div>
          ) : (
            <div className="hidden xl:flex items-center gap-2 px-2.5 py-1.5 rounded-xl border bg-white/80 border-zinc-200 text-zinc-900 backdrop-blur-md shrink-0">
              <Building2 className="w-3.5 h-3.5 text-zinc-700 shrink-0" />
              <span className="text-xs font-bold text-zinc-800">
                {currentBranch ? `Branch Code ${currentBranch.id} - ${currentBranch.name.replace(' Branch', '')}` : `Branch Code ${activeBranchId}`}
              </span>
              <span className="opacity-30">|</span>
              <span className="text-xs font-semibold text-zinc-700 font-mono">
                {activeStaff}
              </span>
            </div>
          )}

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
                  ? 'bg-[#003857] text-white border-[#003857]'
                  : unreadCount > 0
                  ? 'bg-zinc-900/10 hover:bg-zinc-900/15 text-zinc-900 border-zinc-300'
                  : 'bg-slate-100/80 hover:bg-slate-200 text-zinc-700 border-zinc-200'
              }`}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full natural-red-point text-white font-mono text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white">
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
                  transition={{ type: 'spring', stiffness: 420, damping: 28, mass: 0.7 }}
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
          <div className="hidden 2xl:flex items-center gap-2.5 pl-3 border-l border-zinc-200 shrink-0">
            <div className="text-right leading-tight">
              <div className="text-xs font-bold text-zinc-800">
                {operatorName}
              </div>
              <div className="text-[10px] text-zinc-500 font-semibold">
                {role === 'SUPER_ADMIN'
                  ? 'Super Admin (100)'
                  : role === 'ADMIN'
                  ? 'Admin HQ (100)'
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
              <span className="w-1.5 h-1.5 rounded-full natural-red-point" />
            )}
          </button>
        ))}
      </div>
    </header>
  );
});
