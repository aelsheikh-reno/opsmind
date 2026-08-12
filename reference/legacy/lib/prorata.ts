export type SalaryComponent = {
  name: string;
  amount: number;
  periodType?: "quarter" | "month" | "year";
  periodIndex?: number; // 1-based
};

// Scale every component by factor, stripping period metadata (the entry IS the resolved tier).
function applyFactor(
  salary: number,
  components: string | null,
  factor: number,
): { salary: number; components: string | null } {
  const rounded = Math.round(salary * factor * 100) / 100;
  if (!components) return { salary: rounded, components: null };
  try {
    const comps = JSON.parse(components) as SalaryComponent[];
    const scaled = comps.map(({ name, amount }) => ({
      name,
      amount: Math.round(amount * factor * 100) / 100,
    }));
    return { salary: rounded, components: JSON.stringify(scaled) };
  } catch {
    return { salary: rounded, components: null };
  }
}

// Pick the components (and total salary) that apply for a given payroll month,
// relative to the contract start. Returns flat components with no period metadata.
function resolveTier(
  comps: SalaryComponent[],
  contractStart: Date,
  runMonth: number,
  runYear: number,
): { salary: number; components: string } {
  const tiered = comps.filter((c) => c.periodType);
  const flat   = comps.filter((c) => !c.periodType);

  if (tiered.length === 0) {
    return {
      salary: comps.reduce((s, c) => s + c.amount, 0),
      components: JSON.stringify(comps.map(({ name, amount }) => ({ name, amount }))),
    };
  }

  // 5-day grace: hired on days 1–5 → hire month counts as month 1.
  // Hired on day 6+ → tier counting starts from the next month.
  const tierOrigin = contractStart.getDate() > 5
    ? new Date(contractStart.getFullYear(), contractStart.getMonth() + 1, 1)
    : new Date(contractStart.getFullYear(), contractStart.getMonth(), 1);

  const monthsElapsed = Math.max(
    0,
    (runYear - tierOrigin.getFullYear()) * 12 +
      (runMonth - (tierOrigin.getMonth() + 1)),
  );

  const periodType = tiered[0].periodType!;
  let targetIndex: number;
  if      (periodType === "quarter") targetIndex = Math.floor(monthsElapsed / 3)  + 1;
  else if (periodType === "month")   targetIndex = monthsElapsed + 1;
  else                               targetIndex = Math.floor(monthsElapsed / 12) + 1;

  // Highest defined index that doesn't exceed target (last tier holds if contract outlasts defined tiers).
  // If no tier has been reached yet (targetIndex < first defined tier), return only flat components —
  // don't fall forward to the first tier prematurely.
  const available = [...new Set(tiered.map((c) => c.periodIndex ?? 1))].sort((a, b) => a - b);
  const reached = available.filter((i) => i <= targetIndex);

  if (reached.length === 0) {
    // No tier active yet — only flat components apply
    return {
      salary:     flat.reduce((s, c) => s + c.amount, 0),
      components: JSON.stringify(flat.map(({ name, amount }) => ({ name, amount }))),
    };
  }

  const effectiveIndex = reached.pop()!;
  const activeTiered = tiered.filter((c) => (c.periodIndex ?? 1) === effectiveIndex);
  const active = [...flat, ...activeTiered];

  return {
    salary:     active.reduce((s, c) => s + c.amount, 0),
    components: JSON.stringify(active.map(({ name, amount }) => ({ name, amount }))),
  };
}

/**
 * Resolve the salary (and flat components) that apply for a specific payroll month,
 * accounting for tiered schedules. Use this for payment schedule row amounts.
 */
export function resolveMonthSalary(
  components: string | null,
  contractStart: Date,
  runMonth: number,
  runYear: number,
): { salary: number; components: string | null } {
  if (!components) return { salary: 0, components: null };
  try {
    const comps = JSON.parse(components) as SalaryComponent[];
    const hasTiers = comps.some((c) => c.periodType);
    if (!hasTiers) return { salary: comps.reduce((s, c) => s + c.amount, 0), components };
    const resolved = resolveTier(comps, contractStart, runMonth, runYear);
    return resolved;
  } catch {
    return { salary: 0, components: null };
  }
}

/**
 * Returns the pro-rated salary (and components) for a payroll month.
 * Automatically resolves tiered salary schedules before applying pro-rata.
 * Uses UAE 30-day divisor convention.
 *
 * Priority: exit date > contract end mid-month > contract start mid-month.
 */
export function computeProRata(
  salary: number,
  components: string | null,
  runMonth: number,
  runYear: number,
  contractStart: Date | null | undefined,
  contractEnd: Date | null | undefined,
  exitDate: Date | null | undefined,
): { salary: number; components: string | null; note: string | null } {
  // Resolve tiered schedule first (modifies salary + components for this specific month)
  let effectiveSalary = salary;
  let effectiveComponents = components;

  if (components && contractStart) {
    try {
      const comps = JSON.parse(components) as SalaryComponent[];
      if (comps.some((c) => c.periodType)) {
        const resolved = resolveTier(comps, contractStart, runMonth, runYear);
        effectiveSalary     = resolved.salary;
        effectiveComponents = resolved.components;
      }
    } catch { /* leave unchanged */ }
  }

  const monthStart  = new Date(runYear, runMonth - 1, 1);
  const monthEnd    = new Date(runYear, runMonth,     1);
  const daysInMonth = new Date(runYear, runMonth,     0).getDate();

  // Exit date mid-month
  if (exitDate && exitDate >= monthStart && exitDate < monthEnd) {
    const d = exitDate.getDate();
    return { ...applyFactor(effectiveSalary, effectiveComponents, d / 30), note: `Pro-rated: ${d}/30 days` };
  }

  // Contract end mid-month
  if (contractEnd && contractEnd >= monthStart && contractEnd < monthEnd) {
    const d = contractEnd.getDate();
    return { ...applyFactor(effectiveSalary, effectiveComponents, d / 30), note: `Pro-rated: ${d}/30 days` };
  }

  // Contract start mid-month (not the 1st) — inclusive of the start day
  if (
    contractStart &&
    contractStart >= monthStart &&
    contractStart < monthEnd &&
    contractStart.getDate() > 1
  ) {
    const d = daysInMonth - contractStart.getDate() + 1;
    return { ...applyFactor(effectiveSalary, effectiveComponents, d / 30), note: `Pro-rated: ${d}/30 days` };
  }

  return { salary: effectiveSalary, components: effectiveComponents, note: null };
}
