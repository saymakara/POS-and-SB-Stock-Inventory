// (7 Nov 2026) Phone App Review: an Admin / Super Admin corrects a record's details. One database function checks who may
// edit, refuses the stock fields of an approved POS Terminal / Sound Box record, writes the Audit Trail and queues the change
// for the Merchant Visit app's Google Sheet (FIELD, VISIT, CC; KHQR lives only in the portal).
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export type PhoneEditSource = 'FIELD' | 'VISIT' | 'CC' | 'KHQR';
export interface PhoneEditResult { changed: string[]; record: string; sheet: 'PENDING' | 'NOT_NEEDED' }
export interface PhoneEditLog {
  id: number; changes: Record<string, unknown>; oldValues: Record<string, unknown>; editedBy: string; editedAt: string;
  sheetStatus: 'PENDING' | 'APPLIED' | 'FAILED' | 'NOT_NEEDED'; sheetNote: string | null; reason: string | null;
}

/** The database's message in plain words (without its INPUT: / APPROVED: marker). */
const plain = (m: string) => String(m || 'The change could not be saved.').replace(/^(INPUT|APPROVED):\s*/, '');

export async function editPhoneRecord(source: PhoneEditSource, id: number, changes: Record<string, unknown>, reason?: string): Promise<PhoneEditResult> {
  if (!isSupabaseConfigured) throw new Error('The portal is not connected to the database.');
  const { data, error } = await supabase.rpc('admin_edit_phone_record', { p: { source, id, changes, reason: reason || '' } });
  if (error) throw new Error(plain(error.message));
  const d: any = data || {};
  return { changed: Array.isArray(d.changed) ? d.changed.map(String) : [], record: String(d.record || ''), sheet: d.sheet === 'PENDING' ? 'PENDING' : 'NOT_NEEDED' };
}

/** The edits of one record (newest first) with how far each one is in the Google Sheet. */
export async function fetchPhoneEdits(source: PhoneEditSource, rowId: number): Promise<PhoneEditLog[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.from('phone_record_edits')
    .select('id, changes, old_values, edited_by, edited_at, sheet_status, sheet_note, reason')
    .eq('source', source).eq('row_id', rowId).order('id', { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({ id: Number(r.id), changes: r.changes || {}, oldValues: r.old_values || {}, editedBy: String(r.edited_by || ''),
    editedAt: String(r.edited_at || ''), sheetStatus: r.sheet_status, sheetNote: r.sheet_note ?? null, reason: r.reason ?? null }));
}
