/**
 * Official Cambodian National Public Holidays Registry
 * Established by Royal Government of Cambodia Sub-Decree (Anukret) & National Bank of Cambodia (NBC).
 *
 * Covers official public holidays for 2025, 2026, 2027 and annual recurring fixed dates.
 */

export interface CambodiaHoliday {
  date: string; // YYYY-MM-DD
  nameEn: string;
  nameKh?: string;
}

// Exact official dates for 2025, 2026, 2027
const CAMBODIA_HOLIDAYS_MAP: Record<string, string> = {
  // ── 2025 Official Public Holidays (Royal Decree No. 204) ──
  '2025-01-01': "International New Year's Day",
  '2025-01-07': 'Victory over Genocide Day',
  '2025-03-08': "International Women's Day",
  '2025-04-14': 'Khmer New Year (Day 1)',
  '2025-04-15': 'Khmer New Year (Day 2)',
  '2025-04-16': 'Khmer New Year (Day 3)',
  '2025-05-01': 'International Labour Day',
  '2025-05-11': 'Visak Bochea Day',
  '2025-05-14': "King Norodom Sihamoni's Birthday",
  '2025-05-15': 'Royal Ploughing Ceremony',
  '2025-06-18': "Queen Mother Norodom Monineath Sihanouk's Birthday",
  '2025-09-21': 'Pchum Ben Festival (Day 1)',
  '2025-09-22': 'Pchum Ben Festival (Day 2)',
  '2025-09-23': 'Pchum Ben Festival (Day 3)',
  '2025-09-24': 'National Constitution Day',
  '2025-10-15': 'Commemoration Day of the Late King-Father Norodom Sihanouk',
  '2025-10-29': "King Norodom Sihamoni's Coronation Day",
  '2025-11-04': 'Water Festival (Bon Om Touk Day 1)',
  '2025-11-05': 'Water Festival (Bon Om Touk Day 2)',
  '2025-11-06': 'Water Festival (Bon Om Touk Day 3)',
  '2025-11-09': "National Independence Day",
  '2025-12-29': 'Peace Day in Cambodia',

  // ── 2026 Official Public Holidays (Sub-Decree No. 167) ──
  '2026-01-01': "International New Year's Day",
  '2026-01-07': 'Victory over Genocide Day',
  '2026-03-08': "International Women's Day",
  '2026-04-14': 'Khmer New Year (Day 1)',
  '2026-04-15': 'Khmer New Year (Day 2)',
  '2026-04-16': 'Khmer New Year (Day 3)',
  '2026-05-01': 'International Labour Day & Visak Bochea',
  '2026-05-05': 'Royal Ploughing Ceremony',
  '2026-05-14': "King Norodom Sihamoni's Birthday",
  '2026-06-18': "Queen Mother Norodom Monineath Sihanouk's Birthday",
  '2026-09-24': 'National Constitution Day',
  '2026-10-10': 'Pchum Ben Festival (Day 1)',
  '2026-10-11': 'Pchum Ben Festival (Day 2)',
  '2026-10-12': 'Pchum Ben Festival (Day 3)',
  '2026-10-15': 'Commemoration Day of the Late King-Father Norodom Sihanouk',
  '2026-10-29': "King Norodom Sihamoni's Coronation Day",
  '2026-11-09': "National Independence Day",
  '2026-11-23': 'Water Festival (Bon Om Touk Day 1)',
  '2026-11-24': 'Water Festival (Bon Om Touk Day 2)',
  '2026-11-25': 'Water Festival (Bon Om Touk Day 3)',
  '2026-12-29': 'Peace Day in Cambodia',

  // ── 2027 Official Public Holidays ──
  '2027-01-01': "International New Year's Day",
  '2027-01-07': 'Victory over Genocide Day',
  '2027-03-08': "International Women's Day",
  '2027-04-14': 'Khmer New Year (Day 1)',
  '2027-04-15': 'Khmer New Year (Day 2)',
  '2027-04-16': 'Khmer New Year (Day 3)',
  '2027-05-01': 'International Labour Day',
  '2027-05-14': "King Norodom Sihamoni's Birthday",
  '2027-05-20': 'Visak Bochea Day',
  '2027-05-24': 'Royal Ploughing Ceremony',
  '2027-06-18': "Queen Mother Norodom Monineath Sihanouk's Birthday",
  '2027-09-24': 'National Constitution Day',
  '2027-09-29': 'Pchum Ben Festival (Day 1)',
  '2027-09-30': 'Pchum Ben Festival (Day 2)',
  '2027-10-01': 'Pchum Ben Festival (Day 3)',
  '2027-10-15': 'Commemoration Day of the Late King-Father Norodom Sihanouk',
  '2027-10-29': "King Norodom Sihamoni's Coronation Day",
  '2027-11-09': "National Independence Day",
  '2027-11-12': 'Water Festival (Bon Om Touk Day 1)',
  '2027-11-13': 'Water Festival (Bon Om Touk Day 2)',
  '2027-11-14': 'Water Festival (Bon Om Touk Day 3)',
  '2027-12-29': 'Peace Day in Cambodia',
};

// Recurring fixed calendar holidays (fallback for other years)
const FIXED_RECURRING_HOLIDAYS: Record<string, string> = {
  '01-01': "International New Year's Day",
  '01-07': 'Victory over Genocide Day',
  '03-08': "International Women's Day",
  '04-14': 'Khmer New Year (Day 1)',
  '04-15': 'Khmer New Year (Day 2)',
  '04-16': 'Khmer New Year (Day 3)',
  '05-01': 'International Labour Day',
  '05-14': "King Norodom Sihamoni's Birthday",
  '06-18': "Queen Mother Norodom Monineath Sihanouk's Birthday",
  '09-24': 'National Constitution Day',
  '10-15': 'Commemoration Day of the Late King-Father Norodom Sihanouk',
  '10-29': "King Norodom Sihamoni's Coronation Day",
  '11-09': "National Independence Day",
  '12-29': 'Peace Day in Cambodia',
};

/**
 * Returns holiday name if the ISO date string (YYYY-MM-DD) is a recognized Cambodian National Holiday.
 */
export function getCambodiaHoliday(isoDate: string): string | null {
  if (!isoDate || isoDate.length < 10) return null;
  const direct = CAMBODIA_HOLIDAYS_MAP[isoDate];
  if (direct) return direct;

  // Fallback to month-day fixed recurring
  const mmdd = isoDate.substring(5, 10);
  return FIXED_RECURRING_HOLIDAYS[mmdd] || null;
}

/**
 * Checks whether the given date is a Weekend (Saturday or Sunday).
 */
export function isWeekendDay(dateOrIso: Date | string): boolean {
  if (typeof dateOrIso === 'string') {
    const parts = dateOrIso.split('-');
    if (parts.length >= 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      const dayOfWeek = d.getDay();
      return dayOfWeek === 0 || dayOfWeek === 6; // Sunday = 0, Saturday = 6
    }
  }
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  const dayOfWeek = d.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Computes exact working days, weekends, and holidays for any given month.
 */
export function getMonthWorkDaysSummary(year: number, month: number) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workDays = 0;
  let weekendDays = 0;
  let weekdayHolidays = 0;
  const holidaysInMonth: Array<{
    date: string;
    dayNum: number;
    name: string;
    dayOfWeek: string;
    isWeekend: boolean;
  }> = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(year, month - 1, d);
    const isWk = isWeekendDay(dateObj);
    const hol = getCambodiaHoliday(iso);

    if (hol) {
      holidaysInMonth.push({
        date: iso,
        dayNum: d,
        name: hol,
        dayOfWeek: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
        isWeekend: isWk,
      });
      if (!isWk) {
        weekdayHolidays++;
      }
    }

    if (isWk) {
      weekendDays++;
    } else if (!hol) {
      workDays++;
    }
  }

  return {
    year,
    month,
    daysInMonth,
    workDays,
    weekendDays,
    weekdayHolidays,
    holidaysInMonth,
  };
}
