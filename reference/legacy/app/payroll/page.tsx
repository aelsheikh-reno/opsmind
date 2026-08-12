import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format-date";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import MarkPayrollProcessedButton from "../components/MarkPayrollProcessedButton";
import GeneratePayrollButton from "../components/GeneratePayrollButton";
import PayrollFxRateEditor from "../components/PayrollFxRateEditor";
import PayrollEntryListClient, { type EntryRow } from "./PayrollEntryListClient";
import Link from "next/link";
import { getUsdRates as getLiveUsdRates, getHistoricalUsdRates } from "@/lib/fx";
import PayrollCalendar, { type CalendarMonthData } from "./PayrollCalendar";
import PayrollRightPanel from "./PayrollRightPanel";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type SalaryComponent = { name: string; amount: number };
function parseSalaryComponents(json: string | null | undefined): SalaryComponent[] {
  if (!json) return [];
  try { return JSON.parse(json) as SalaryComponent[]; } catch { return []; }
}

function toUSD(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  if (!rate) return amount;
  return amount / rate;
}

const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function effectiveRates(run: { fxRateSnapshot?: string | null } | null, liveRates: Record<string, number>): Record<string, number> {
  if (!run?.fxRateSnapshot) return liveRates;
  try { return JSON.parse(run.fxRateSnapshot); } catch { return liveRates; }
}

function buildCalendarWindow(
  runs: { id: string; month: number | null; year: number | null; isProcessed: boolean; fxRateSnapshot?: string | null; entries: { salary: number; currency: string; isPaid: boolean; bankingFee: number | null; bankingFeeCurrency: string | null }[] }[],
  rates: Record<string, number>,
  selectedMonth: number,
  selectedYear: number,
  horizonYear: number | null,
) {
  const now = new Date();
  const NOW_MONTH = now.getMonth() + 1;
  const NOW_YEAR = now.getFullYear();

  // 0-indexed month key: toKey(1,2025)=24300, toKey(12,2025)=24311, toKey(1,2026)=24312
  // Reconstruction: y = floor(key/12), m = (key % 12) + 1  — always valid 1-12
  const toKey = (m: number, y: number) => y * 12 + (m - 1);

  const windowStart = toKey(NOW_MONTH - 5, NOW_YEAR);
  const windowEnd   = toKey(NOW_MONTH + 3, NOW_YEAR);

  // Extend window to include all months that have runs, plus the horizon year
  const runKeys = runs
    .filter((r) => r.month !== null && r.year !== null)
    .map((r) => toKey(r.month!, r.year!));

  const start = Math.min(windowStart, ...runKeys);
  // Horizon caps the end — if set it is both the floor and ceiling
  const end = horizonYear
    ? toKey(12, horizonYear)
    : Math.max(windowEnd, ...runKeys);

  const months = [];
  for (let key = start; key <= end; key++) {
    const y = Math.floor(key / 12);
    const m = (key % 12) + 1; // always 1-12

    const run = runs.find((r) => r.month === m && r.year === y) ?? null;
    const isCurrent    = m === NOW_MONTH && y === NOW_YEAR;
    const isPast       = toKey(m, y) < toKey(NOW_MONTH, NOW_YEAR);
    const isFuture     = toKey(m, y) > toKey(NOW_MONTH, NOW_YEAR);
    const isSelected   = m === selectedMonth && y === selectedYear;
    const isProcessed  = run?.isProcessed ?? false;
    const runRates = effectiveRates(run, rates);
    const monthUsdTotal = run
      ? run.entries.reduce((s, e) =>
          s + toUSD(e.salary, e.currency, runRates)
            + toUSD(e.bankingFee ?? 0, e.bankingFeeCurrency ?? e.currency, runRates), 0)
      : 0;
    const paidCount = run ? run.entries.filter(e => e.isPaid).length : 0;
    const totalCount = run ? run.entries.length : 0;
    const isPartial = !isProcessed && paidCount > 0 && paidCount < totalCount;

    const currTotals: Record<string, number> = {};
    for (const e of run?.entries ?? []) {
      currTotals[e.currency] = (currTotals[e.currency] ?? 0) + e.salary;
      if (e.bankingFee && e.bankingFee > 0) {
        const feeCur = e.bankingFeeCurrency ?? e.currency;
        currTotals[feeCur] = (currTotals[feeCur] ?? 0) + e.bankingFee;
      }
    }
    const [[primaryCurrency = "", primaryAmount = 0] = []] = Object.entries(currTotals).sort(([,a],[,b]) => b - a);

    months.push({ month: m, year: y, label: `${MONTH_NAMES_LONG[m - 1]} ${y}`, run, isCurrent, isPast, isFuture, isSelected, isProcessed, isPartial, paidCount, totalCount, monthUsdTotal, primaryCurrency, primaryAmount });
  }
  return months;
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const session = await auth();
  const canWrite = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null).payroll === "write";

  const [runs, rates, sp, allPeople, horizonSetting, allPersonExpenses, currencySetting, budgets] = await Promise.all([
    prisma.payrollRun.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
      include: {
        entries: {
          orderBy: { salary: "desc" },
          select: {
            id: true, personId: true, employeeName: true,
            salary: true, currency: true, isPaid: true, note: true, salaryComponents: true, zohoExpenseId: true, payslipSentCount: true, bankingFee: true, bankingFeeCurrency: true,
            budgetId: true, budget: { select: { id: true, name: true, color: true } },
            person: { select: { id: true, name: true, email: true, contractEnd: true, payslipInContractCurrency: true } },
          },
        },
        document: { select: { id: true, filename: true, createdAt: true } },
      },
    }),
    getLiveUsdRates(),
    searchParams,
    prisma.person.findMany({ select: { id: true, name: true, jobTitle: true }, orderBy: { name: "asc" } }),
    prisma.setting.findUnique({ where: { key: "payrollHorizonYear" } }),
    prisma.expense.findMany({
      where: {
        personId: { not: null },
        amount:   { not: null },
        OR: [{ claimStatus: null }, { claimStatus: "approved" }],
      },
      select: { id: true, personId: true, name: true, amount: true, currency: true, expenseType: true, dueOn: true, asanaCreatedAt: true, createdAt: true, completed: true, payrollMonth: true, payrollYear: true },
      orderBy: { asanaCreatedAt: "desc" },
    }),
    prisma.setting.findUnique({ where: { key: "activeCurrencies" } }),
    prisma.budget.findMany({
      where: { active: true },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const horizonYear = horizonSetting ? parseInt(horizonSetting.value, 10) : null;
  const activeCurrencies: string[] = (() => {
    try { return JSON.parse(currencySetting?.value ?? "[]") as string[]; }
    catch { return ["USD", "AED"]; }
  })();
  if (!activeCurrencies.includes("USD")) activeCurrencies.unshift("USD");

  // Build a deduplicated staff list — one row per unique employee name across all runs
  // Runs are ordered by year/month desc, so the first entry seen for a person is the most recent.
  const staffMap = new Map<string, {
    employeeName: string;
    personId: string | null;
    personName: string | null;
    budgetId: string | null;
    budgetName: string | null;
    budgetColor: string | null;
  }>();
  for (const run of runs) {
    for (const entry of run.entries) {
      const key = entry.employeeName.trim().toLowerCase();
      const existing = staffMap.get(key);
      if (!existing) {
        staffMap.set(key, {
          employeeName: entry.employeeName.trim(),
          personId: entry.personId ?? null,
          personName: entry.person?.name ?? null,
          budgetId: entry.budgetId ?? null,
          budgetName: entry.budget?.name ?? null,
          budgetColor: entry.budget?.color ?? null,
        });
      } else {
        // Prefer linked person if we find one
        if (!existing.personId && entry.personId) {
          existing.personId = entry.personId;
          existing.personName = entry.person?.name ?? null;
        }
      }
    }
  }
  const staffList = Array.from(staffMap.values())
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const allLinkedPersonIds = staffList
    .filter(s => s.personId)
    .map(s => s.personId!);

  const latest = runs[0] ?? null;

  const nowMonth = new Date().getMonth() + 1;
  const nowYear  = new Date().getFullYear();
  const selectedMonth = sp.month ? parseInt(sp.month) : nowMonth;
  const selectedYear  = sp.year  ? parseInt(sp.year)  : nowYear;

  // Contract-based salary schedule entries for the selected month
  const contractSchedules = await prisma.paymentSchedule.findMany({
    where: {
      dueDate: {
        gte: new Date(selectedYear, selectedMonth - 1, 1),
        lt:  new Date(selectedYear, selectedMonth, 1),
      },
    },
    include: {
      document: {
        select: { docType: true, person: { select: { id: true, name: true } } },
      },
    },
  });
  const contractSalaries = contractSchedules.filter(
    (s) => s.document.docType === "employee_contract" && s.document.person !== null
  );

  const selectedRun = runs.find((r) => r.month === selectedMonth && r.year === selectedYear) ?? null;
  const selectedIsFuture = selectedYear * 12 + selectedMonth > nowYear * 12 + nowMonth;
  const selectedIsPast = selectedYear * 12 + selectedMonth < nowYear * 12 + nowMonth;
  const calendarMonths = buildCalendarWindow(runs, rates, selectedMonth, selectedYear, horizonYear);

  // Add expense/claim totals to each calendar month (salary-only by default)
  const claimsTotalByMonthKey = new Map<number, number>();
  for (const e of allPersonExpenses) {
    if (e.amount == null) continue;
    let m: number, y: number;
    if (e.payrollMonth != null && e.payrollYear != null) {
      m = e.payrollMonth; y = e.payrollYear;
    } else {
      const d = e.dueOn ?? e.asanaCreatedAt ?? e.createdAt;
      m = d.getMonth() + 1; y = d.getFullYear();
    }
    const key = y * 12 + (m - 1);
    claimsTotalByMonthKey.set(key, (claimsTotalByMonthKey.get(key) ?? 0) + toUSD(e.amount, e.currency, rates));
  }
  for (const cm of calendarMonths) {
    const key = cm.year * 12 + (cm.month - 1);
    cm.monthUsdTotal += claimsTotalByMonthKey.get(key) ?? 0;
  }

  const rateIsLocked  = !!(selectedRun?.isProcessed && selectedRun?.fxRateSnapshot);
  const rateIsCustom  = !!(selectedRun?.fxRateSnapshot && !rateIsLocked);
  const hasRateSnapshot = !!(selectedRun?.fxRateSnapshot);
  let displayRates = rates;
  if (selectedIsPast && !hasRateSnapshot) {
    const refDate = new Date(selectedYear, selectedMonth, 0); // last day of selected month
    const historical = await getHistoricalUsdRates(refDate);
    if (historical) displayRates = historical;
  }
  const rateIsHistorical = !hasRateSnapshot && displayRates !== rates;
  const selectedRunRates = effectiveRates(selectedRun, displayRates);
  const selectedClaimsUsd = allPersonExpenses.reduce((s, e) => {
    if (e.amount == null) return s;
    if (e.payrollMonth != null && e.payrollYear != null) {
      if (e.payrollMonth !== selectedMonth || e.payrollYear !== selectedYear) return s;
    } else {
      const d = e.dueOn ?? e.asanaCreatedAt ?? e.createdAt;
      const mStart = new Date(selectedYear, selectedMonth - 1, 1);
      const mEnd   = new Date(selectedYear, selectedMonth, 1);
      if (d < mStart || d >= mEnd) return s;
    }
    return s + toUSD(e.amount, e.currency, selectedRunRates);
  }, 0);
  const selectedUsdTotal = selectedRun
    ? selectedRun.entries.reduce((s, e) =>
        s + toUSD(e.salary, e.currency, selectedRunRates)
          + toUSD(e.bankingFee ?? 0, e.bankingFeeCurrency ?? e.currency, selectedRunRates), 0)
        + selectedClaimsUsd
    : 0;
  const hasNonUsd = selectedRun
    ? selectedRun.entries.some((e) => e.currency !== "USD")
    : false;
  const selectedPaidCount = selectedRun ? selectedRun.entries.filter(e => e.isPaid).length : 0;
  const selectedTotalCount = selectedRun ? selectedRun.entries.length : 0;
  const usdToEgp = selectedRunRates.EGP ?? null;

  // Primary currency for the selected run (dominant currency by total salary)
  const selectedCurrTotals: Record<string, number> = {};
  for (const e of selectedRun?.entries ?? []) selectedCurrTotals[e.currency] = (selectedCurrTotals[e.currency] ?? 0) + e.salary;
  const [[selectedPrimaryCurrency = "USD", selectedPrimaryTotal = 0] = []] = Object.entries(selectedCurrTotals).sort(([,a],[,b]) => b - a);
  const runCurrencies = [...new Set(selectedRun?.entries.map(e => e.currency) ?? [])].filter(c => c !== "USD");
  const primaryRate = selectedPrimaryCurrency !== "USD" ? (selectedRunRates[selectedPrimaryCurrency] ?? null) : null;

  // Contract employees not yet in the selected run
  const existingRunPersonIds = new Set(
    selectedRun?.entries.map((e) => e.personId).filter(Boolean) ?? []
  );
  const missingContractCount = contractSalaries.filter(
    (s) => s.document.person && !existingRunPersonIds.has(s.document.person.id)
  ).length;
  const selectedLabel = `${MONTH_NAMES_LONG[selectedMonth - 1]} ${selectedYear}`;

  // Build a map of personId -> expenses that fall in the selected month
  const monthStart = new Date(selectedYear, selectedMonth - 1, 1);
  const monthEnd   = new Date(selectedYear, selectedMonth, 1);
  const expensesByPerson = new Map<string, typeof allPersonExpenses>();
  for (const e of allPersonExpenses) {
    if (e.payrollMonth != null && e.payrollYear != null) {
      if (e.payrollMonth !== selectedMonth || e.payrollYear !== selectedYear) continue;
    } else {
      const eDate = e.dueOn ?? e.asanaCreatedAt ?? e.createdAt;
      if (eDate < monthStart || eDate >= monthEnd) continue;
    }
    const pid = e.personId!;
    if (!expensesByPerson.has(pid)) expensesByPerson.set(pid, []);
    expensesByPerson.get(pid)!.push(e);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Team" }, { label: "Payroll" }]} />

        <main className="px-4 sm:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
              <p className="text-sm text-gray-500 mt-1">
                Monthly payroll sheets — employee salaries extracted automatically from uploaded XLSX files.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/payroll/costs"
                className="flex items-center gap-1.5 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M7 4.5v2.3l1.5 1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                People Cost
              </Link>
              {canWrite && (
                <Link
                  href="/"
                  className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 2v6M4 5l3-3 3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 11h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Upload payroll
                </Link>
              )}
            </div>
          </div>

          {runs.length === 0 ? (
            <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                  <path d="M12 7v2.5m0 5V17m-3-4h4.5a1.5 1.5 0 0 0 0-3H10a1.5 1.5 0 0 1 0-3H14" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">No payroll records yet</p>
              <p className="text-sm text-gray-400 max-w-sm">
                Upload a monthly payroll XLSX and OpsMind will extract every employee name and salary automatically.
              </p>
              <Link href="/" className="mt-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
                Upload a payroll sheet →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              {/* ── Left: calendar + stats + month detail ── */}
              <div className="flex-1 min-w-0">
              {/* Payroll calendar */}
              <div className="mb-6">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Payroll calendar</h2>
                <PayrollCalendar
                  nowYear={nowYear}
                  nowMonth={nowMonth}
                  canWrite={canWrite}
                  months={calendarMonths.map((cm): CalendarMonthData => ({
                    month: cm.month,
                    year: cm.year,
                    runId: cm.run?.id ?? null,
                    hasRun: cm.run !== null,
                    isCurrent: cm.isCurrent,
                    isPast: cm.isPast,
                    isFuture: cm.isFuture,
                    isSelected: cm.isSelected,
                    isProcessed: cm.isProcessed,
                    isPartial: cm.isPartial,
                    paidCount: cm.paidCount,
                    totalCount: cm.totalCount,
                    monthUsdTotal: cm.monthUsdTotal,
                    primaryCurrency: cm.primaryCurrency,
                    primaryAmount: cm.primaryAmount,
                  }))}
                />
              </div>

              {/* Stats for selected period */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-white border border-surface-border rounded-xl p-4">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Selected period</p>
                  <p className="text-xl font-bold text-gray-900">{selectedLabel}</p>
                  {selectedRun && (
                    <span className={`mt-1 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      selectedRun.isProcessed ? "text-green-700 bg-green-100" :
                      selectedRun.entries.filter(e => e.isPaid).length > 0 ? "text-amber-700 bg-amber-50" :
                      selectedIsFuture ? "text-blue-700 bg-blue-50" : "text-violet-700 bg-violet-50"
                    }`}>
                      {selectedRun.isProcessed ? "Processed" :
                       selectedRun.entries.filter(e => e.isPaid).length > 0 ? `Partial (${selectedPaidCount}/${selectedTotalCount})` :
                       selectedIsFuture ? "Upcoming" : "Pending"}
                    </span>
                  )}
                </div>
                <div className="bg-white border border-surface-border rounded-xl p-4">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Employees on payroll</p>
                  <p className="text-2xl font-bold text-gray-900">{selectedRun?.entries.length ?? "—"}</p>
                </div>
                <div className="bg-white border border-surface-border rounded-xl p-4">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Total payroll</p>
                  {selectedRun ? (
                    <>
                      <p className="text-2xl font-bold text-gray-900">
                        USD {selectedUsdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                      {usdToEgp && (
                        <>
                          <p className="text-sm text-gray-500 mt-0.5">
                            EGP {(selectedUsdTotal * usdToEgp).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            1 USD = {usdToEgp.toFixed(2)} EGP
                            {rateIsLocked
                              ? <span className="ml-1 text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">rate at processing</span>
                              : rateIsCustom
                                ? <span className="ml-1 text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">custom rate</span>
                                : <span className="ml-1 text-gray-300">· {rateIsHistorical ? "historical" : "live"} rate</span>}
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-2xl font-bold text-gray-300">—</p>
                  )}
                </div>
              </div>

              {/* Exchange rate notice */}
              {hasNonUsd && usdToEgp && (
                <div className="flex items-center gap-2 mb-4 text-xs text-gray-400">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="#9ca3af" strokeWidth="1.2" />
                    <path d="M6 4v2.5M6 8v.5" stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {rateIsLocked ? (
                    <span>
                      Non-USD salaries shown at rate locked when this payroll was processed
                      {selectedRun?.processedAt
                        ? ` (${new Date(selectedRun.processedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })})` : ""
                      } — 1 USD = {usdToEgp.toFixed(2)} EGP
                    </span>
                  ) : rateIsCustom ? (
                    <span>
                      Non-USD salaries shown at custom rate — 1 USD = {usdToEgp.toFixed(2)} EGP
                    </span>
                  ) : (
                    <span>
                      Non-USD salaries converted at {rateIsHistorical ? `historical rate for ${selectedLabel}` : "live rate"}
                      {" "}(1 USD = {usdToEgp?.toFixed(2)} EGP)
                    </span>
                  )}
                </div>
              )}

              {/* Selected run detail */}
              <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">{selectedLabel} payroll</h2>
                    {selectedRun?.document && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Uploaded {formatDateTime(selectedRun.document.createdAt)} ·{" "}
                        <Link href={`/records/${selectedRun.document.id}`} className="text-gray-500 hover:underline">
                          view document
                        </Link>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {selectedRun && missingContractCount > 0 && (
                      <GeneratePayrollButton
                        hidden={!canWrite}
                        month={selectedMonth}
                        year={selectedYear}
                        count={missingContractCount}
                        mode="sync"
                      />
                    )}
                    {selectedRun && runCurrencies.length > 0 && (
                      <PayrollFxRateEditor
                        hidden={!canWrite}
                        runId={selectedRun.id}
                        currencies={runCurrencies}
                        currentRates={selectedRunRates}
                        hasSnapshot={hasRateSnapshot}
                      />
                    )}
                    {selectedRun && !selectedIsFuture && (
                      <MarkPayrollProcessedButton
                        hidden={!canWrite}
                        key={`${selectedRun.id}-${selectedRun.isProcessed}-${selectedPaidCount}`}
                        runId={selectedRun.id}
                        isProcessed={selectedRun.isProcessed}
                        processedAt={selectedRun.processedAt}
                        paidCount={selectedPaidCount}
                        totalCount={selectedTotalCount}
                      />
                    )}
                  </div>
                </div>

                {selectedRun ? (
                  <div>
                    {/* Status chips */}
                    {(() => {
                      const now = new Date();
                      const runDate = selectedRun.month && selectedRun.year
                        ? new Date(selectedRun.year, selectedRun.month, 0)
                        : null;
                      const isRunOverdue = runDate ? runDate < now : false;
                      const overdueCount = isRunOverdue ? selectedRun.entries.filter(e => !e.isPaid).length : 0;
                      const paidCount    = selectedRun.entries.filter(e => e.isPaid).length;
                      const upcomingCount = selectedRun.entries.filter(e => !e.isPaid).length - overdueCount;
                      if (overdueCount === 0 && paidCount === 0 && upcomingCount === 0) return null;
                      return (
                        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-surface-border bg-surface-inset">
                          {overdueCount > 0 && (
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-50 px-2.5 py-1 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />{overdueCount} overdue
                            </span>
                          )}
                          {upcomingCount > 0 && (
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 bg-violet-50 px-2.5 py-1 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />{upcomingCount} upcoming
                            </span>
                          )}
                          {paidCount > 0 && (
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{paidCount} paid
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Employee rows */}
                    {(() => {
                      const now = new Date();
                      const runDate = selectedRun.month && selectedRun.year
                        ? new Date(selectedRun.year, selectedRun.month, 0)
                        : null;
                      const entryRows: EntryRow[] = selectedRun.entries.map(entry => {
                        const usdEquiv = toUSD(entry.salary, entry.currency, selectedRunRates);
                        const personClaims = entry.personId ? (expensesByPerson.get(entry.personId) ?? []) : [];
                        const claimsUsd = personClaims.reduce((s, c) => s + toUSD(c.amount!, c.currency, selectedRunRates), 0);
                        return {
                          id: entry.id,
                          employeeName: entry.employeeName,
                          salary: entry.salary,
                          currency: entry.currency,
                          isPaid: entry.isPaid,
                          note: entry.note ?? null,
                          salaryComponents: entry.salaryComponents ?? null,
                          zohoExpenseId: entry.zohoExpenseId ?? null,
                          payslipSentCount: entry.payslipSentCount,
                          bankingFee: entry.bankingFee ?? null,
                          bankingFeeCurrency: entry.bankingFeeCurrency ?? null,
                          budgetId: entry.budgetId ?? null,
                          personId: entry.personId ?? null,
                          person: entry.person ? {
                            id: entry.person.id,
                            name: entry.person.name ?? null,
                            email: entry.person.email ?? null,
                            contractEnd: entry.person.contractEnd ? entry.person.contractEnd.toISOString() : null,
                            payslipInContractCurrency: entry.person.payslipInContractCurrency ?? false,
                          } : null,
                          usdEquiv,
                          isOverdue: !entry.isPaid && runDate ? runDate < now : false,
                          isNonUsd: entry.currency !== "USD",
                          personClaims: personClaims.map(c => ({ id: c.id, name: c.name, amount: c.amount!, currency: c.currency })),
                          claimsUsd,
                        };
                      });
                      return (
                        <PayrollEntryListClient
                          entries={entryRows}
                          budgets={budgets}
                          activeCurrencies={activeCurrencies}
                          allPeople={allPeople}
                          allLinkedPersonIds={allLinkedPersonIds}
                          canWrite={canWrite}
                          rates={selectedRunRates}
                        />
                      );
                    })()}

                    {/* Total footer */}
                    <div className="flex items-center justify-between px-5 py-3 border-t border-surface-border bg-surface-inset">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</span>
                      <span className="text-sm font-bold text-gray-900 tabular-nums">
                        USD {selectedUsdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                ) : contractSalaries.length > 0 ? (
                  <div className="px-5 py-12 flex flex-col items-center gap-4 text-center">
                    <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center">
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 15c0-2.5 2.2-4 5-4M10 13h6M13 10v6" stroke="#6b7280" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {contractSalaries.length} {contractSalaries.length === 1 ? "employee" : "employees"} on active contracts this month
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Generate payroll from their contracts, or upload a payroll sheet manually.
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <GeneratePayrollButton
                        hidden={!canWrite}
                        month={selectedMonth}
                        year={selectedYear}
                        count={contractSalaries.length}
                        mode="generate"
                      />
                      {canWrite && (
                        <Link href="/" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                          Upload sheet instead →
                        </Link>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-14 flex flex-col items-center gap-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center mb-1">
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <path d="M9 4v5M9 11.5v.5" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" />
                        <circle cx="9" cy="9" r="7" stroke="#d1d5db" strokeWidth="1.5" fill="none" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-gray-500">No payroll for {selectedLabel}</p>
                    <p className="text-xs text-gray-400">Upload a payroll sheet or add employee contracts to generate payroll automatically.</p>
                    <Link href="/" className="mt-2 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors">
                      Upload payroll →
                    </Link>
                  </div>
                )}
              </div>
              </div>{/* end left column */}

              {/* ── Right: staff links + budget assignments (tabbed, sticky) ── */}
              {staffList.length > 0 && (
                <PayrollRightPanel
                  staffList={staffList}
                  budgets={budgets}
                  allPeople={allPeople}
                  allLinkedPersonIds={allLinkedPersonIds}
                  canWrite={canWrite}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
