import { HistoricalMerchantRecord, AppSettings, DEFAULT_CUSTOM_FIELDS } from '../types';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  midValidationStrict: true,
  midPrefix: '100000880',
  batteryLifespanMonths: 24,
  batteryWarningMonths: 21,
  batterySerialPrefix: '160525A',
  posSerialPrefix: 'WP5400PQ',
  soundBoxSerialPrefix: 'SB-',
  maxBranchReserveUnits: 15,
  autoAlertOnBatteryExpiry: true,
  requireStaffSignature: true,
  sessionTimeoutMinutes: 30,
  bankInstitutionName: 'ABA Bank Merchant Acquiring & POS Terminal Operations',
  slaStockDispatchHours: 24,
  slaMerchantInstallHours: 48,
  slaConfiguringMaxHours: 12,
  slaRmaReturnDays: 7,
  slaWarningThresholdPercent: 80,
  slaEnforceStrictBreachAlerts: true,
  customFields: DEFAULT_CUSTOM_FIELDS,
  customLogoUrl: '',
  customLogoTitle: 'POS & Sound Box Stock',
  customLogoSubtitle: 'Branch Operations Portal',
  phoneReviewScope: 'ALL',
  logoPresetId: 'quantum-sound',
};

export const INITIAL_HISTORICAL_MERCHANTS: HistoricalMerchantRecord[] = [];
