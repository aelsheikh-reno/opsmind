import { prisma } from "@/lib/prisma";
import { toUSD } from "@/lib/fx";

/**
 * Computes the all-time cash position using the same logic as the finances page wallet.
 * Income  = paid invoices + capital injections (converted to USD at live rates).
 * Expenses = paid payroll + paid lease schedules + completed expenses + paid VAT + paid taxes.
 */
export async function getCashPosition(rates: Record<string, number>): Promise<{
  currentCashNet: number;
  totalIncome: number;
  totalExpenses: number;
}> {
  const [
    paidInvoices,
    paidPayrollEntries,
    paidLeaseSchedules,
    completedExpenses,
    paidVatPayments,
    paidTaxPayments,
    capitalInjections,
    taxConfigs,
  ] = await Promise.all([
    prisma.document.findMany({
      where: { docType: "invoice", isPaid: true },
      select: { amount: true, currency: true, issueDate: true, expiryDate: true },
    }),
    prisma.payrollEntry.findMany({
      where: { isPaid: true },
      select: { salary: true, currency: true, payrollRun: { select: { year: true, month: true } } },
    }),
    prisma.paymentSchedule.findMany({
      where: { isPaid: true, document: { docType: "lease_contract" } },
      select: { amount: true, currency: true, dueDate: true },
    }),
    prisma.expense.findMany({
      where: {
        completed: true,
        amount: { not: null },
        expenseType: { not: "banking_fee" },
        OR: [{ claimStatus: null }, { claimStatus: { not: "rejected" } }],
      },
      select: { amount: true, currency: true, dueOn: true, asanaCreatedAt: true, createdAt: true },
    }),
    prisma.vatPayment.findMany({
      where: { paidAmount: { not: null }, paidAt: { not: null } },
      include: { vatConfig: { select: { currency: true } } },
    }),
    prisma.taxPayment.findMany({
      where: { paidAmount: { not: null }, paidAt: { not: null } },
      include: { taxConfig: { select: { id: true, currency: true } } },
    }),
    prisma.capitalInjection.findMany({
      select: { amount: true, currency: true, date: true },
    }),
    prisma.taxConfig.findMany({
      where: { active: true },
      select: { id: true, currency: true },
    }),
  ]);

  const walletMap = new Map<number, { income: number; expenses: number }>();

  function addIncome(year: number, usd: number) {
    const we = walletMap.get(year) ?? { income: 0, expenses: 0 };
    we.income += usd;
    walletMap.set(year, we);
  }

  function addExpense(year: number, usd: number) {
    const we = walletMap.get(year) ?? { income: 0, expenses: 0 };
    we.expenses += usd;
    walletMap.set(year, we);
  }

  for (const inv of paidInvoices) {
    const d = new Date((inv.issueDate ?? inv.expiryDate) as Date);
    if (isNaN(d.getTime())) continue;
    addIncome(d.getFullYear(), toUSD(inv.amount ?? 0, inv.currency ?? "USD", rates));
  }

  for (const e of paidPayrollEntries) {
    if (!e.payrollRun.year || !e.payrollRun.month) continue;
    addExpense(e.payrollRun.year, toUSD(e.salary, e.currency, rates));
  }

  for (const s of paidLeaseSchedules) {
    const d = new Date(s.dueDate);
    if (isNaN(d.getTime())) continue;
    addExpense(d.getFullYear(), toUSD(s.amount, s.currency, rates));
  }

  for (const e of completedExpenses) {
    if (e.amount == null) continue;
    const d = new Date((e.dueOn ?? e.asanaCreatedAt ?? e.createdAt) as Date);
    if (isNaN(d.getTime())) continue;
    addExpense(d.getFullYear(), toUSD(e.amount, e.currency, rates));
  }

  // Deduplicate VAT payments by rounding periodStart to nearest UTC day — same logic as finances page.
  // Timezone differences can produce two DB records for the same period; keep the one with highest paidAmount.
  const dedupedVatPayments = (() => {
    const best = new Map<string, typeof paidVatPayments[0]>();
    for (const vp of paidVatPayments) {
      const dayKey = Math.round(vp.periodStart.getTime() / 86400000);
      const k = `${vp.vatConfigId}|${dayKey}`;
      const prev = best.get(k);
      if (!prev || (vp.paidAmount ?? -Infinity) > (prev.paidAmount ?? -Infinity)) best.set(k, vp);
    }
    return Array.from(best.values());
  })();

  for (const vp of dedupedVatPayments) {
    if (!vp.paidAt || vp.paidAmount == null) continue;
    const d = new Date(vp.paidAt);
    if (isNaN(d.getTime())) continue;
    addExpense(d.getFullYear(), toUSD(vp.paidAmount, vp.vatConfig.currency, rates));
  }

  for (const tp of paidTaxPayments) {
    if (!tp.paidAt || tp.paidAmount == null || tp.paidAmount <= 0) continue;
    // Use the embedded taxConfig currency (via include) — no separate lookup needed.
    const currency = tp.taxConfig?.currency ?? taxConfigs.find(c => c.id === tp.taxConfigId)?.currency;
    if (!currency) continue;
    const d = new Date(tp.paidAt);
    if (isNaN(d.getTime())) continue;
    addExpense(d.getFullYear(), toUSD(tp.paidAmount, currency, rates));
  }

  for (const ci of capitalInjections) {
    const d = new Date(ci.date);
    if (isNaN(d.getTime())) continue;
    addIncome(d.getFullYear(), toUSD(ci.amount, ci.currency, rates));
  }

  // Mirror the finances page: round per-year net before summing
  let currentCashNet = 0;
  let totalIncome    = 0;
  let totalExpenses  = 0;
  for (const v of walletMap.values()) {
    currentCashNet += Math.round(v.income - v.expenses);
    totalIncome    += Math.round(v.income);
    totalExpenses  += Math.round(v.expenses);
  }

  return { currentCashNet, totalIncome, totalExpenses };
}
