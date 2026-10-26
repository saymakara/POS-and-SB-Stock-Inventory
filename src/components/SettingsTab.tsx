import React, { useState, useEffect } from 'react';
import {
  AppSettings,
  UserRole,
  ThemeMode,
  Device,
  User,
  Branch,
  CustomFieldDefinition,
  CustomFieldType,
  DEFAULT_CUSTOM_FIELDS,
  TelegramRegionalGroup,
} from '../types';
import { LogoPageTab } from './LogoPageTab';
import {
  getTelegramWebhookConfig,
  saveTelegramWebhookConfig,
  sendDeviceConfigTelegramAlert,
  detectTelegramGroupChats,
  saveTelegramRegionalGroups,
  getTelegramDetectedChats,
  saveTelegramDetectedChats,
  getTelegramBotUsername,
  saveTelegramBotUsername,
  clearTelegramConnection,
} from '../utils/errorLogger';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings,
  BatteryCharging,
  ShieldCheck,
  Building2,
  Database,
  Lock,
  Save,
  RotateCcw,
  Zap,
  CheckCircle2,
  Check,
  Sparkles,
  Download,
  Upload,
  AlertTriangle,
  Info,
  Clock,
  Layers,
  SlidersHorizontal,
  Plus,
  Trash2,
  Edit3,
  MapPin,
  Phone,
  Hash,
  Type,
  Calendar as CalendarIcon,
  PlusCircle,
  X,
  Eye,
  EyeOff,
  HelpCircle,
  Copy,
  Users,
  Send,
  Edit2,
} from 'lucide-react';

export type SettingsSubTab =
  | 'policy'
  | 'brand_logo'
  | 'hardware'
  | 'sla'
  | 'customFields'
  | 'data'
  | 'security';

interface SettingsTabProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  role: UserRole;
  theme?: ThemeMode;
  onToast?: (msg: string) => void;
  onResetData?: () => void;
  onExportBackup?: () => void;
  onImportBackup?: (jsonStr: string) => void;
  initialSubTab?: SettingsSubTab;
  onSubTabChange?: (tab: SettingsSubTab) => void;
  branches?: Branch[];
  devices?: Device[];
  users?: User[];
  onSelectBranchFilter?: (branchCode: string) => void;
  onOpenNewBranchModal?: () => void;
  onOpenEditBranchModal?: (branch: Branch) => void;
  onSelectDevice?: (serial: string) => void;
  addAuditLog?: (actionTitle: string, detailText: string) => void;
  onUpdateAppSettings?: (updater: (prev: AppSettings) => AppSettings) => void;
  /** (22 Oct 2026) true when the stock lives in the shared database: no file restore; reset clears this browser only */
  sharedDatabase?: boolean;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  onUpdateSettings,
  role,
  theme = 'light',
  onToast,
  onResetData,
  onExportBackup,
  onImportBackup,
  sharedDatabase = false,
  initialSubTab = 'policy',
  onSubTabChange,
  branches = [],
  devices = [],
  users = [],
  onSelectBranchFilter,
  onOpenNewBranchModal,
  onOpenEditBranchModal,
  onSelectDevice,
  addAuditLog,
  onUpdateAppSettings,
}) => {
  const [formState, setFormState] = useState<AppSettings>(settings);
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>(initialSubTab || 'policy');

  useEffect(() => {
    if (initialSubTab && initialSubTab !== activeSubTab) {
      setActiveSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const handleSubTabSelect = (tab: SettingsSubTab) => {
    setActiveSubTab(tab);
    onSubTabChange?.(tab);
  };
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const initialTg = getTelegramWebhookConfig();
  const [tgBotToken, setTgBotToken] = useState(initialTg.botToken);
  const [tgConfigChatId, setTgConfigChatId] = useState(initialTg.configChatId || initialTg.chatId);
  const [tgWebhookUrl, setTgWebhookUrl] = useState(initialTg.webhookUrl);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgDetecting, setTgDetecting] = useState(false);
  const [tgBotUsername, setTgBotUsername] = useState(() => getTelegramBotUsername());
  const [tgDetectError, setTgDetectError] = useState('');
  const [tgDetectedChats, setTgDetectedChats] = useState<{ id: string; title: string; type: string }[]>(() =>
    getTelegramDetectedChats()
  );
  const [isDeleteConnectionModalOpen, setIsDeleteConnectionModalOpen] = useState(false);

  const handleRemoveDetectedChat = (chatIdToRemove: string) => {
    const updated = tgDetectedChats.filter((c) => c.id !== chatIdToRemove);
    setTgDetectedChats(updated);
    saveTelegramDetectedChats(updated);
    if (tgConfigChatId === chatIdToRemove) {
      setTgConfigChatId('');
      saveTelegramWebhookConfig({ configChatId: '', chatId: '' });
      if (onToast) onToast(`Removed chat (${chatIdToRemove}) and detached from default routing.`);
    } else {
      if (onToast) onToast(`Removed chat (${chatIdToRemove}) from detected list.`);
    }
  };

  const handleClearAllDetectedChats = () => {
    setTgDetectedChats([]);
    saveTelegramDetectedChats([]);
    if (onToast) onToast('All detected chats removed from system.');
  };

  const handleClearDefaultGroup = () => {
    setTgConfigChatId('');
    saveTelegramWebhookConfig({ configChatId: '', chatId: '' });
    if (onToast) onToast('Default connected group removed from system.');
  };

  const handleDeleteConnection = () => {
    setTgBotToken('');
    setTgConfigChatId('');
    setTgWebhookUrl('');
    setTgBotUsername('');
    setTgDetectedChats([]);
    setTgDetectError('');
    clearTelegramConnection();
    setIsDeleteConnectionModalOpen(false);
    if (onToast) onToast('Telegram bot connection deleted and all linked groups removed from system.');
  };
  const [showBotToken, setShowBotToken] = useState(false);
  const [showBotFatherGuide, setShowBotFatherGuide] = useState(false);
  const [regionalGroups, setRegionalGroups] = useState<TelegramRegionalGroup[]>(() => {
    if (formState.telegramRegionalGroups && formState.telegramRegionalGroups.length > 0) {
      return formState.telegramRegionalGroups;
    }
    return initialTg.regionalGroups || [];
  });
  const [isRegionalModalOpen, setIsRegionalModalOpen] = useState(false);
  const [editingRegionalGroup, setEditingRegionalGroup] = useState<TelegramRegionalGroup | null>(null);
  const [rgName, setRgName] = useState('');
  const [rgChatId, setRgChatId] = useState('');
  const [rgBranchCodes, setRgBranchCodes] = useState<string[]>([]);
  const [rgTestingId, setRgTestingId] = useState<string | null>(null);

  // Custom Field Manager State
  const [isFieldModalOpen, setIsFieldModalOpen] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [modalFieldLabel, setModalFieldLabel] = useState('');
  const [modalFieldKey, setModalFieldKey] = useState('');
  const [modalFieldType, setModalFieldType] = useState<CustomFieldType>('text');
  const [modalFieldPlaceholder, setModalFieldPlaceholder] = useState('');
  const [modalFieldDescription, setModalFieldDescription] = useState('');
  const [modalFieldRequired, setModalFieldRequired] = useState(false);
  const [modalFieldOptions, setModalFieldOptions] = useState('');
  const [modalFieldTargetTab, setModalFieldTargetTab] = useState<'inventory' | 'merchants' | 'branches' | 'staff' | 'requisitions' | 'all'>('all');
  const [customFieldPreviewValues, setCustomFieldPreviewValues] = useState<Record<string, string>>({});

  const currentCustomFields: CustomFieldDefinition[] =
    formState.customFields && formState.customFields.length > 0
      ? formState.customFields
      : DEFAULT_CUSTOM_FIELDS;

  const handleToggleField = (id: string) => {
    const nextFields = currentCustomFields.map((f) =>
      f.id === id ? { ...f, enabled: !f.enabled } : f
    );
    const nextState = { ...formState, customFields: nextFields };
    setFormState(nextState);
    onUpdateSettings(nextState);
    const target = nextFields.find((f) => f.id === id);
    if (onToast) onToast(`${target?.label || 'Field'} is now ${target?.enabled ? 'enabled' : 'disabled'}.`);
  };

  const handleToggleRequired = (id: string) => {
    const nextFields = currentCustomFields.map((f) =>
      f.id === id ? { ...f, required: !f.required } : f
    );
    const nextState = { ...formState, customFields: nextFields };
    setFormState(nextState);
    onUpdateSettings(nextState);
    const target = nextFields.find((f) => f.id === id);
    if (onToast) onToast(`${target?.label || 'Field'} is now ${target?.required ? 'mandatory (required)' : 'optional'}.`);
  };

  const handleDeleteField = (id: string) => {
    const nextFields = currentCustomFields.filter((f) => f.id !== id);
    const nextState = { ...formState, customFields: nextFields };
    setFormState(nextState);
    onUpdateSettings(nextState);
    if (onToast) onToast('Custom field removed from system.');
  };

  const handleOpenAddField = (preset?: Partial<CustomFieldDefinition>) => {
    setEditingFieldId(null);
    setModalFieldLabel(preset?.label || '');
    setModalFieldKey(preset?.id || '');
    setModalFieldType(preset?.type || 'text');
    setModalFieldPlaceholder(preset?.placeholder || '');
    setModalFieldDescription(preset?.description || '');
    setModalFieldRequired(preset?.required || false);
    setModalFieldOptions(preset?.options ? preset.options.join(', ') : '');
    setModalFieldTargetTab(preset?.targetTab || 'all');
    setIsFieldModalOpen(true);
  };

  const handleOpenEditField = (field: CustomFieldDefinition) => {
    setEditingFieldId(field.id);
    setModalFieldTargetTab(field.targetTab || 'all');
    setModalFieldLabel(field.label);
    setModalFieldKey(field.id);
    setModalFieldType(field.type);
    setModalFieldPlaceholder(field.placeholder || '');
    setModalFieldDescription(field.description || '');
    setModalFieldRequired(field.required || false);
    setModalFieldOptions(field.options ? field.options.join(', ') : '');
    setIsFieldModalOpen(true);
  };

  const handleSaveFieldModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalFieldLabel.trim()) return;

    const rawKey =
      modalFieldKey.trim() ||
      modalFieldLabel.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    const cleanKey = rawKey.replace(/^_+|_+$/g, '') || `custom_${Date.now()}`;
    const optionsArray =
      modalFieldType === 'select'
        ? modalFieldOptions
            .split(',')
            .map((o: string) => o.trim())
            .filter((o: string) => o.length > 0)
        : undefined;

    let nextFields: CustomFieldDefinition[];
    if (editingFieldId) {
      nextFields = currentCustomFields.map((f) => {
        if (f.id === editingFieldId) {
          return {
            ...f,
            label: modalFieldLabel.trim(),
            type: modalFieldType,
            placeholder: modalFieldPlaceholder.trim(),
            description: modalFieldDescription.trim(),
            required: modalFieldRequired,
            options: optionsArray,
            targetTab: modalFieldTargetTab,
          };
        }
        return f;
      });
    } else {
      const existingIdx = currentCustomFields.findIndex((f) => f.id === cleanKey);
      if (existingIdx >= 0) {
        nextFields = currentCustomFields.map((f, i) =>
          i === existingIdx
            ? {
                ...f,
                label: modalFieldLabel.trim(),
                enabled: true,
                type: modalFieldType,
                placeholder: modalFieldPlaceholder.trim(),
                description: modalFieldDescription.trim(),
                required: modalFieldRequired,
                options: optionsArray,
            targetTab: modalFieldTargetTab,
              }
            : f
        );
      } else {
        const newField: CustomFieldDefinition = {
          id: cleanKey,
          label: modalFieldLabel.trim(),
          type: modalFieldType,
          placeholder: modalFieldPlaceholder.trim(),
          description: modalFieldDescription.trim(),
          required: modalFieldRequired,
          enabled: true,
          options: optionsArray,
          isSystem: false,
          targetTab: modalFieldTargetTab,
        };
        nextFields = [...currentCustomFields, newField];
      }
    }

    const nextState = { ...formState, customFields: nextFields };
    setFormState(nextState);
    onUpdateSettings(nextState);
    setIsFieldModalOpen(false);
    if (onToast) onToast(`Field "${modalFieldLabel.trim()}" saved and activated.`);
  };

  const handleQuickAddPreset = (preset: Omit<CustomFieldDefinition, 'enabled'>) => {
    const exists = currentCustomFields.find((f) => f.id === preset.id);
    let nextFields: CustomFieldDefinition[];
    if (exists) {
      nextFields = currentCustomFields.map((f) =>
        f.id === preset.id ? { ...f, enabled: true } : f
      );
      if (onToast) onToast(`"${preset.label}" field enabled.`);
    } else {
      nextFields = [...currentCustomFields, { ...preset, enabled: true }];
      if (onToast) onToast(`"${preset.label}" added and enabled.`);
    }
    const nextState = { ...formState, customFields: nextFields };
    setFormState(nextState);
    onUpdateSettings(nextState);
  };

  const handleResetToDefaultFields = () => {
    const nextState = { ...formState, customFields: DEFAULT_CUSTOM_FIELDS };
    setFormState(nextState);
    onUpdateSettings(nextState);
    if (onToast) onToast('Reset custom fields to ABA standard defaults.');
  };

  React.useEffect(() => {
    setFormState({ ...settings });
  }, [settings]);

  const isAdminLike = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings({
      ...formState,
      telegramRegionalGroups: regionalGroups,
    });
    saveTelegramWebhookConfig({
      botToken: tgBotToken,
      configChatId: tgConfigChatId,
      chatId: tgConfigChatId,
      webhookUrl: tgWebhookUrl,
      regionalGroups,
    });
    setSavedSuccess(true);
    if (onToast) onToast('System settings and policy configuration saved.');
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content && onImportBackup) {
        onImportBackup(content);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="surface-card shadow-md p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#003857] flex items-center justify-center text-white shadow-sm shrink-0">
            {activeSubTab === 'brand_logo' ? (
              <Sparkles className="w-5 h-5 text-amber-300" />
            ) : (
              <Settings className="w-5 h-5 text-sky-300" />
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-zinc-900">
                {activeSubTab === 'brand_logo'
                  ? 'Brand & Logo Studio'
                  : 'System & Policy Settings'}
              </h2>
              <span className="text-xs font-mono font-bold text-slate-500">
                {activeSubTab === 'brand_logo'
                  ? '· Portal Branding, Logos & Live Mockups'
                  : '· FinTech Acquiring & Terminal Governance'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeSubTab === 'brand_logo'
                ? 'Select brand presets, upload custom logos, configure institution titles, and review responsive application mockups.'
                : 'Configure 15-digit MID validation, 24-month POS battery lifecycle policies, operational SLA targets, hardware serial numbering standards, and data backup controls.'}
            </p>
          </div>
        </div>

        {activeSubTab !== 'brand_logo' && (
          <div className="flex items-center gap-2.5">
            {savedSuccess && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Saved successfully</span>
              </span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!isAdminLike}
              className="px-4 py-2 rounded-xl text-xs font-semibold tracking-wide bg-[#003857] hover:bg-[#002a42] text-white shadow-sm flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>Save Configuration</span>
            </button>
          </div>
        )}
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => handleSubTabSelect('policy')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeSubTab === 'policy'
              ? 'bg-[#003857] text-white shadow-xs'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>MID &amp; Battery Policy</span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabSelect('brand_logo')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeSubTab === 'brand_logo'
              ? 'bg-[#003857] text-white shadow-xs'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span>Brand &amp; Logo</span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabSelect('hardware')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeSubTab === 'hardware'
              ? 'bg-[#003857] text-white shadow-xs'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Serial Standards &amp; Allocation</span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabSelect('sla')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeSubTab === 'sla'
              ? 'bg-[#003857] text-white shadow-xs'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80'
          }`}
        >
          <Clock className="w-4 h-4 text-sky-500" />
          <span>SLA &amp; Turnaround</span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabSelect('customFields')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeSubTab === 'customFields'
              ? 'bg-[#003857] text-white shadow-xs'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
          <span>Custom &amp; Dynamic Fields</span>
          <span
            className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
              activeSubTab === 'customFields'
                ? 'bg-white/20 text-white'
                : 'bg-emerald-500/15 text-emerald-600'
            }`}
          >
            {currentCustomFields.filter((f) => f.enabled).length} Active
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabSelect('data')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeSubTab === 'data'
              ? 'bg-[#003857] text-white shadow-xs'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Data Backup, Export &amp; Reset</span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabSelect('security')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeSubTab === 'security'
              ? 'bg-[#003857] text-white shadow-xs'
              : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80'
          }`}
        >
          <Lock className="w-4 h-4" />
          <span>Security, Branding &amp; Telegram</span>
        </button>
      </div>

      {/* Main Settings Sections */}
      <div className="space-y-6">
        {/* SUBTAB: Brand & Logo Studio */}
        {activeSubTab === 'brand_logo' && (
          <div className="space-y-6">
            <LogoPageTab
              appSettings={settings}
              onUpdateAppSettings={
                onUpdateAppSettings || ((updater) => onUpdateSettings(updater(settings)))
              }
              triggerToast={onToast || (() => {})}
              addAuditLog={addAuditLog || (() => {})}
              theme={theme}
            />
          </div>
        )}
        {/* SUBTAB 1: Policy */}
        {activeSubTab === 'policy' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Card 1: 15-Digit MID Standard */}
            <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900">
                    15-Digit Merchant ID (MID) Standard
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Mandated 15-digit numeric structure for POS Terminal &amp; KHQR onboarding
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <div className="text-xs font-bold text-zinc-900">
                      Enforce Strict 15-Digit MID Validation
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Disallow submission of any MID that does not contain exactly 15 numeric digits.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.midValidationStrict}
                    onChange={(e) =>
                      setFormState({ ...formState, midValidationStrict: e.target.checked })
                    }
                    className="w-5 h-5 accent-zinc-900 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Institutional MID Prefix (9 Digits)
                  </label>
                  <input
                    type="text"
                    value={formState.midPrefix}
                    onChange={(e) =>
                      setFormState({ ...formState, midPrefix: e.target.value.replace(/\D/g, '').slice(0, 9) })
                    }
                    maxLength={9}
                    placeholder="100000880"
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                  />
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">
                    Formula: {formState.midPrefix} + &lt;3-Digit Branch&gt; + &lt;3-Digit Sequence&gt; = 15 Digits
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900">
                  <span className="font-bold">Standard Specimen Preview:</span>{' '}
                  <span className="font-mono font-extrabold text-zinc-900">
                    {formState.midPrefix}105001
                  </span>{' '}
                  (Branch Code 105 Toul Kork)
                </div>
              </div>
            </div>

            {/* Card 2: 24-Month POS Battery Lifecycle */}
            <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center">
                  <BatteryCharging className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900">
                    24-Month POS Battery Expiry Policy
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Mandatory 24-month replacement cycle for Wizar POS Q2 Pro battery packs
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Max Battery Lifespan (Months)
                    </label>
                    <input
                      type="number"
                      min={12}
                      max={48}
                      value={formState.batteryLifespanMonths}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          batteryLifespanMonths: Number(e.target.value) || 24,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                    <div className="text-[10px] text-slate-400 mt-1">
                      Standard: 24 months (Required change)
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Early Warning Threshold (Months)
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={46}
                      value={formState.batteryWarningMonths}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          batteryWarningMonths: Number(e.target.value) || 21,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                    <div className="text-[10px] text-slate-400 mt-1">
                      Flag &quot;Due Soon&quot; at {formState.batteryWarningMonths} months
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <div className="text-xs font-bold text-zinc-900">
                      Automatic Expiry Alert Notifications
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Send proactive system bell notifications when terminal batteries exceed 24 months.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.autoAlertOnBatteryExpiry}
                    onChange={(e) =>
                      setFormState({
                        ...formState,
                        autoAlertOnBatteryExpiry: e.target.checked,
                      })
                    }
                    className="w-5 h-5 accent-zinc-900 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    POS Battery Serial Standard Prefix
                  </label>
                  <input
                    type="text"
                    value={formState.batterySerialPrefix}
                    onChange={(e) =>
                      setFormState({ ...formState, batterySerialPrefix: e.target.value })
                    }
                    placeholder="160525A"
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                  />
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">
                    Sample SN: {formState.batterySerialPrefix}0005709
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 2: Hardware & Allocation */}
        {activeSubTab === 'hardware' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900">
                    Hardware Serial Standardization
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Serial prefixes and auto-generation format rules
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    POS Terminal Serial Prefix (Wizar POS)
                  </label>
                  <input
                    type="text"
                    value={formState.posSerialPrefix}
                    onChange={(e) =>
                      setFormState({ ...formState, posSerialPrefix: e.target.value })
                    }
                    placeholder="WP5400PQ"
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                  />
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">
                    Specimen: {formState.posSerialPrefix}23200297
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Sound Box Serial Prefix
                  </label>
                  <input
                    type="text"
                    value={formState.soundBoxSerialPrefix}
                    onChange={(e) =>
                      setFormState({ ...formState, soundBoxSerialPrefix: e.target.value })
                    }
                    placeholder="SB-"
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                  />
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">
                    Specimen: {formState.soundBoxSerialPrefix}2026-10501
                  </div>
                </div>
              </div>
            </div>

            <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900">
                    Branch Stock Allocation Controls
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Thresholds and operational governance for branch reserves
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Maximum Reserve Stock per Branch (Units)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={100}
                    value={formState.maxBranchReserveUnits}
                    onChange={(e) =>
                      setFormState({
                        ...formState,
                        maxBranchReserveUnits: Number(e.target.value) || 15,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                  />
                  <div className="text-[10px] text-slate-400 mt-1">
                    Warns branch officers when reserve inventory exceeds {formState.maxBranchReserveUnits} units.
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <div className="text-xs font-bold text-zinc-900">
                      Require Staff Signature &amp; Handover ID
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Mandates officer employee ID record for all merchant deployments.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.requireStaffSignature}
                    onChange={(e) =>
                      setFormState({ ...formState, requireStaffSignature: e.target.checked })
                    }
                    className="w-5 h-5 accent-zinc-900 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB: SLA & Operational Turnaround Targets */}
        {activeSubTab === 'sla' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Card 1: Requisition & Deployment Turnaround SLAs */}
              <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-zinc-900">
                      Stock Dispatch &amp; Merchant Deployment SLAs
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Standard operational turnaround hours from request to live merchant installation
                    </p>
                  </div>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      HQ Stock Request Dispatch SLA (Hours)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={formState.slaStockDispatchHours ?? 24}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          slaStockDispatchHours: Number(e.target.value) || 24,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                      <span>Target time for Head Office Admin to dispatch branch requisitions.</span>
                      <span className="font-mono font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded">
                        Target: &le; {formState.slaStockDispatchHours ?? 24}h
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Merchant On-Site Installation SLA (Hours)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={formState.slaMerchantInstallHours ?? 48}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          slaMerchantInstallHours: Number(e.target.value) || 48,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                      <span>Maximum hours from terminal branch assignment to merchant live activation.</span>
                      <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                        Target: &le; {formState.slaMerchantInstallHours ?? 48}h
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Technical Configuration & Faulty RMA Lifecycle SLAs */}
              <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center justify-center">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-zinc-900">
                      Configuration Stage &amp; RMA Return SLAs
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Technical key injection limits and branch reverse logistics timelines
                    </p>
                  </div>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Technical Configuration Stage Max Time (Hours)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={72}
                      value={formState.slaConfiguringMaxHours ?? 12}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          slaConfiguringMaxHours: Number(e.target.value) || 12,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                      <span>Limit for devices in CONFIGURING stage before automated alert.</span>
                      <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                        Target: &le; {formState.slaConfiguringMaxHours ?? 12}h
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Returned Device to HQ SLA (Days)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={formState.slaRmaReturnDays ?? 7}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          slaRmaReturnDays: Number(e.target.value) || 7,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                      <span>Allowed business days for branches to ship decommissioned units to HQ.</span>
                      <span className="font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                        Target: &le; {formState.slaRmaReturnDays ?? 7} Days
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Proactive SLA Warning & Breach Governance */}
              <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-zinc-900">
                      SLA Warning Threshold &amp; Breach Alerts
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Configure early warning percentage and automated notification triggers
                    </p>
                  </div>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Early Warning Threshold Percentage (%)
                    </label>
                    <input
                      type="number"
                      min={50}
                      max={95}
                      value={formState.slaWarningThresholdPercent ?? 80}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          slaWarningThresholdPercent: Number(e.target.value) || 80,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                    />
                    <div className="text-[10px] text-slate-400 mt-1">
                      Flags yellow status warning when elapsed time reaches {formState.slaWarningThresholdPercent ?? 80}% of target SLA.
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div>
                      <div className="text-xs font-bold text-zinc-900">
                        Enforce Strict SLA Breach Notifications
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Broadcast bell alerts and log tamper-evident audit events when SLA targets are exceeded.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={formState.slaEnforceStrictBreachAlerts ?? true}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          slaEnforceStrictBreachAlerts: e.target.checked,
                        })
                      }
                      className="w-5 h-5 accent-zinc-900 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* Card 4: Institutional SLA Operational Target Scorecard */}
              <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-zinc-900">
                      SLA Governance Target Matrix
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Operational performance matrix across all acquisition lifecycle stages
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="glass-table-thead text-[10px] uppercase font-bold text-white">
                      <tr>
                        <th className="py-2 px-2.5">Operational Stage</th>
                        <th className="py-2 px-2.5">Defined Target</th>
                        <th className="py-2 px-2.5">Warning ({formState.slaWarningThresholdPercent ?? 80}%)</th>
                        <th className="py-2 px-2.5 text-right">Escalation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[11px]">
                      <tr>
                        <td className="py-2 px-2 font-semibold text-zinc-800">HQ Requisition Dispatch</td>
                        <td className="py-2 px-2 font-mono font-bold text-sky-700">&le; {formState.slaStockDispatchHours ?? 24} Hours</td>
                        <td className="py-2 px-2 font-mono text-amber-600">{Math.round((formState.slaStockDispatchHours ?? 24) * ((formState.slaWarningThresholdPercent ?? 80) / 100))} Hours</td>
                        <td className="py-2 px-2 text-right font-medium text-slate-600">Admin Lead</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-2 font-semibold text-zinc-800">Merchant Deployment Live</td>
                        <td className="py-2 px-2 font-mono font-bold text-emerald-700">&le; {formState.slaMerchantInstallHours ?? 48} Hours</td>
                        <td className="py-2 px-2 font-mono text-amber-600">{Math.round((formState.slaMerchantInstallHours ?? 48) * ((formState.slaWarningThresholdPercent ?? 80) / 100))} Hours</td>
                        <td className="py-2 px-2 text-right font-medium text-slate-600">Branch Supervisor</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-2 font-semibold text-zinc-800">Terminal Configuration</td>
                        <td className="py-2 px-2 font-mono font-bold text-indigo-700">&le; {formState.slaConfiguringMaxHours ?? 12} Hours</td>
                        <td className="py-2 px-2 font-mono text-amber-600">{Math.round((formState.slaConfiguringMaxHours ?? 12) * ((formState.slaWarningThresholdPercent ?? 80) / 100))} Hours</td>
                        <td className="py-2 px-2 text-right font-medium text-slate-600">Technical Officer</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-2 font-semibold text-zinc-800">Returned Hardware / HQ Return</td>
                        <td className="py-2 px-2 font-mono font-bold text-amber-700">&le; {formState.slaRmaReturnDays ?? 7} Days</td>
                        <td className="py-2 px-2 font-mono text-amber-600">{((formState.slaRmaReturnDays ?? 7) * ((formState.slaWarningThresholdPercent ?? 80) / 100)).toFixed(1)} Days</td>
                        <td className="py-2 px-2 text-right font-medium text-slate-600">Operations Head</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB: Custom & Dynamic Fields Manager */}
        {activeSubTab === 'customFields' && (
          <div className="space-y-6">
            {/* Top Overview & Action Banner */}
            <div className="surface-card p-5 sm:p-6 rounded-2xl shadow-xs border border-slate-200/80">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
                    <SlidersHorizontal className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-extrabold text-zinc-900">
                        Custom &amp; Dynamic Fields Configuration
                      </h3>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold border border-emerald-200">
                        {currentCustomFields.filter((f) => f.enabled).length} Enabled
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Add, customize, and toggle flexible metadata fields (Location, Phone Number, Store Address, SIM Card, Floor/Booth, etc.) that dynamically populate device lifecycle workflows and merchant records.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleResetToDefaultFields}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 transition cursor-pointer flex items-center gap-1.5"
                    title="Restore standard ABA recommended fields"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restore Defaults</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenAddField()}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-xs transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4 text-emerald-400" />
                    <span>Add Custom Field</span>
                  </button>
                </div>
              </div>

              {/* One-Click Recommended Presets Strip */}
              <div className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>Quick-Add Recommended Attributes</span>
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Click to activate or add instantly
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    {
                      id: 'location',
                      label: 'Store Location / Area',
                      type: 'text' as CustomFieldType,
                      placeholder: 'e.g. Toul Kork / BKK1 / Riverside',
                      description: 'Commercial zone, municipal district, or branch territory.',
                      isSystem: true,
                    },
                    {
                      id: 'merchantPhone',
                      label: 'Merchant Phone Number',
                      type: 'phone' as CustomFieldType,
                      placeholder: 'e.g. 012 888 900',
                      description: 'Direct contact phone number for merchant owner or shop manager.',
                      isSystem: true,
                    },
                    {
                      id: 'address',
                      label: 'Physical Store Address',
                      type: 'text' as CustomFieldType,
                      placeholder: 'e.g. #12, St 315, Sangkat Boeung Kak 1, Phnom Penh',
                      description: 'Detailed street address for field technician on-site maintenance.',
                      isSystem: true,
                    },
                    {
                      id: 'simCarrier',
                      label: 'SIM Card / 4G Carrier',
                      type: 'select' as CustomFieldType,
                      options: ['Smart Axiata (4G)', 'Cellcard (4G)', 'Metfone (4G)', 'Ethernet / Wi-Fi Only'],
                      defaultValue: 'Smart Axiata (4G)',
                      placeholder: 'Select cellular operator',
                      description: 'Cellular network provider provisioned in the POS terminal.',
                      isSystem: false,
          targetTab: modalFieldTargetTab,
                    },
                    {
                      id: 'boothNumber',
                      label: 'Floor / Booth / Stall #',
                      type: 'text' as CustomFieldType,
                      placeholder: 'e.g. 2nd Floor, Kiosk B-14',
                      description: 'Specific booth, mall floor, or market stall identifier.',
                      isSystem: false,
          targetTab: modalFieldTargetTab,
                    },
                    {
                      id: 'merchantTier',
                      label: 'Merchant Tier Category',
                      type: 'select' as CustomFieldType,
                      options: ['VIP Corporate', 'Gold Retail', 'Silver Standard', 'SME Micro'],
                      defaultValue: 'Gold Retail',
                      placeholder: 'Select tier',
                      description: 'Business tier for priority support and SLA dispatch.',
                      isSystem: false,
          targetTab: modalFieldTargetTab,
                    },
                    {
                      id: 'installationContact',
                      label: 'On-site Contact Person',
                      type: 'text' as CustomFieldType,
                      placeholder: 'e.g. Mr. Sokha (Store Supervisor)',
                      description: 'Authorized on-site person to receive and sign for hardware handovers.',
                      isSystem: false,
          targetTab: modalFieldTargetTab,
                    },
                    {
                      id: 'contractId',
                      label: 'Acquiring Contract ID',
                      type: 'text' as CustomFieldType,
                      placeholder: 'e.g. CTR-2026-9920',
                      description: 'Merchant acquiring legal contract reference code.',
                      isSystem: false,
          targetTab: modalFieldTargetTab,
                    },
                  ].map((preset) => {
                    const isExisting = currentCustomFields.find((f) => f.id === preset.id);
                    const isEnabled = isExisting?.enabled;

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleQuickAddPreset(preset)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 cursor-pointer ${
                          isEnabled
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 shadow-2xs'
                            : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                        }`}
                      >
                        {isEnabled ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <PlusCircle className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span>{preset.label}</span>
                        {isEnabled && (
                          <span className="text-[9px] font-mono text-emerald-700 font-bold">
                            Active
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Split Grid: Fields Manager & Live Workflow Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: All Custom Fields List */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Configured Attribute Fields ({currentCustomFields.length})
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Toggle switch to activate/deactivate in forms
                  </div>
                </div>

                <div className="space-y-2.5">
                  {currentCustomFields.map((field) => {
                    const getIcon = () => {
                      if (field.id === 'location') return <MapPin className="w-4 h-4 text-emerald-600" />;
                      if (field.id === 'merchantPhone' || field.type === 'phone')
                        return <Phone className="w-4 h-4 text-sky-600" />;
                      if (field.id === 'address') return <Building2 className="w-4 h-4 text-amber-600" />;
                      if (field.type === 'select') return <Layers className="w-4 h-4 text-purple-600" />;
                      if (field.type === 'number') return <Hash className="w-4 h-4 text-indigo-600" />;
                      if (field.type === 'date') return <CalendarIcon className="w-4 h-4 text-rose-600" />;
                      return <Type className="w-4 h-4 text-slate-600" />;
                    };

                    return (
                      <div
                        key={field.id}
                        className={`p-4 rounded-2xl border transition-all ${
                          field.enabled
                            ? 'surface-card border-slate-200 shadow-xs'
                            : 'bg-slate-50/70 border-slate-200/60 opacity-65'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div
                              className={`p-2.5 rounded-xl border shrink-0 ${
                                field.enabled
                                  ? 'bg-slate-100 border-slate-200'
                                  : 'bg-slate-200/50 border-slate-200'
                              }`}
                            >
                              {getIcon()}
                            </div>

                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-xs font-extrabold text-zinc-900">
                                  {field.label}
                                </h4>
                                <span className="font-mono text-[10px] text-slate-400">
                                  ({field.id})
                                </span>
                                <span className="font-mono text-[9.5px] uppercase font-bold px-1.5 py-0.2 rounded bg-sky-50 text-sky-800 border border-sky-200">
                                  Tab: {field.targetTab || 'all'}
                                </span>
                                <span className="font-mono text-[9.5px] uppercase font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                  {field.type}
                                </span>
                                {field.required ? (
                                  <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200">
                                    Required
                                  </span>
                                ) : (
                                  <span className="text-[9.5px] font-medium px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                                    Optional
                                  </span>
                                )}
                                {field.isSystem && (
                                  <span className="text-[9px] font-semibold text-slate-400 italic">
                                    System Core
                                  </span>
                                )}
                              </div>

                              {field.description && (
                                <p className="text-[11px] text-slate-500 leading-snug">
                                  {field.description}
                                </p>
                              )}

                              {field.type === 'select' && field.options && field.options.length > 0 && (
                                <div className="text-[10px] font-mono text-slate-500 flex flex-wrap items-center gap-1 pt-0.5">
                                  <span className="font-semibold text-slate-400">Options:</span>
                                  {field.options.map((opt, i) => (
                                    <span
                                      key={i}
                                      className="px-1.5 py-0.2 rounded bg-slate-100 border border-slate-200"
                                    >
                                      {opt}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {field.placeholder && (
                                <div className="text-[10px] text-slate-400 font-mono">
                                  Placeholder: "{field.placeholder}"
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Control Toggles & Actions */}
                          <div className="flex items-center gap-2 shrink-0">
                            {/* Required Toggle Button */}
                            <button
                              type="button"
                              onClick={() => handleToggleRequired(field.id)}
                              className={`px-2 py-1 rounded-lg text-[10.5px] font-semibold border transition cursor-pointer ${
                                field.required
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                              title={field.required ? 'Make Optional' : 'Make Mandatory (Required)'}
                            >
                              {field.required ? '* Required' : 'Optional'}
                            </button>

                            {/* Edit Field */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditField(field)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-zinc-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition cursor-pointer"
                              title="Edit field settings"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete Field (Only if non-system) */}
                            {!field.isSystem && (
                              <button
                                type="button"
                                onClick={() => handleDeleteField(field.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition cursor-pointer"
                                title="Delete custom field"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Main Active/Inactive Toggle */}
                            <button
                              type="button"
                              onClick={() => handleToggleField(field.id)}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                field.enabled ? 'bg-[#004953]' : 'bg-slate-300'
                              }`}
                              title={field.enabled ? 'Click to disable' : 'Click to enable'}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                  field.enabled ? 'translate-x-5' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Real-Time Live Form Preview */}
              <div className="lg:col-span-5 space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                    <span>Live Form Simulator</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Technician Experience
                  </span>
                </div>

                <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
                  <div className="p-3 rounded-xl bg-sky-50 text-sky-900 border border-sky-200 text-xs flex items-start gap-2">
                    <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">Workflow Form Preview</div>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        These are the fields currently active for branch technicians and administrators when configuring devices in the Workflow Modal.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 pt-1">
                    {/* Fixed Standard Headers */}
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                        Merchant Name *
                      </label>
                      <input
                        type="text"
                        disabled
                        value="Brown Coffee Toul Kork"
                        className="w-full px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 border border-slate-200 text-slate-700 cursor-not-allowed"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                          Merchant ID (MID) *
                        </label>
                        <input
                          type="text"
                          disabled
                          value="100000880105001"
                          className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-100 border border-slate-200 text-slate-700 cursor-not-allowed"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                          Terminal ID (TID) *
                        </label>
                        <input
                          type="text"
                          disabled
                          value="TID-10501"
                          className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-100 border border-slate-200 text-slate-700 cursor-not-allowed"
                        />
                      </div>
                    </div>

                    {/* Dynamic Active Custom Fields */}
                    <div className="pt-2 border-t border-slate-100 space-y-3">
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 flex items-center justify-between">
                        <span>Active Custom Attributes ({currentCustomFields.filter((f) => f.enabled).length})</span>
                        <span className="text-slate-400 font-normal">Interactive Sandbox</span>
                      </div>

                      {currentCustomFields.filter((f) => f.enabled).length === 0 ? (
                        <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-400">
                          No custom fields are currently enabled. Click on the presets above or toggle fields on the left.
                        </div>
                      ) : (
                        currentCustomFields
                          .filter((f) => f.enabled)
                          .map((field) => {
                            const val = customFieldPreviewValues[field.id] || '';

                            return (
                              <div key={field.id}>
                                <label className="block text-[11px] font-bold text-zinc-800 mb-1 flex items-center justify-between">
                                  <span>
                                    {field.label} {field.required && <span className="text-rose-500">*</span>}
                                  </span>
                                  <span className="font-mono text-[9px] uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">
                                    {field.type}
                                  </span>
                                </label>

                                {field.type === 'select' && field.options && field.options.length > 0 ? (
                                  <select
                                    value={val}
                                    onChange={(e) =>
                                      setCustomFieldPreviewValues((prev: Record<string, string>) => ({
                                        ...prev,
                                        [field.id]: e.target.value,
                                      }))
                                    }
                                    className="w-full px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                                  >
                                    <option value="">-- {field.placeholder || 'Select Option'} --</option>
                                    {field.options.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                ) : field.type === 'date' ? (
                                  <input
                                    type="date"
                                    value={val}
                                    onChange={(e) =>
                                      setCustomFieldPreviewValues((prev: Record<string, string>) => ({
                                        ...prev,
                                        [field.id]: e.target.value,
                                      }))
                                    }
                                    className="w-full px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                                  />
                                ) : field.type === 'number' ? (
                                  <input
                                    type="number"
                                    value={val}
                                    onChange={(e) =>
                                      setCustomFieldPreviewValues((prev: Record<string, string>) => ({
                                        ...prev,
                                        [field.id]: e.target.value,
                                      }))
                                    }
                                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                                    className="w-full px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    value={val}
                                    onChange={(e) =>
                                      setCustomFieldPreviewValues((prev: Record<string, string>) => ({
                                        ...prev,
                                        [field.id]: e.target.value,
                                      }))
                                    }
                                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                                    className="w-full px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                                  />
                                )}

                                {field.description && (
                                  <div className="text-[10px] text-slate-400 mt-0.5 italic">
                                    {field.description}
                                  </div>
                                )}
                              </div>
                            );
                          })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Add / Edit Field Modal */}
            <AnimatePresence>
              {isFieldModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="w-full max-w-2xl rounded-3xl border bg-white border-slate-200 shadow-2xl overflow-hidden text-slate-900"
                  >
                    <div className="px-6 py-4 bg-[#003857] border-b border-white/10 flex items-center justify-between text-white">
                      <div>
                        <h3 className="text-sm font-extrabold">
                          {editingFieldId ? 'Edit Attribute Field' : 'Add New Custom Field'}
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Configure dynamic attributes for hardware inventory and merchant onboarding
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsFieldModalOpen(false)}
                        className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <form onSubmit={handleSaveFieldModal} className="p-6 space-y-4 text-xs">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">
                          Target Table / Tab *
                        </label>
                        <select
                          value={modalFieldTargetTab}
                          onChange={(e) =>
                            setModalFieldTargetTab(
                              e.target.value as 'inventory' | 'merchants' | 'branches' | 'staff' | 'requisitions' | 'all'
                            )
                          }
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-semibold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 cursor-pointer"
                        >
                          <option value="all">All Tables &amp; Workflows (Global)</option>
                          <option value="inventory">Stock Inventory Table &amp; CSV</option>
                          <option value="merchants">Merchant Deployment (360 CRM)</option>
                          <option value="branches">Branch Codes Directory</option>
                          <option value="staff">Staff Directory Table</option>
                          <option value="requisitions">Stock Requests Table</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">
                          Field Label Title *
                        </label>
                        <input
                          type="text"
                          required
                          value={modalFieldLabel}
                          onChange={(e) => {
                            setModalFieldLabel(e.target.value);
                            if (!editingFieldId) {
                              setModalFieldKey(
                                e.target.value
                                  .toLowerCase()
                                  .replace(/[^a-z0-9]/g, '_')
                                  .replace(/^_+|_+$/g, '')
                              );
                            }
                          }}
                          placeholder="e.g. SIM Card ICCID, Floor / Booth #, VIP Tier"
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-semibold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">
                            Field Identifier Key *
                          </label>
                          <input
                            type="text"
                            required
                            disabled={Boolean(editingFieldId && currentCustomFields.find(f => f.id === editingFieldId)?.isSystem)}
                            value={modalFieldKey}
                            onChange={(e) =>
                              setModalFieldKey(
                                e.target.value
                                  .toLowerCase()
                                  .replace(/[^a-z0-9_]/g, '')
                              )
                            }
                            placeholder="e.g. sim_card_iccid"
                            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 disabled:opacity-50 disabled:bg-slate-100"
                          />
                        </div>

                        <div>
                          <label className="block font-bold text-slate-700 mb-1">
                            Data Type *
                          </label>
                          <select
                            value={modalFieldType}
                            onChange={(e) =>
                              setModalFieldType(e.target.value as CustomFieldType)
                            }
                            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-semibold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 cursor-pointer"
                          >
                            <option value="text">Text (Single-Line Input)</option>
                            <option value="phone">Phone Number</option>
                            <option value="number">Numeric Counter</option>
                            <option value="select">Dropdown Select (Options)</option>
                            <option value="date">Calendar Date Picker</option>
                          </select>
                        </div>
                      </div>

                      {modalFieldType === 'select' && (
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">
                            Dropdown Options (Comma-Separated) *
                          </label>
                          <textarea
                            rows={2}
                            required
                            value={modalFieldOptions}
                            onChange={(e) => setModalFieldOptions(e.target.value)}
                            placeholder="Smart Axiata (4G), Cellcard (4G), Metfone (4G), Wi-Fi Only"
                            className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-mono text-xs text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                          />
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Separate choices with commas. Each entry becomes a selectable choice.
                          </p>
                        </div>
                      )}

                      <div>
                        <label className="block font-bold text-slate-700 mb-1">
                          Placeholder Hint
                        </label>
                        <input
                          type="text"
                          value={modalFieldPlaceholder}
                          onChange={(e) => setModalFieldPlaceholder(e.target.value)}
                          placeholder="e.g. Enter 19-digit SIM serial number"
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-slate-700 mb-1">
                          Field Description / Technician Help Note
                        </label>
                        <input
                          type="text"
                          value={modalFieldDescription}
                          onChange={(e) => setModalFieldDescription(e.target.value)}
                          placeholder="e.g. Printed ICCID on SIM card tray inside battery bay"
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="checkbox"
                          id="modal-field-required"
                          checked={modalFieldRequired}
                          onChange={(e) => setModalFieldRequired(e.target.checked)}
                          className="w-4 h-4 accent-zinc-900 cursor-pointer"
                        />
                        <label
                          htmlFor="modal-field-required"
                          className="font-bold text-slate-800 cursor-pointer select-none"
                        >
                          Mark as Mandatory (Required Field before device lifecycle updates)
                        </label>
                      </div>

                      <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                        <button
                          type="button"
                          onClick={() => setIsFieldModalOpen(false)}
                          className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-5 py-2 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white shadow-sm transition cursor-pointer"
                        >
                          {editingFieldId ? 'Save Changes' : 'Activate Custom Field'}
                        </button>
                      </div>
                    </form>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* SUBTAB 4: Data Backup, Export & Reset */}
        {activeSubTab === 'data' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center justify-center">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900">
                    Backup &amp; Snapshot Export
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Export full application state, historical merchants, serial ledger &amp; audit trails
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Generates a JSON snapshot containing all live POS Terminals, Sound Boxes, 15-digit MIDs, 24-month battery records, historical merchant return logs, and IAM branch staff.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onExportBackup}
                  className="px-4 py-2.5 rounded-xl bg-[#003857] hover:bg-[#002a42] text-white text-xs font-semibold tracking-wide shadow-sm flex items-center gap-2 transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Complete JSON Backup</span>
                </button>
              </div>
            </div>

            <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900">
                    Browser Cache &amp; Instant Loading Acceleration
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Local IndexedDB &amp; Service Worker accelerate startup load time from seconds to ~10ms
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Hydration Engine</span>
                  <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    IndexedDB Stale-While-Revalidate
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Asset Caching</span>
                  <span className="text-xs font-bold text-slate-700">
                    Service Worker (Cache-First)
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Startup Latency</span>
                  <span className="text-xs font-mono font-bold text-cyan-600">
                    &lt; 25ms (Instant UI)
                  </span>
                </div>
              </div>
            </div>

            <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900">
                    System Restore &amp; Factory Reset
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {sharedDatabase
                      ? 'The stock is kept in the shared database. Files cannot overwrite it; clearing affects this browser only.'
                      : 'Restore from a backup file or clear the data kept in this browser (local preview).'}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {!sharedDatabase && <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Restore From JSON Backup File
                  </label>
                  <label className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer">
                    <Upload className="w-4 h-4 text-zinc-700" />
                    <span>Select Backup File (.json)</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleFileImport}
                      className="hidden"
                    />
                  </label>
                </div>}

                <div className="pt-2 border-t border-slate-100">
                  <div className="text-xs font-bold text-rose-700 mb-1">
                    {sharedDatabase ? 'Clear This Browser' : 'Clear Local Preview Data'}
                  </div>
                  <p className="text-[11px] text-slate-500 mb-2">
                    {sharedDatabase
                      ? 'Removes the settings and copies kept in this browser and reloads from the server. Nothing on the server is changed.'
                      : 'Removes everything this browser keeps for the preview (devices, requests, history, settings) and loads the sample data again.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsResetConfirmOpen(true)}
                    className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 text-xs font-semibold tracking-wide transition cursor-pointer"
                  >
                    {sharedDatabase ? 'Clear This Browser' : 'Clear Local Data'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* SUBTAB 4: Security, Branding & Telegram Multi-Group Routing */}
        {activeSubTab === 'security' && (
          <div className="space-y-6 w-full max-w-7xl">
            {/* Top Card: Security, Session & Institution Branding */}
            <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-zinc-900 border border-slate-200 flex items-center justify-center">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-zinc-900">
                    Security, Session &amp; Institution Branding
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Session lock timers, review scope, and institutional identity
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Institution Branding Title
                  </label>
                  <input
                    type="text"
                    value={formState.bankInstitutionName}
                    onChange={(e) =>
                      setFormState({ ...formState, bankInstitutionName: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900 focus:bg-white focus:border-[#003857] transition"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Session Auto-Lock Timeout
                  </label>
                  <select
                    value={formState.sessionTimeoutMinutes}
                    onChange={(e) =>
                      setFormState({
                        ...formState,
                        sessionTimeoutMinutes: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs font-semibold border outline-none bg-slate-50 border-slate-200 text-zinc-900 focus:bg-white focus:border-[#003857] transition"
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes (Recommended)</option>
                    <option value={60}>60 Minutes</option>
                    <option value={120}>2 Hours</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Phone App Review: Staff Shown
                  </label>
                  <select
                    value={formState.phoneReviewScope || 'ALL'}
                    onChange={(e) =>
                      setFormState({ ...formState, phoneReviewScope: e.target.value as 'PHNOM_PENH' | 'ALL' })
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs font-semibold border outline-none bg-slate-50 border-slate-200 text-zinc-900 focus:bg-white focus:border-[#003857] transition"
                  >
                    <option value="ALL">Phnom Penh and Regional staff</option>
                    <option value="PHNOM_PENH">Phnom Penh staff only</option>
                  </select>
                  <p className="mt-1 text-[10.5px] text-slate-500">Only affects which staff appear in mobile review list.</p>
                </div>
              </div>
            </div>

            {/* TWO-COLUMN TELEGRAM DASHBOARD: Bot Config on Left, Regional Groups on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* LEFT COLUMN: Telegram Bot Alert Config & Default Group */}
              <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                  <div className="w-8 h-8 rounded-lg bg-sky-50 text-[#003857] border border-sky-200 flex items-center justify-center">
                    <Send className="w-4 h-4 text-sky-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-zinc-900">
                      Telegram Bot Connection
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Bot credentials &amp; Default Group for app push alerts
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold uppercase text-slate-600">
                        1. Telegram Bot Token (@BotFather)
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowBotFatherGuide((prev) => !prev)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#003857] hover:underline cursor-pointer"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        {showBotFatherGuide ? 'Hide Token Guide' : 'Where is my Bot Token?'}
                      </button>
                    </div>

                    {showBotFatherGuide && (
                      <div className="mb-2.5 p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-950 text-xs space-y-2">
                        <div className="font-bold text-sky-900 flex items-center justify-between">
                          <span>How to find your Bot Token in Telegram:</span>
                          <span className="text-[10px] text-sky-600 font-normal">Takes ~30 seconds</span>
                        </div>
                        <ol className="list-decimal list-inside space-y-1.5 text-[11px] leading-relaxed text-slate-700">
                          <li>
                            Open Telegram Desktop (or Mobile) and search for{' '}
                            <strong className="text-zinc-900 font-mono">@BotFather</strong>.
                          </li>
                          <li>
                            Send command{' '}
                            <code className="px-1.5 py-0.5 rounded bg-white border border-sky-300 font-mono font-bold text-zinc-900">
                              /mybots
                            </code>{' '}
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText('/mybots');
                                if (onToast) onToast('Copied "/mybots" to clipboard!');
                              }}
                              className="px-2 py-0.5 rounded bg-[#003857] text-white text-[10px] font-bold hover:bg-[#002a42] cursor-pointer inline-flex items-center gap-1"
                            >
                              <Copy className="w-3 h-3" />
                              Copy
                            </button>
                          </li>
                          <li>
                            Click on your bot: <strong className="text-zinc-900 font-mono">@POS_SoundBox_Config_bot</strong>
                          </li>
                          <li>
                            Click <strong className="text-zinc-900">API Token</strong> to copy the token string.
                          </li>
                        </ol>
                        <div className="pt-1.5 border-t border-sky-200/80 text-[10.5px] text-slate-600">
                          <em>Need a new bot?</em> Send <code className="px-1 py-0.5 bg-white rounded border font-mono font-bold">/newbot</code> to @BotFather.
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showBotToken ? 'text' : 'password'}
                          value={tgBotToken}
                          onChange={(e) => setTgBotToken(e.target.value)}
                          placeholder="e.g. 7123456789:AAF-xyz1234567890abcdef..."
                          className="w-full px-3 py-2 pr-9 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900 focus:bg-white focus:border-[#003857] transition"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBotToken((prev) => !prev)}
                          title={showBotToken ? 'Hide Bot Token' : 'Show Bot Token'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={!tgBotToken.trim() || tgDetecting}
                        onClick={async () => {
                          setTgDetecting(true);
                          setTgDetectError('');
                          const res = await detectTelegramGroupChats(tgBotToken);
                          setTgDetecting(false);
                          if (!res.ok) {
                            setTgDetectError(res.error || 'Invalid Bot Token.');
                            if (onToast) onToast(res.error || 'Invalid Bot Token.');
                            return;
                          }
                          setTgBotUsername(res.botUsername);
                          saveTelegramBotUsername(res.botUsername);
                          setTgDetectedChats((prev) => {
                            const map = new Map<string, { id: string; title: string; type: string }>();
                            res.chats.forEach((c) => map.set(c.id, c));
                            prev.forEach((c) => {
                              if (!map.has(c.id)) map.set(c.id, c);
                            });
                            const merged = Array.from(map.values());
                            saveTelegramDetectedChats(merged);
                            return merged;
                          });
                          if (res.chats.length === 0) {
                            const cmd = res.botUsername ? `/start@${res.botUsername}` : '/start';
                            setTgDetectError(
                              `Bot @${res.botUsername} is verified! Because Telegram hides normal group messages from new bots, please type "${cmd}" inside your Telegram group (or make @${res.botUsername} a group admin), then click Auto-Detect again.`
                            );
                            if (onToast) {
                              onToast(`Bot @${res.botUsername} verified! Send "${cmd}" inside your Telegram group, then click Auto-Detect again.`);
                            }
                            return;
                          }
                          const picked = res.chats[0];
                          const cleanToken = tgBotToken.trim().replace(/^["']|["']$/g, '').replace(/^bot/i, '');
                          const builtWebhook = `https://api.telegram.org/bot${cleanToken}/sendMessage?chat_id=${encodeURIComponent(picked.id)}`;
                          setTgConfigChatId(picked.id);
                          setTgWebhookUrl(builtWebhook);
                          saveTelegramWebhookConfig({
                            botToken: cleanToken,
                            configChatId: picked.id,
                            chatId: picked.id,
                            webhookUrl: builtWebhook,
                          });
                          if (onToast) {
                            onToast(`Connected to "${picked.title}" (${picked.id}) and sent a confirmation message to Telegram!`);
                          }
                        }}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer transition disabled:opacity-40 whitespace-nowrap shadow-2xs"
                      >
                        {tgDetecting ? 'Detecting...' : 'Auto-Detect Group ID'}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Add your bot to the group, send <code>/start</code> in the group (or make bot admin), then click <strong>Auto-Detect Group ID</strong>.
                    </p>

                    {tgDetectError && (
                      <div className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-2">
                        <div className="font-semibold">{tgDetectError}</div>
                        {tgBotUsername && (
                          <div className="flex flex-wrap items-center gap-2">
                            <code className="px-2 py-1 rounded bg-white border border-amber-300 font-mono font-bold text-zinc-900">
                              /start@{tgBotUsername}
                            </code>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(`/start@${tgBotUsername}`);
                                if (onToast) onToast(`Copied "/start@${tgBotUsername}" — paste and send it in your Telegram group!`);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-[#003857] text-white text-[11px] font-bold cursor-pointer"
                            >
                              Copy Command
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {tgDetectedChats.length > 0 && (
                      <div className="mt-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold flex items-center gap-1.5 min-w-0 truncate">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="truncate">
                              Connected Bot {tgBotUsername ? `@${tgBotUsername}` : ''} — Detected Telegram Chats ({tgDetectedChats.length}):
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleClearAllDetectedChats}
                            className="text-[11px] font-medium text-slate-500 hover:text-red-600 underline cursor-pointer shrink-0 transition"
                            title="Remove all detected chats from system"
                          >
                            Remove All
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          {tgDetectedChats.map((c) => {
                            const isCurrentActive = tgConfigChatId === c.id;
                            return (
                              <div
                                key={c.id}
                                className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg border transition ${
                                  isCurrentActive
                                    ? 'bg-emerald-700 border-emerald-800 text-white shadow-2xs font-semibold'
                                    : 'bg-white border-emerald-300 text-emerald-900 hover:bg-emerald-100/80'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    const cleanToken = tgBotToken.trim().replace(/^["']|["']$/g, '').replace(/^bot/i, '');
                                    const builtWebhook = `https://api.telegram.org/bot${cleanToken}/sendMessage?chat_id=${encodeURIComponent(c.id)}`;
                                    setTgConfigChatId(c.id);
                                    setTgWebhookUrl(builtWebhook);
                                    saveTelegramWebhookConfig({
                                      botToken: cleanToken,
                                      configChatId: c.id,
                                      chatId: c.id,
                                      webhookUrl: builtWebhook,
                                    });
                                    if (onToast) onToast(`Selected "${c.title}" (${c.id})`);
                                  }}
                                  className="text-left font-mono text-[11px] cursor-pointer flex items-center gap-1.5"
                                  title="Click to select this group as default"
                                >
                                  {isCurrentActive && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                                  <span className="truncate max-w-[160px]">{c.title}</span>
                                  <span className={isCurrentActive ? 'text-emerald-200 text-[10px]' : 'text-slate-500 text-[10px]'}>
                                    ({c.id})
                                  </span>
                                  <span
                                    className={`text-[9px] px-1 py-0.5 rounded font-sans uppercase ${
                                      isCurrentActive ? 'bg-emerald-800/80 text-white' : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {c.type}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveDetectedChat(c.id);
                                  }}
                                  title={`Remove "${c.title}" (${c.id}) from system`}
                                  className={`p-1 rounded-md transition cursor-pointer ${
                                    isCurrentActive
                                      ? 'hover:bg-emerald-800 text-emerald-200 hover:text-white'
                                      : 'hover:bg-red-50 text-slate-400 hover:text-red-600'
                                  }`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold uppercase text-slate-600">
                        2. Default Staff Telegram Group Chat ID
                      </label>
                      <div className="flex items-center gap-2">
                        {tgConfigChatId && (
                          <button
                            type="button"
                            onClick={handleClearDefaultGroup}
                            className="text-[10.5px] font-medium text-red-600 hover:text-red-700 hover:underline cursor-pointer inline-flex items-center gap-0.5 transition"
                            title="Remove default connected group"
                          >
                            <X className="w-3 h-3" />
                            <span>Remove Group</span>
                          </button>
                        )}
                        <span className="text-[10px] text-slate-500 font-mono">
                          Fallback: <strong>-5428585935</strong>
                        </span>
                      </div>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        value={tgConfigChatId}
                        onChange={(e) => setTgConfigChatId(e.target.value)}
                        placeholder="e.g. -5428585935 or -1005428585935"
                        className="w-full px-3 py-2 pr-9 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900 focus:bg-white focus:border-[#003857] transition"
                      />
                      {tgConfigChatId && (
                        <button
                          type="button"
                          onClick={handleClearDefaultGroup}
                          title="Clear / Remove connected group"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-red-600 transition cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Used when a device&apos;s branch is not assigned to any regional group on the right. Supports regular (<code>-5428585935</code>) and supergroup (<code>-1005428585935</code>) IDs.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      3. Optional Custom Webhook URL
                    </label>
                    <input
                      type="text"
                      value={tgWebhookUrl}
                      onChange={(e) => setTgWebhookUrl(e.target.value)}
                      placeholder="Leave blank to use direct Bot Token above"
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono border outline-none bg-slate-50 border-slate-200 text-zinc-900 focus:bg-white focus:border-[#003857] transition"
                    />
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={tgTesting || !tgBotToken.trim()}
                        onClick={async () => {
                          saveTelegramWebhookConfig({
                            botToken: tgBotToken,
                            configChatId: tgConfigChatId,
                            chatId: tgConfigChatId,
                            webhookUrl: tgWebhookUrl,
                          });
                          setTgTesting(true);
                          const res = await sendDeviceConfigTelegramAlert({
                            serial: 'SN-TEST-0001',
                            type: 'POS Terminal',
                            model: 'Wizar POS Q2 Pro',
                            mid: '200000000012345',
                            tid: 'TID-10001',
                            merchantName: 'Test Merchant (Default Group)',
                            branchId: '100',
                            branchName: 'Head Office',
                            staff: 'Assigned POS Officer',
                            actor: 'System Admin',
                          });
                          setTgTesting(false);
                          if (onToast) {
                            if (res.ok) {
                              if (res.resolvedChatId && res.resolvedChatId !== tgConfigChatId) {
                                setTgConfigChatId(res.resolvedChatId);
                              }
                              onToast(`Sent test alert to Default Group (${res.resolvedChatId || tgConfigChatId})! Check your Telegram.`);
                            } else {
                              onToast(`Telegram Alert failed: ${res.error || 'Check Bot Token & Group Chat ID'}`);
                            }
                          }
                        }}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold bg-[#003857] hover:bg-[#002a42] text-white cursor-pointer transition disabled:opacity-50 shadow-xs inline-flex items-center gap-2"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{tgTesting ? 'Sending Test...' : 'Test Default Group Alert'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          saveTelegramWebhookConfig({
                            botToken: tgBotToken,
                            configChatId: tgConfigChatId,
                            chatId: tgConfigChatId,
                            webhookUrl: tgWebhookUrl,
                            regionalGroups,
                          });
                          if (tgBotUsername) saveTelegramBotUsername(tgBotUsername);
                          if (tgDetectedChats.length > 0) saveTelegramDetectedChats(tgDetectedChats);
                          if (onToast) onToast('Telegram bot configuration saved!');
                        }}
                        className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer transition inline-flex items-center gap-1.5"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Save Bot Config</span>
                      </button>
                    </div>

                    {(tgBotToken || tgConfigChatId || tgWebhookUrl || tgDetectedChats.length > 0) && (
                      <button
                        type="button"
                        onClick={() => setIsDeleteConnectionModalOpen(true)}
                        className="px-3.5 py-2.5 rounded-xl text-xs font-bold border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 cursor-pointer transition inline-flex items-center gap-1.5"
                        title="Delete Telegram connection and remove all linked groups from system"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Connection</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Regional Telegram Groups (Multi-Group Routing) */}
              <div className="surface-card p-5 rounded-2xl shadow-xs border border-slate-200/80 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-extrabold text-zinc-900 truncate">
                          Regional Telegram Groups
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 shrink-0">
                          {regionalGroups.length} Active
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        Multi-Group push routing by branch
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingRegionalGroup(null);
                      setRgName('');
                      setRgChatId(tgConfigChatId || '-5428585935');
                      setRgBranchCodes([]);
                      setIsRegionalModalOpen(true);
                    }}
                    className="px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-2xs shrink-0 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Regional Group</span>
                  </button>
                </div>

                <div className="space-y-3">
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Assign separate Telegram group chats for different regional teams (e.g. Phnom Penh, Siem Reap, Battambang). Daily high-volume app push alerts (~200 units) will automatically route only to each team&apos;s respective Telegram group!
                  </p>

                  {/* List of Configured Regional Groups */}
                  <div className="space-y-2.5">
                    {regionalGroups.length === 0 ? (
                      <div className="p-6 rounded-2xl border-2 border-dashed border-slate-200 text-center space-y-2 bg-slate-50/50">
                        <Users className="w-8 h-8 text-slate-300 mx-auto" />
                        <div className="text-xs font-bold text-slate-700">No Regional Groups Configured</div>
                        <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                          Alerts will route to your Default Staff Telegram Group ({tgConfigChatId || '-5428585935'}). Add regional groups to route alerts separately to each branch team.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRegionalGroup(null);
                            setRgName('');
                            setRgChatId(tgConfigChatId || '-5428585935');
                            setRgBranchCodes([]);
                            setIsRegionalModalOpen(true);
                          }}
                          className="mt-1 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Configure First Regional Group</span>
                        </button>
                      </div>
                    ) : (
                      regionalGroups.map((rg) => {
                        const assignedBranchNames = (branches || [])
                          .filter((b) => rg.branchCodes.includes(b.code))
                          .map((b) => `Code ${b.code} (${b.name})`);

                        return (
                          <div
                            key={rg.id}
                            className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white hover:border-slate-300 transition space-y-2 text-zinc-900"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                              <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-black text-[#003857]">{rg.name}</span>
                                  <span className="px-2 py-0.5 rounded-md font-mono text-[10.5px] font-bold bg-white border border-slate-200 text-slate-700">
                                    {rg.chatId}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                    {rg.branchCodes.length} Branch{rg.branchCodes.length === 1 ? '' : 'es'}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {/* Quick Test Alert Button */}
                                <button
                                  type="button"
                                  disabled={rgTestingId === rg.id}
                                  onClick={async () => {
                                    setRgTestingId(rg.id);
                                    const testBranch = rg.branchCodes[0] || '100';
                                    const bObj = (branches || []).find((b) => b.code === testBranch);
                                    const res = await sendDeviceConfigTelegramAlert({
                                      serial: `SN-TEST-${rg.name.slice(0, 3).toUpperCase()}-01`,
                                      type: 'POS Terminal',
                                      model: 'Wizar POS Q2 Pro',
                                      mid: '200000000088888',
                                      tid: 'TID-REGIONAL',
                                      merchantName: `Test Merchant (${rg.name})`,
                                      branchId: testBranch,
                                      branchName: bObj ? bObj.name : `Branch ${testBranch}`,
                                      staff: `${rg.name} Officer`,
                                      actor: 'System Admin',
                                      targetChatId: rg.chatId,
                                      targetGroupName: rg.name,
                                    });
                                    setRgTestingId(null);
                                    if (onToast) {
                                      if (res.ok) {
                                        onToast(`Sent test alert directly to "${rg.name}" (${rg.chatId})! Check the Telegram group.`);
                                      } else {
                                        onToast(`Failed to ping ${rg.name}: ${res.error || 'Check Chat ID'}`);
                                      }
                                    }
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-white text-slate-700 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                                  title={`Send a test notification to ${rg.name}`}
                                >
                                  <Send className="w-3 h-3 text-[#003857]" />
                                  <span>{rgTestingId === rg.id ? 'Sending...' : 'Test Group'}</span>
                                </button>

                                {/* Edit Button */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingRegionalGroup(rg);
                                    setRgName(rg.name);
                                    setRgChatId(rg.chatId);
                                    setRgBranchCodes([...rg.branchCodes]);
                                    setIsRegionalModalOpen(true);
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 cursor-pointer transition"
                                  title="Edit Regional Group"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>

                                {/* Delete Button */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = regionalGroups.filter((x) => x.id !== rg.id);
                                    setRegionalGroups(updated);
                                    saveTelegramRegionalGroups(updated);
                                    onUpdateSettings({ ...formState, telegramRegionalGroups: updated });
                                    if (onToast) onToast(`Removed "${rg.name}"`);
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-600 cursor-pointer transition"
                                  title="Delete Regional Group"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Assigned Branches Tags */}
                            <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                              <Building2 className="w-3 h-3 text-slate-400 shrink-0 mr-0.5" />
                              {assignedBranchNames.length > 0 ? (
                                assignedBranchNames.map((bName, i) => (
                                  <span
                                    key={i}
                                    className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10.5px] text-slate-700 font-medium"
                                  >
                                    {bName}
                                  </span>
                                ))
                              ) : (
                                <span className="italic text-slate-400 text-[10.5px]">No branches mapped yet (uses default chat)</span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal to Add / Edit Regional Group */}
      {isRegionalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border p-6 shadow-2xl bg-white border-slate-200 text-slate-900 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-[#003857]">
                <Users className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-extrabold text-zinc-900">
                  {editingRegionalGroup ? 'Edit Regional Telegram Group' : 'Add Regional Telegram Group'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRegionalModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Regional Team Name *
                </label>
                <input
                  type="text"
                  value={rgName}
                  onChange={(e) => setRgName(e.target.value)}
                  placeholder="e.g. Phnom Penh Team, Siem Reap Operations, Battambang..."
                  className="w-full px-3 py-2 rounded-xl text-xs font-semibold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold uppercase text-slate-600">
                    Telegram Group Chat ID *
                  </label>
                  {tgConfigChatId && (
                    <button
                      type="button"
                      onClick={() => setRgChatId(tgConfigChatId)}
                      className="text-[10.5px] text-[#003857] hover:underline cursor-pointer"
                    >
                      Use default ID ({tgConfigChatId})
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={rgChatId}
                  onChange={(e) => setRgChatId(e.target.value)}
                  placeholder="e.g. -5428585935 or -100xxxxxxxxxx"
                  className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold border outline-none bg-slate-50 border-slate-200 text-zinc-900"
                />
                {tgDetectedChats.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">Quick pick detected chat:</span>
                    {tgDetectedChats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setRgChatId(c.id)}
                        className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100 cursor-pointer"
                      >
                        {c.title} ({c.id})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Assign Branches to this Regional Group
                </label>
                <p className="text-[10.5px] text-slate-500 mb-2">
                  Devices configured for these branches will automatically send their push notification to this Telegram group.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 rounded-xl bg-slate-50 border border-slate-200">
                  {(branches || []).map((b) => {
                    const isChecked = rgBranchCodes.includes(b.code);
                    return (
                      <label
                        key={b.code}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition ${
                          isChecked
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRgBranchCodes((prev) => [...prev, b.code]);
                            } else {
                              setRgBranchCodes((prev) => prev.filter((c) => c !== b.code));
                            }
                          }}
                          className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                        />
                        <span className="truncate">
                          Code <strong>{b.code}</strong> — {b.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsRegionalModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rgName.trim() || !rgChatId.trim()}
                onClick={() => {
                  const newGroup: TelegramRegionalGroup = {
                    id: editingRegionalGroup ? editingRegionalGroup.id : `rg-${Date.now()}`,
                    name: rgName.trim(),
                    chatId: rgChatId.trim(),
                    branchCodes: rgBranchCodes,
                  };
                  const updated = editingRegionalGroup
                    ? regionalGroups.map((x) => (x.id === editingRegionalGroup.id ? newGroup : x))
                    : [...regionalGroups, newGroup];

                  setRegionalGroups(updated);
                  saveTelegramRegionalGroups(updated);
                  onUpdateSettings({ ...formState, telegramRegionalGroups: updated });
                  setIsRegionalModalOpen(false);
                  if (onToast) onToast(`Saved Regional Telegram Group: "${newGroup.name}"`);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-40 shadow-xs"
              >
                {editingRegionalGroup ? 'Update Regional Group' : 'Add Regional Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Telegram Connection Confirmation Dialog */}
      {isDeleteConnectionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border p-6 shadow-2xl bg-white border-slate-200 text-slate-900 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-zinc-900">
                  Delete Telegram Connection?
                </h3>
                <p className="text-xs text-slate-500">
                  Disconnect bot and wipe configuration
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              This action will delete the Bot Token, default group ID, custom webhook URL, and remove all {tgDetectedChats.length} connected/detected groups from the system.
            </p>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
              <strong>Notice:</strong> Push notifications will be recorded in the in-app audit history until a new Telegram bot is configured.
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsDeleteConnectionModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConnection}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold tracking-wide cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirm &amp; Delete Connection</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border p-6 shadow-2xl bg-white border-slate-200 text-slate-900 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-black text-zinc-900">
                {sharedDatabase ? 'Clear this browser?' : 'Clear local preview data?'}
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {sharedDatabase
                ? 'Your settings and any copies kept in this browser are removed and the page reloads from the server. The stock, requests and merchant history on the server are not changed.'
                : 'Everything this browser keeps for the preview is removed and the sample data is loaded again. This cannot be undone; export a backup first if you need it.'}
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onResetData) onResetData();
                  setIsResetConfirmOpen(false);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold tracking-wide cursor-pointer"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
