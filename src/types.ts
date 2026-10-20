export type LifecycleStage =
  | 'HQ_STOCK'
  | 'BRANCH_RESERVE'
  | 'CONFIGURING'
  | 'COMPLETE'
  | 'FAULTY'
  | 'LOST';

export const STAGE_ORDER: LifecycleStage[] = [
  'HQ_STOCK',
  'BRANCH_RESERVE',
  'CONFIGURING',
  'COMPLETE',
  'FAULTY',
  'LOST',
];

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'BRANCH';

export type UserStatus = 'Operating' | 'Pending' | 'Suspended';

export type ThemeMode = 'light' | 'dark';

export interface User {
  uid: string;
  empId: string;
  name: string;
  label: string;
  accessRole: UserRole;
  branchId: string;
  branchName: string;
  position: string;
  contact: string;
  status: UserStatus;
  updatedAt: string;
  username?: string;
}

export interface Device {
  serial: string;
  batterySerial?: string;
  batteryInstalledDate?: string;
  type: 'POS Terminal' | 'Sound Box';
  model: string;
  stockInDate: string;
  branchId: string;
  branchName: string;
  staff: string;
  stage: LifecycleStage;
  deploymentStatus: string;
  stockStatus: string;
  mid: string;
  tid: string;
  merchantName: string;
  merchantPhone: string;
  location: string;
  address: string;
  deployedDate: string;
  installedByStaff?: string; // Original field installation officer
  replacedByStaff?: string; // Replacement / swap officer (if hardware unit was replaced)
  returnedByStaff?: string; // Officer who decommissioned / retrieved / returned the device
  returnedDate?: string; // Date when device was returned/decommissioned
  replacementDate?: string;
  replacedFromSerial?: string;
  returnReason: string;
  redeployCount: number;
  hoursInStage: number;
  updatedAt: string;
  note: string;
  history: string[];
  archived?: boolean;
  integrityHash?: string;
  customFields?: Record<string, string>;
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  category: 'REQUEST' | 'SYNC' | 'SECURITY' | 'HEALTH' | 'STOCK';
  timestamp: string;
  read: boolean;
  branchId?: string;
  targetTab?: string;
}

export interface BatteryLifecycleStatus {
  installedDate: string;
  dueDate: string;
  monthsUsed: number;
  monthsRemaining: number;
  lifePercent: number;
  state: 'HEALTHY' | 'DUE_SOON' | 'EXPIRED';
  label: string;
}

export function isValid15DigitMid(mid: string): boolean {
  return /^\d{15}$/.test(mid.trim());
}

export function formatTo15DigitMid(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.slice(0, 15);
}

export function generate15DigitMid(branchId: string = '101', seq: number = 1): string {
  const cleanBranch = branchId.replace(/\D/g, '').padStart(3, '0').slice(-3);
  const cleanSeq = String(seq).padStart(3, '0').slice(-3);
  return `100000880${cleanBranch}${cleanSeq}`;
}

export function getBatteryLifecycleStatus(
  device: Pick<Device, 'batteryInstalledDate' | 'stockInDate' | 'deployedDate'>,
  referenceDateStr = new Date().toISOString().split('T')[0]
): BatteryLifecycleStatus {
  const installedStr =
    device.batteryInstalledDate || device.stockInDate || device.deployedDate || '2025-10-18';

  const refYear = +referenceDateStr.slice(0, 4) || 2026;
  const refMonth = +referenceDateStr.slice(5, 7) || 10;
  const refDay = +referenceDateStr.slice(8, 10) || 18;

  const instYear = +installedStr.slice(0, 4) || 2025;
  const instMonth = +installedStr.slice(5, 7) || 10;
  const instDay = +installedStr.slice(8, 10) || 18;

  const rawMonths =
    (refYear - instYear) * 12 + (refMonth - instMonth) + (refDay >= instDay ? 0 : -1);
  const monthsUsed = Math.max(0, rawMonths);
  const monthsRemaining = Math.max(0, 24 - monthsUsed);
  const lifePercent = Math.max(0, Math.min(100, Math.round(((24 - monthsUsed) / 24) * 100)));

  const dueYear = instYear + 2;
  const dueDate = `${dueYear}-${String(instMonth).padStart(2, '0')}-${String(instDay).padStart(2, '0')}`;

  // 24 Months Expiration Policy for POS Terminal batteries
  if (monthsUsed >= 24) {
    return {
      installedDate: installedStr,
      dueDate,
      monthsUsed,
      monthsRemaining: 0,
      lifePercent: 0,
      state: 'EXPIRED',
      label: `Battery Expired — 24M Change Required (${monthsUsed}/24m)`,
    };
  }
  if (monthsUsed >= 21) {
    return {
      installedDate: installedStr,
      dueDate,
      monthsUsed,
      monthsRemaining,
      lifePercent,
      state: 'DUE_SOON',
      label: `Due for 24M Change (${monthsUsed}/24m · ${monthsRemaining}m left)`,
    };
  }
  return {
    installedDate: installedStr,
    dueDate,
    monthsUsed,
    monthsRemaining,
    lifePercent,
    state: 'HEALTHY',
    label: `Active (${monthsUsed}/24m · ${monthsRemaining}m left)`,
  };
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  staff: string[];
  staffDetails?: User[];
}

export interface ArrangedDeviceItem {
  serial: string;
  batterySerial: string;
  type: 'POS Terminal' | 'Sound Box';
  model: string;
}

export interface Requisition {
  reqId: string;
  date: string;
  branchId: string;
  branchName: string;
  staff: string;
  posQty: number;
  sbQty: number;
  reason: string;
  status: 'PENDING_ADMIN' | 'DISPATCHED' | 'RECEIVED';
  arrangedDevices?: ArrangedDeviceItem[];
}

export interface StageInfo {
  label: string;
  badgeClassLight: string;
  badgeClassDark: string;
  short: string;
  color: string;
}

export interface MerchantProfile {
  mid: string;
  merchantName: string;
  merchantPhone: string;
  address: string;
  location: string;
  branchId: string;
  branchName: string;
  accountOfficer: string;
  devices: Device[];
  posCount: number;
  sbCount: number;
  liveCount: number;
  pendingCount: number;
  faultyCount: number;
  crmStatus: 'ACTIVE' | 'ONBOARDING' | 'ATTENTION';
  updatedAt: string;
}

export interface MobileInstallSyncPayload {
  eventId?: string;
  serial: string;
  stage: LifecycleStage;
  mid: string;
  tid: string;
  merchantName: string;
  merchantPhone?: string;
  address?: string;
  location?: string;
  installerStaff: string;
  branchId?: string;
  note?: string;
  source?: 'MOBILE_APP_WEBHOOK' | 'COMPANION_SIMULATOR';
}

export interface MobileWebhookEvent {
  eventId: string;
  timestamp: string;
  serial: string;
  previousStage?: LifecycleStage;
  newStage: LifecycleStage;
  mid: string;
  tid: string;
  merchantName: string;
  merchantPhone: string;
  address: string;
  installerStaff: string;
  branchId: string;
  note: string;
  source: 'MOBILE_APP_WEBHOOK' | 'COMPANION_SIMULATOR';
  status: 'APPLIED' | 'QUEUED';
}

export interface HistoricalMerchantRecord {
  recordId: string;
  merchantName: string;
  merchantPhone: string;
  address: string;
  mid: string; // 15-Digit MID
  tid: string;
  deviceType: 'POS Terminal' | 'Sound Box';
  model: string;
  serial: string;
  batterySerial?: string;
  branchId: string;
  branchName: string;
  installedDate: string;
  returnedDate: string;
  activeDurationMonths: number;
  returnReason: string;
  status: 'TERMINATED' | 'RETURNED' | 'REFURBISHED' | 'RELOCATED';
  handledByStaff: string;
  installedByStaff?: string; // Original field installation officer
  replacedByStaff?: string; // Replacement / swap officer (can be different person from installer)
  returnedByStaff?: string; // Officer who decommissioned / retrieved / returned the device
  settlementFinalized: boolean;
  notes?: string;
}

export interface AppSettings {
  midValidationStrict: boolean;
  midPrefix: string;
  batteryLifespanMonths: number;
  batteryWarningMonths: number;
  batterySerialPrefix: string;
  posSerialPrefix: string;
  soundBoxSerialPrefix: string;
  maxBranchReserveUnits: number;
  autoAlertOnBatteryExpiry: boolean;
  requireStaffSignature: boolean;
  sessionTimeoutMinutes: number;
  bankInstitutionName: string;
  slaStockDispatchHours?: number;
  slaMerchantInstallHours?: number;
  slaConfiguringMaxHours?: number;
  slaRmaReturnDays?: number;
  slaWarningThresholdPercent?: number;
  slaEnforceStrictBreachAlerts?: boolean;
  customFields?: CustomFieldDefinition[];
  customLogoUrl?: string;
  customLogoTitle?: string;
  customLogoSubtitle?: string;
  logoPresetId?: 'fintech-pulse' | 'apex-pos' | 'bank-shield' | 'quantum-sound';
}

export type CustomFieldType = 'text' | 'number' | 'select' | 'date' | 'phone';

export interface CustomFieldDefinition {
  id: string;
  label: string;
  type: CustomFieldType;
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  required?: boolean;
  enabled: boolean;
  isSystem?: boolean;
  description?: string;
}

export const DEFAULT_CUSTOM_FIELDS: CustomFieldDefinition[] = [
  {
    id: 'location',
    label: 'Store Location / Area',
    type: 'text',
    placeholder: 'e.g. Toul Kork / BKK1 / Riverside',
    enabled: true,
    isSystem: true,
    description: 'Commercial zone, municipal district, or branch territory.',
  },
  {
    id: 'merchantPhone',
    label: 'Merchant Phone Number',
    type: 'phone',
    placeholder: 'e.g. 012 888 900',
    enabled: true,
    isSystem: true,
    description: 'Direct contact phone number for merchant owner or shop manager.',
  },
  {
    id: 'address',
    label: 'Physical Store Address',
    type: 'text',
    placeholder: 'e.g. #12, St 315, Sangkat Boeung Kak 1, Phnom Penh',
    enabled: true,
    isSystem: true,
    description: 'Detailed street address for field technician on-site maintenance.',
  },
  {
    id: 'simCarrier',
    label: 'SIM Card / 4G Carrier',
    type: 'select',
    options: ['Smart Axiata (4G)', 'Cellcard (4G)', 'Metfone (4G)', 'Ethernet / Wi-Fi Only'],
    defaultValue: 'Smart Axiata (4G)',
    placeholder: 'Select cellular operator',
    enabled: false,
    isSystem: false,
    description: 'Cellular network provider provisioned in the POS terminal.',
  },
  {
    id: 'boothNumber',
    label: 'Floor / Booth / Stall #',
    type: 'text',
    placeholder: 'e.g. 2nd Floor, Kiosk B-14',
    enabled: false,
    isSystem: false,
    description: 'Specific booth, mall floor, or market stall identifier.',
  },
  {
    id: 'installationContact',
    label: 'On-site Contact Person',
    type: 'text',
    placeholder: 'e.g. Mr. Sokha (Store Supervisor)',
    enabled: false,
    isSystem: false,
    description: 'Authorized on-site person to receive and sign for hardware handovers.',
  },
];


