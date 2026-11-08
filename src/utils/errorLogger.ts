import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { stampSecPP } from './time';

// Re-export Telegram configuration and alert dispatchers for unified access
export * from './telegram';

export interface ErrorLoggerContext {
  staffId: string;
  staffName: string;
  role: string;
  branchId: string;
}

export interface TechnicalErrorPopupPayload {
  id: string;
  code: string;
  operation: string;
  operationLabel?: string;
  title?: string;
  badge?: string;
  kind?: 'notice' | 'error';
  message: string;
  staffId: string;
  staffName: string;
  branchId: string;
  timestamp: string;
  target?: string;
  telegramSent?: boolean;
}

/** Alias for backward compatibility */
export type TechnicalErrorPayload = TechnicalErrorPopupPayload;

const OPERATION_LABELS: Record<string, string> = {
  dispatchRequestWithMaterialsOnServer: 'Requisition & Materials Dispatch',
  dispatchRequisitionOnServer: 'Requisition Hardware Dispatch',
  rejectRequisitionOnServer: 'Requisition Rejection',
  receiveReturnOnServer: 'Stock Return Receipt (Head Office)',
  confirmReceiptOnServer: 'Branch Stock Receipt Confirmation',
  saveRequisitionStrict: 'Stock Requisition Submission',
  'saveDevicesStrict.batchInsert': 'Device Inventory Registration',
  'saveDevicesStrict.update': 'Device Inventory Update',
  'saveDevicesStrict.updateException': 'Device Inventory Update',
  saveDevicesStrict: 'Device Inventory Save',
  deleteDevicesOnServer: 'Device Inventory Removal',
  deleteAllHistoricalMerchantsOnServer: 'Historical Merchant Records Cleanup',
  insertHistoricalMerchantToSupabase: 'Historical Merchant Registration',
  recheckFieldEvent: 'Field Activity Recheck',
  approveFieldEvent: 'Field Activity Approval',
  rejectFieldEvent: 'Field Activity Rejection',
  saveStaffAccount: 'Staff Account Management',
  saveBranchOnServer: 'Branch Directory Update',
  renameDeviceSerialOnServer: 'Device Serial Number Update',
  MobileFieldSync: 'Mobile Field Activity Sync',
};

export function formatOperationLabel(operation: string): string {
  const clean = String(operation || '').trim();
  if (!clean) return 'System Operation';
  if (OPERATION_LABELS[clean]) return OPERATION_LABELS[clean];
  return clean
    .replace(/OnServer$/i, '')
    .replace(/Strict$/i, '')
    .replace(/FromSupabase$/i, '')
    .replace(/ToSupabase$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatProfessionalError(
  rawMessage: string,
  code = 'ERR_DB_OPERATION',
  operation = ''
): {
  kind: 'notice' | 'error';
  title: string;
  badge: string;
  message: string;
  operationLabel: string;
} {
  const operationLabel = formatOperationLabel(operation);
  const raw = String(rawMessage || '').trim();

  // 1. "STOCK: not enough <Item> at <Location>: <have> in stock, <need> needed."
  const stockShortageMatch = raw.match(
    /^(?:STOCK:\s*)?not enough\s+(.+?)\s+at\s+(.+?):\s*(\d+)\s+in stock,\s*(\d+)\s+needed\.?$/i
  );
  if (stockShortageMatch) {
    const [, item, location, have, need] = stockShortageMatch;
    return {
      kind: 'notice',
      title: `Insufficient Stock at ${location}`,
      badge: 'INSUFFICIENT STOCK · ACTION REQUIRED',
      operationLabel,
      message: `Unable to complete dispatch — insufficient ${item} stock at ${location} (${have} available in stock, ${need} required). Please restock ${item} in Material Inventory or adjust the dispatch quantity before proceeding.`,
    };
  }

  // 2. "Not dispatched: <Item> <Serial> is not in Head Office stock."
  const notInHqMatch = raw.match(/^Not dispatched:\s*(.+?)\s+is not in Head Office stock\.?$/i);
  if (notInHqMatch) {
    return {
      kind: 'notice',
      title: 'Item Not Available in Head Office Stock',
      badge: 'STOCK VALIDATION · ACTION REQUIRED',
      operationLabel,
      message: `Unable to complete dispatch because ${notInHqMatch[1]} is not currently available in Head Office stock. Please select an available item from Head Office inventory.`,
    };
  }

  // 3. "Not dispatched: <sent> <Item> sent but <req> requested."
  const qtyExceedMatch = raw.match(/^Not dispatched:\s*(\d+)\s+(.+?)\s+sent but\s+(\d+)\s+requested\.?$/i);
  if (qtyExceedMatch) {
    const [, sent, item, req] = qtyExceedMatch;
    return {
      kind: 'notice',
      title: 'Dispatch Quantity Exceeds Request',
      badge: 'DISPATCH VALIDATION · ACTION REQUIRED',
      operationLabel,
      message: `Cannot dispatch ${sent} ${item} unit(s) because only ${req} unit(s) were requested on this requisition. Please adjust the dispatch quantity to match the request.`,
    };
  }

  // 4. "Not dispatched: "<val>" is not a valid <Item> number."
  const invalidNumMatch = raw.match(/^(?:Not dispatched|INPUT):\s*"(.+?)"\s+is not a valid\s*(.*?)\s*number\.?$/i);
  if (invalidNumMatch) {
    const [, val, item] = invalidNumMatch;
    const label = item ? `${item} ` : '';
    return {
      kind: 'notice',
      title: `Invalid ${label}Number Format`.replace(/\s+/g, ' '),
      badge: 'VALIDATION NOTICE · ACTION REQUIRED',
      operationLabel,
      message: `The entered number "${val}" is not in a valid ${label}format. Please verify the number and try again.`,
    };
  }

  // 5. "STOCK: <Item> is lost. Recover it in Lost Materials first."
  const lostMatch = raw.match(/^(?:STOCK:\s*)?(.+?)\s+is lost\.\s*Recover it in Lost Materials first\.?$/i);
  if (lostMatch) {
    return {
      kind: 'notice',
      title: 'Item Recorded as Lost',
      badge: 'STOCK RESTRICTION · ACTION REQUIRED',
      operationLabel,
      message: `${lostMatch[1]} is lost. Recover it in Lost Materials first before updating or dispatching.`,
    };
  }

  // 6. General STOCK / KIT / INPUT / Not dispatched / 22023 business validation notices
  const prefixMatch = raw.match(/^(STOCK|KIT|INPUT|Not dispatched):\s*(.+)$/i);
  if (prefixMatch || code === 'ERR-22023') {
    const prefix = prefixMatch ? prefixMatch[1].toUpperCase() : 'VALIDATION';
    const body = (prefixMatch ? prefixMatch[2] : raw).trim();
    const cleanBody = body.charAt(0).toUpperCase() + body.slice(1);
    const title =
      prefix === 'STOCK'
        ? 'Inventory Stock Notice'
        : prefix === 'KIT'
        ? 'Merchant Kit Validation Notice'
        : prefix === 'NOT DISPATCHED'
        ? 'Dispatch Validation Notice'
        : 'Operation Validation Notice';
    const badge =
      prefix === 'STOCK'
        ? 'INVENTORY NOTICE · ACTION REQUIRED'
        : prefix === 'KIT'
        ? 'KIT VALIDATION · ACTION REQUIRED'
        : 'VALIDATION NOTICE · ACTION REQUIRED';
    return {
      kind: 'notice',
      title,
      badge,
      operationLabel,
      message: cleanBody.endsWith('.') ? cleanBody : `${cleanBody}.`,
    };
  }

  // 7. Permission / Authorization notice (42501)
  if (code === 'ERR-42501' || /Only Admin HQ|Only HQ admins|not allowed|permission/i.test(raw)) {
    const cleanBody = raw.charAt(0).toUpperCase() + raw.slice(1);
    return {
      kind: 'notice',
      title: 'Authorization Required',
      badge: 'ACCESS RESTRICTION',
      operationLabel,
      message: cleanBody.endsWith('.') ? cleanBody : `${cleanBody}.`,
    };
  }

  // 8. Genuine technical or connectivity error
  const cleanTech = raw.replace(/^(ERROR|ERR):\s*/i, '').trim() || 'An unexpected system error occurred while processing your request.';
  return {
    kind: 'error',
    title: 'System Operation Alert',
    badge: `REFERENCE: ${code}`,
    operationLabel,
    message: cleanTech.charAt(0).toUpperCase() + cleanTech.slice(1),
  };
}

let currentContext: ErrorLoggerContext = {
  staffId: 'UNKNOWN_STAFF',
  staffName: 'Field / Workstation Staff',
  role: 'BRANCH',
  branchId: '100',
};

type PopupListener = (payload: TechnicalErrorPopupPayload) => void;
const popupListeners = new Set<PopupListener>();

export function setErrorLoggerContext(ctx: Partial<ErrorLoggerContext>): void {
  currentContext = {
    ...currentContext,
    ...Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined && v !== '')),
  };
}

export function subscribeTechnicalErrorPopup(listener: PopupListener): () => void {
  popupListeners.add(listener);
  return () => {
    popupListeners.delete(listener);
  };
}

export function triggerTechnicalErrorPopup(payload: TechnicalErrorPopupPayload): void {
  popupListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  });
}

/**
 * Extracts a standardized technical error code and message from any thrown error or Supabase PostgREST error.
 */
export function extractTechnicalError(
  err: unknown,
  fallbackCode = 'ERR_DB_OPERATION'
): { code: string; message: string } {
  if (!err) {
    return { code: fallbackCode, message: 'Unknown technical error' };
  }
  if (typeof err === 'string') {
    const codeMatch = err.match(/\b(PGRST\d+|PT\d+|\d{5}|42501|23505|23503|22P02|STALE_ROW|HTTP_\d+)\b/i);
    return {
      code: codeMatch ? `ERR-${codeMatch[1].toUpperCase()}` : fallbackCode,
      message: err,
    };
  }
  if (typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    const rawCode = String(anyErr.code || anyErr.status || anyErr.error_code || '').trim();
    const rawMessage = String(
      anyErr.message || anyErr.error_description || anyErr.details || anyErr.hint || 'Database / API request failed'
    ).trim();
    const inferredMatch = rawMessage.match(/\b(PGRST\d+|PT\d+|\d{5}|42501|23505|23503|22P02|STALE_ROW)\b/i);
    const finalCode = rawCode
      ? `ERR-${rawCode.toUpperCase()}`
      : inferredMatch
      ? `ERR-${inferredMatch[1].toUpperCase()}`
      : fallbackCode;
    return { code: finalCode, message: rawMessage };
  }
  return { code: fallbackCode, message: String(err) };
}

/**
 * Error-Only Logger + UI Alert Popup.
 * Called ONLY inside catch blocks when an API call or database operation fails.
 * Successful operations MUST NOT call this function.
 */
export async function reportCaughtError(
  operation: string,
  err: unknown,
  options?: {
    code?: string;
    target?: string;
    staffId?: string;
    branchId?: string;
    showPopup?: boolean;
    skipDbLog?: boolean;
  }
): Promise<TechnicalErrorPopupPayload> {
  const { code, message: rawMessage } = extractTechnicalError(err, options?.code || 'ERR_SUPABASE_API');
  const formatted = formatProfessionalError(rawMessage, code, operation);
  const staffId = options?.staffId || currentContext.staffId || 'UNKNOWN_STAFF';
  const staffName = currentContext.staffName || staffId;
  const branchId = options?.branchId || currentContext.branchId || '100';
  const timestamp = stampSecPP();

  const payload: TechnicalErrorPopupPayload = {
    id: `ERR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    code,
    operation,
    operationLabel: formatted.operationLabel,
    title: formatted.title,
    badge: formatted.badge,
    kind: formatted.kind,
    message: formatted.message,
    staffId,
    staffName,
    branchId,
    timestamp,
    target: options?.target,
  };

  // 1. Trigger UI alert popup immediately
  if (options?.showPopup !== false) {
    triggerTechnicalErrorPopup(payload);
  }

  // 2. Error-Only Database Audit Log (only write to Supabase on actual failure, with circuit guard against recursion)
  if (isSupabaseConfigured && !options?.skipDbLog && operation !== 'writeErrorAuditLog') {
    try {
      const { error: logErr } = await supabase.from('audit_logs').insert({
        title: `[${formatted.kind === 'notice' ? 'NOTICE' : 'ERROR'}] ${formatted.operationLabel}`.slice(0, 160),
        detail: `[${code}] Staff ${staffId}: ${formatted.message}`.slice(0, 1000),
        action: 'ERROR',
        target: options?.target || code,
      });
      if (logErr) console.warn('[errorLogger] error not saved to the Audit Trail: ' + logErr.message);
    } catch {
      // Do not re-throw if the database log quota or connection is down
    }
  }

  return payload;
}
