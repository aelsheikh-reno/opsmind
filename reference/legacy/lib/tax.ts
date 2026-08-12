export type TaxPeriod = {
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  label: string;
  isPast: boolean;
  isOverdue: boolean;
};

export function generateTaxPeriods(
  startDate: Date,
  frequencyMonths: number,
  anchorMonth: number,
  filingDeadlineDays: number,
  periodsAhead: number = 5,
): TaxPeriod[] {
  const now = new Date();

  const anchor = anchorMonth - 1;
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth();

  const monthsSinceAnchor = ((startMonth - anchor) % 12 + 12) % 12;
  const excessMonths = monthsSinceAnchor % frequencyMonths;

  let cursor = new Date(startYear, startMonth - excessMonths, 1);

  const periods: TaxPeriod[] = [];
  const futureCutoff = new Date(now.getFullYear(), now.getMonth() + frequencyMonths * periodsAhead + 1, 1);

  while (cursor < futureCutoff) {
    const periodStart = new Date(cursor);
    const periodEnd = new Date(cursor.getFullYear(), cursor.getMonth() + frequencyMonths, 0);

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
  const anchor = anchorMonth - 1;
  const monthsFromAnchor = ((start.getMonth() - anchor) % 12 + 12) % 12;
  const periodNum = Math.floor(monthsFromAnchor / frequencyMonths) + 1;
  const totalPeriods = 12 / frequencyMonths;
  const prefix = totalPeriods === 4 ? "Q" : "H";
  return `${prefix}${periodNum} ${year}`;
}
