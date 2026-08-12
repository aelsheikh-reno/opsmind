export type VatPeriod = {
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  label: string;        // e.g. "Q2 2026" or "Apr 2026"
  isPast: boolean;
  isOverdue: boolean;
};

/**
 * Generate VAT filing periods from config.startDate up to 2 periods in the future.
 * anchorMonth (1–12) sets which month starts a new cycle.
 * frequencyMonths: 1 = monthly, 3 = quarterly, 6 = semi-annual, 12 = annual.
 */
export function generateVatPeriods(
  startDate: Date,
  frequencyMonths: number,
  anchorMonth: number,
  filingDeadlineDays: number,
  periodsAhead: number = 5,
): VatPeriod[] {
  const now = new Date();

  // Find the first period boundary at or before startDate
  const anchor = anchorMonth - 1; // 0-indexed month
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth(); // 0-indexed

  // How many months since anchor within the cycle
  const monthsSinceAnchor = ((startMonth - anchor) % 12 + 12) % 12;
  const excessMonths = monthsSinceAnchor % frequencyMonths;

  let cursor = new Date(startYear, startMonth - excessMonths, 1);

  const periods: VatPeriod[] = [];

  const futureCutoff = new Date(now.getFullYear(), now.getMonth() + frequencyMonths * periodsAhead + 1, 1);

  while (cursor < futureCutoff) {
    const periodStart = new Date(cursor);
    const periodEnd = new Date(cursor.getFullYear(), cursor.getMonth() + frequencyMonths, 0); // last day

    const dueDate = new Date(periodEnd);
    dueDate.setDate(dueDate.getDate() + filingDeadlineDays);

    const isPast = periodEnd < now;
    const isOverdue = dueDate < now && isPast;

    periods.push({
      periodStart,
      periodEnd,
      dueDate,
      label: periodLabel(periodStart, frequencyMonths, anchorMonth),
      isPast,
      isOverdue,
    });

    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + frequencyMonths, 1);
  }

  return periods;
}

function periodLabel(start: Date, frequencyMonths: number, anchorMonth: number): string {
  const year = start.getFullYear();
  if (frequencyMonths === 1) {
    return start.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  }
  if (frequencyMonths === 12) {
    return `FY ${year}`;
  }
  // Quarterly / semi-annual: number the period within the year
  const anchor = anchorMonth - 1;
  const monthsFromAnchor = ((start.getMonth() - anchor) % 12 + 12) % 12;
  const periodNum = Math.floor(monthsFromAnchor / frequencyMonths) + 1;
  const totalPeriods = 12 / frequencyMonths;
  const prefix = totalPeriods === 4 ? "Q" : "H";
  return `${prefix}${periodNum} ${year}`;
}
