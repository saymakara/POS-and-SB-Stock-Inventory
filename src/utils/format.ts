/**
 * (31 Oct 2026, UI standard) One way to write numbers everywhere on screen: thousands separator ("20,000", "8,571").
 * Not for codes (serials, MIDs, employee IDs, branch codes, years): those are shown exactly as stored.
 */
const nf = new Intl.NumberFormat('en-US');
export const fmtNum = (n: number | null | undefined): string => (n === null || n === undefined || Number.isNaN(n) ? '0' : nf.format(n));
