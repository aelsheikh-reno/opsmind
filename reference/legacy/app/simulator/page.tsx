import { prisma } from "@/lib/prisma";
import { getUsdRates, toUSD } from "@/lib/fx";
import { getCashPosition } from "@/lib/wallet";
import { generateVatPeriods } from "@/lib/vat";
import { generateTaxPeriods } from "@/lib/tax";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import SimulatorClient, { BaselineData } from "./SimulatorClient";

function convertToNative(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const usd = toUSD(amount, from, rates);
  if (to === "USD") return usd;
  const targetRate = rates[to];
  return targetRate ? usd * targetRate : usd;
}

export default async function SimulatorPage() {
  const rates = await getUsdRates();
  const now = new Date();

  // 24 calendar months starting from the current month
  const months = Array.from({ length: 24 }, (_, i) => ({
    index: i,
    start: new Date(now.getFullYear(), now.getMonth() + i, 1),
    end:   new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59),
  }));

  const rangeStart = months[0].start;
  const rangeEnd   = months[23].end;

  // ── 1. People (all with a salary, active or future-exit) ──────────────────
  const people = await prisma.person.findMany({
    where: { salary: { not: null } },
    select: { id: true, name: true, salary: true, salaryCurrency: true, exitDate: true, contractEnd: true },
  });

  // ── 2–4. Scheduled payments and invoices ──────────────────────────────────
  const [leaseSchedules, vatConfigs, allVatPayments, allInvoicesForVat, taxConfigs, allTaxPayments, allInvoicesForTax, futureExpenses, allCapitalInjections] = await Promise.all([
    prisma.paymentSchedule.findMany({
      where: { document: { docType: "lease_contract" }, dueDate: { gte: rangeStart, lte: rangeEnd } },
      select: { amount: true, currency: true, dueDate: true },
    }),
    prisma.vatConfig.findMany({ where: { active: true } }),
    prisma.vatPayment.findMany({
      where: { paidAmount: { not: null } },
      select: { vatConfigId: true, periodStart: true, paidAmount: true, paidAt: true, vatConfig: { select: { currency: true } } },
    }),
    prisma.document.findMany({
      where: { docType: "invoice", amount: { not: null }, vatAmount: { not: null } },
      select: { amount: true, vatAmount: true, currency: true, issueDate: true, createdAt: true, legalEntity: { select: { name: true, country: true } } },
    }),
    prisma.taxConfig.findMany({ where: { active: true } }),
    prisma.taxPayment.findMany({
      where: { paidAmount: { not: null } },
      select: { taxConfigId: true, periodStart: true, paidAmount: true, paidAt: true },
    }),
    prisma.document.findMany({
      where: { docType: "invoice", amount: { not: null } },
      select: { amount: true, currency: true, issueDate: true, expiryDate: true, createdAt: true, legalEntity: { select: { name: true, country: true } } },
    }),
    // All expenses with dueOn in range — paid or pending, projected balance treats all as settled
    prisma.expense.findMany({
      where: {
        dueOn: { gte: rangeStart, lte: rangeEnd },
        amount: { not: null },
        OR: [{ claimStatus: null }, { claimStatus: { not: "rejected" } }],
      },
      select: { amount: true, currency: true, dueOn: true },
    }),
    // All capital injections ever — used for both monthly bucketing and projected opening balance
    prisma.capitalInjection.findMany({
      select: { amount: true, currency: true, date: true },
    }),
  ]);

  // Pre-period items for projectedOpeningBalance: all payroll, leases, expenses (all time)
  const [prePayrollAll, preLeasesAll, preExpensesAll] = await Promise.all([
    prisma.payrollEntry.findMany({
      select: { salary: true, currency: true, payrollRun: { select: { year: true, month: true } } },
    }),
    prisma.paymentSchedule.findMany({
      where: { document: { docType: "lease_contract" } },
      select: { amount: true, currency: true, dueDate: true },
    }),
    prisma.expense.findMany({
      where: {
        amount: { not: null },
        OR: [{ claimStatus: null }, { claimStatus: { not: "rejected" } }],
      },
      select: { amount: true, currency: true, dueOn: true, createdAt: true },
    }),
  ]);

  // ── Build per-month other-expenses map (general expenses + VAT + tax) ──────
  // Deduplicate by rounding periodStart to nearest UTC day (same logic as finances page)
  const dedupedVatPayments = (() => {
    const best = new Map<string, typeof allVatPayments[0]>();
    for (const vp of allVatPayments) {
      const dayKey = Math.round(vp.periodStart.getTime() / 86400000);
      const k = `${vp.vatConfigId}|${dayKey}`;
      const prev = best.get(k);
      if (!prev || (vp.paidAmount ?? -Infinity) > (prev.paidAmount ?? -Infinity)) best.set(k, vp);
    }
    return Array.from(best.values());
  })();
  const paidVatSet = new Set(dedupedVatPayments.map(vp => `${vp.vatConfigId}|${Math.round(vp.periodStart.getTime() / 86400000)}`));
  const paidTaxSet = new Set(allTaxPayments.filter(p => p.paidAmount != null).map(p => `${p.taxConfigId}|${p.periodStart.getTime()}`));

  const monthOtherExpenses = new Map<string, number>();

  // General committed expenses (not yet paid)
  for (const e of futureExpenses) {
    if (!e.dueOn || e.amount == null) continue;
    const d = new Date(e.dueOn);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthOtherExpenses.set(key, (monthOtherExpenses.get(key) ?? 0) + toUSD(e.amount, e.currency, rates));
  }

  // VAT estimates for unpaid future periods
  for (const config of vatConfigs) {
    const periods = generateVatPeriods(config.startDate, config.frequencyMonths, config.anchorMonth, config.filingDeadlineDays, config.periodsAhead);
    for (const period of periods) {
      if (paidVatSet.has(`${config.id}|${Math.round(period.periodStart.getTime() / 86400000)}`)) continue;
      if (period.dueDate < rangeStart || period.dueDate > rangeEnd) continue;
      const key = `${period.dueDate.getFullYear()}-${String(period.dueDate.getMonth() + 1).padStart(2, "0")}`;

      const periodInvoices = allInvoicesForVat.filter(inv => {
        const effectiveDate = inv.issueDate ?? inv.createdAt;
        const entityMatch = config.companyName
          ? inv.legalEntity?.name?.toLowerCase() === config.companyName.toLowerCase() &&
            inv.legalEntity?.country?.toLowerCase() === config.country.toLowerCase()
          : inv.currency === config.currency;
        return entityMatch && effectiveDate != null &&
          new Date(effectiveDate) >= period.periodStart &&
          new Date(effectiveDate) <= period.periodEnd;
      });
      const vatNative = periodInvoices.reduce((s, i) =>
        s + convertToNative(i.vatAmount ?? 0, i.currency ?? config.currency, config.currency, rates), 0);
      if (vatNative <= 0) continue;

      monthOtherExpenses.set(key, (monthOtherExpenses.get(key) ?? 0) + toUSD(vatNative, config.currency, rates));
    }
  }

  // Tax estimates for unpaid future periods
  for (const config of taxConfigs) {
    const periods = generateTaxPeriods(config.startDate, config.frequencyMonths, config.anchorMonth, config.filingDeadlineDays, config.periodsAhead);
    const lastPaidNative = allTaxPayments
      .filter(p => p.taxConfigId === config.id && p.paidAmount != null)
      .sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime())[0]?.paidAmount ?? null;

    for (const period of periods) {
      if (paidTaxSet.has(`${config.id}|${period.periodStart.getTime()}`)) continue;
      if (period.dueDate < rangeStart || period.dueDate > rangeEnd) continue;
      const key = `${period.dueDate.getFullYear()}-${String(period.dueDate.getMonth() + 1).padStart(2, "0")}`;

      const periodRevenue = allInvoicesForTax.reduce((s, inv) => {
        const d = inv.issueDate ?? inv.createdAt;
        if (!d) return s;
        const invDate = new Date(d);
        if (invDate < period.periodStart || invDate > period.periodEnd) return s;
        const entityMatch = config.companyName
          ? inv.legalEntity?.name?.toLowerCase() === config.companyName.toLowerCase()
          : true;
        if (!entityMatch) return s;
        return s + convertToNative(inv.amount!, inv.currency ?? config.currency, config.currency, rates);
      }, 0);

      let taxNative: number;
      if (periodRevenue > 0) {
        const taxableBase = config.thresholdActive && config.profitThreshold
          ? Math.max(0, periodRevenue - config.profitThreshold)
          : periodRevenue;
        taxNative = Math.round(taxableBase * config.rate * 100) / 100;
      } else if (lastPaidNative != null) {
        taxNative = lastPaidNative;
      } else {
        taxNative = 0;
      }

      if (taxNative > 0) {
        monthOtherExpenses.set(key, (monthOtherExpenses.get(key) ?? 0) + toUSD(taxNative, config.currency, rates));
      }
    }
  }

  // ── Capital injections per month (only within the 24-month range) ────────
  const capitalInjections = allCapitalInjections.filter(ci => {
    const d = new Date(ci.date);
    return !isNaN(d.getTime()) && d >= rangeStart && d <= rangeEnd;
  });
  const monthCapital = new Map<string, number>();
  for (const ci of capitalInjections) {
    const d = new Date(ci.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthCapital.set(key, (monthCapital.get(key) ?? 0) + toUSD(ci.amount, ci.currency, rates));
  }

  // ── Projected opening balance: all scheduled items before rangeStart ──────
  // Income: all invoices + all capital before the 24-month window
  // Expenses: all payroll + all leases + all expenses before the window
  // Paid/unpaid status irrelevant — this is the schedule-based projected position.
  const rangeStartKey = rangeStart.getFullYear() * 12 + rangeStart.getMonth() + 1;
  const rangeEndKey   = rangeEnd.getFullYear()   * 12 + rangeEnd.getMonth()   + 1;

  // Payroll from PayrollRun entries for months that have them; fall back to Person.salary otherwise
  const payrollByMonthKey = new Map<string, number>();
  for (const e of prePayrollAll) {
    if (!e.payrollRun.year || !e.payrollRun.month) continue;
    const ym = e.payrollRun.year * 12 + e.payrollRun.month;
    if (ym < rangeStartKey || ym > rangeEndKey) continue;
    const key = `${e.payrollRun.year}-${String(e.payrollRun.month).padStart(2, "0")}`;
    payrollByMonthKey.set(key, (payrollByMonthKey.get(key) ?? 0) + toUSD(e.salary, e.currency, rates));
  }

  let projectedOpeningBalance = 0;

  for (const inv of allInvoicesForTax) {
    if (inv.amount == null || !inv.expiryDate) continue;
    const d = new Date(inv.expiryDate as Date);
    if (isNaN(d.getTime())) continue;
    if (d.getFullYear() * 12 + d.getMonth() + 1 >= rangeStartKey) continue;
    projectedOpeningBalance += toUSD(inv.amount, inv.currency ?? "USD", rates);
  }

  for (const ci of allCapitalInjections) {
    const d = new Date(ci.date);
    if (isNaN(d.getTime()) || d >= rangeStart) continue;
    projectedOpeningBalance += toUSD(ci.amount, ci.currency, rates);
  }

  for (const e of prePayrollAll) {
    if (!e.payrollRun.year || !e.payrollRun.month) continue;
    if (e.payrollRun.year * 12 + e.payrollRun.month >= rangeStartKey) continue;
    projectedOpeningBalance -= toUSD(e.salary, e.currency, rates);
  }

  for (const s of preLeasesAll) {
    const d = new Date(s.dueDate);
    if (isNaN(d.getTime()) || d >= rangeStart) continue;
    projectedOpeningBalance -= toUSD(s.amount, s.currency, rates);
  }

  for (const e of preExpensesAll) {
    if (e.amount == null) continue;
    const d = new Date((e.dueOn ?? e.createdAt) as Date);
    if (isNaN(d.getTime())) continue;
    if (d.getFullYear() * 12 + d.getMonth() + 1 >= rangeStartKey) continue;
    projectedOpeningBalance -= toUSD(e.amount, e.currency, rates);
  }

  // Past VAT payments reduce the opening balance (same as the finances page projected balance)
  for (const vp of dedupedVatPayments) {
    if (!vp.paidAt || vp.paidAmount == null) continue;
    const d = new Date(vp.paidAt);
    if (isNaN(d.getTime()) || d >= rangeStart) continue;
    projectedOpeningBalance -= toUSD(vp.paidAmount, vp.vatConfig.currency, rates);
  }

  // Past tax payments reduce the opening balance
  for (const tp of allTaxPayments) {
    if (!tp.paidAt || tp.paidAmount == null || tp.paidAmount <= 0) continue;
    const d = new Date(tp.paidAt);
    if (isNaN(d.getTime()) || d >= rangeStart) continue;
    const config = taxConfigs.find(c => c.id === tp.taxConfigId);
    if (!config) continue;
    projectedOpeningBalance -= toUSD(tp.paidAmount, config.currency, rates);
  }

  projectedOpeningBalance = Math.round(projectedOpeningBalance);

  // ── Build per-month snapshots ─────────────────────────────────────────────
  const monthSnapshots = months.map(({ start, end }) => {
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;

    const payrollUSD = payrollByMonthKey.has(monthKey)
      ? payrollByMonthKey.get(monthKey)!
      : people.reduce((sum, p) => {
          const notExited      = !p.exitDate   || p.exitDate   >= start;
          const contractActive = !p.contractEnd || p.contractEnd >= start;
          if (!notExited || !contractActive) return sum;
          return sum + toUSD(p.salary!, p.salaryCurrency ?? "USD", rates);
        }, 0);

    const leasesUSD = leaseSchedules
      .filter((s) => s.dueDate >= start && s.dueDate <= end)
      .reduce((sum, s) => sum + toUSD(s.amount, s.currency, rates), 0);

    // Revenue: all invoices by expiryDate only — matches finance page's strict expiryDate filter
    const revUSD = allInvoicesForTax
      .filter(inv => {
        if (inv.amount == null || !inv.expiryDate) return false;
        const d = new Date(inv.expiryDate as Date);
        if (isNaN(d.getTime())) return false;
        return d >= start && d <= end;
      })
      .reduce((sum, inv) => sum + toUSD(inv.amount!, inv.currency ?? "USD", rates), 0);

    return {
      payrollUSD:       Math.round(payrollUSD),
      leasesUSD:        Math.round(leasesUSD),
      revenueUSD:       Math.round(revUSD),
      otherExpensesUSD: Math.round(monthOtherExpenses.get(monthKey) ?? 0),
      capitalUSD:       Math.round(monthCapital.get(monthKey) ?? 0),
    };
  });

  const totals = monthSnapshots.reduce<{ payrollUSD: number; leasesUSD: number; revenueUSD: number; otherExpensesUSD: number; capitalUSD: number; netUSD: number }>(
    (acc, m) => ({
      payrollUSD:       acc.payrollUSD       + m.payrollUSD,
      leasesUSD:        acc.leasesUSD        + m.leasesUSD,
      revenueUSD:       acc.revenueUSD       + m.revenueUSD,
      otherExpensesUSD: acc.otherExpensesUSD + m.otherExpensesUSD,
      capitalUSD:       acc.capitalUSD       + m.capitalUSD,
      netUSD:           acc.netUSD           + m.revenueUSD + m.capitalUSD - m.payrollUSD - m.leasesUSD - m.otherExpensesUSD,
    }),
    { payrollUSD: 0, leasesUSD: 0, revenueUSD: 0, otherExpensesUSD: 0, capitalUSD: 0, netUSD: 0 }
  );

  // ── Current cash balance (shared with finances page and command center) ────
  const { currentCashNet: currentCashUSD } = await getCashPosition(rates);

  const activePeople = people
    .filter((p) => !p.exitDate || p.exitDate >= rangeStart)
    .map((p) => ({
      id: p.id,
      name: p.name,
      salaryUSD: Math.round(toUSD(p.salary!, p.salaryCurrency ?? "USD", rates)),
    }));

  const baseline: BaselineData = { months: monthSnapshots, totals, currentCashUSD, projectedOpeningBalance, people: activePeople };

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Simulator" }]} />
        <main className="px-4 sm:px-8 py-4 sm:py-6 max-w-6xl">
          <SimulatorClient baseline={baseline} />
        </main>
      </div>
    </div>
  );
}
