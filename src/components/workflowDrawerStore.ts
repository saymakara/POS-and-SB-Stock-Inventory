/**
 * (18 Nov 2026) Which POS Terminal / Sound Box unit the Manage drawer shows, kept outside the App component.
 *
 * Before: the open unit was App state, so every "Manage" click re-rendered the whole portal (sidebar, the unit table,
 * every tab) in the same frame the drawer had to start its slide - a 110-160 ms freeze at 4x CPU, against 60-95 ms for
 * the SIM Card drawer (whose state lives in its own tab). Now a click only re-renders the drawer host.
 */
import { useSyncExternalStore } from 'react';

export type WorkflowPreset = '' | 'RETURN';
interface DrawerState { serial: string | null; preset: WorkflowPreset }

let state: DrawerState = { serial: null, preset: '' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const workflowDrawer = {
  get: (): DrawerState => state,
  /** Opens the drawer on a unit (null closes it). */
  open(serial: string | null, preset: WorkflowPreset = ''): void {
    if (state.serial === serial && state.preset === preset) return;
    state = { serial, preset: serial ? preset : '' };
    emit();
  },
  close(): void { workflowDrawer.open(null); },
  /** Clears the preset (e.g. RETURN) and keeps the unit open. */
  clearPreset(): void {
    if (!state.preset) return;
    state = { ...state, preset: '' };
    emit();
  },
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
};

export function useWorkflowDrawer(): DrawerState {
  return useSyncExternalStore(workflowDrawer.subscribe, workflowDrawer.get, workflowDrawer.get);
}
