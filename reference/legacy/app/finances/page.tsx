import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { getUsdRates, toUSD, getBestMonthRates } from "@/lib/fx";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import Link from "next/link";
import { MonthBar, InvoiceDetail, PayrollItem, PaymentItem, ExpenseItem, VatItem, TaxItem } from "./CommitmentChart";
import { generateVatPeriods } from "@/lib/vat";
import { generateTaxPeriods } from "@/lib/tax";
import PeriodSelector from "./PeriodSelector";
import FinanceKPIs from "./FinanceKPIs";
import CapitalManager from "./CapitalManager";

type MonthDef = { year: number; month: number; key: string; label: string };

function parsePeriod(period: string): { months: MonthDef[]; rangeStart: Date; rangeEnd: Date; label: string } {
  const now = new Date();

  const fyMatch = period.match(/^fy(\d{4})$/);
  if (fyMatch) {
    const year = parseInt(fyMatch[1]);
    const rangeStart = new Date(year, 0, 1);
    const rangeEnd   = new Date(year, 11, 31);
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(year, i, 1);
      return {
        year,
        month: i + 1,
        key: `${year}-${String(i + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      };
    });
    return { months, rangeStart, rangeEnd, label: `FY ${year}` };
  }

  const rollMatch = period.match(/^(\d+)m$/);
  const n = rollMatch ? Math.min(parseInt(rollMatch[1]), 36) : 12;
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rangeEnd   = new Date(now.getFullYear(), now.getMonth() + n, 0);
  const months = Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
    };
  });
  return { months, rangeStart, rangeEnd, label: `next ${n} months` };
}

function convertToNative(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const usd = toUSD(amount, from, rates);
  if (to === "USD") return usd;
  const targetRate = rates[to];
  return targetRate ? usd * targetRate : usd;
}

function fmtUsd(v: number) {
  if (v <= 0) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtNative(amount: number, currency: string): string {
  const n = Math.round(amount).toLocaleString("en-US");
  return currency === "USD" ? `$${n}` : `${currency} ${n}`;
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period = "12m" } = await searchParams;
  const { months, rangeStart, rangeEnd, label: periodLabel } = parsePeriod(period);

  const today = new Date();

  const [payrollEntries, paymentSchedules, invoices, overdueInvoices, overdueSchedules, rates, paidInvoices, paidPayrollEntries, paidLeaseSchedules, paidSchedulesInPeriod, allExpenses, capitalInjections] = await Promise.all([
    prisma.payrollEntry.findMany({
      where: { isPaid: false },
      select: {
        id: true,
        employeeName: true,
        salary: true,
        currency: true,
        payrollRun: { select: { year: true, month: true } },
      },
    }),
    prisma.paymentSchedule.findMany({
      where: { isPaid: false, dueDate: { gte: rangeStart, lte: rangeEnd } },
      select: {
        id: true,
        dueDate: true,
        amount: true,
        currency: true,
        description: true,
        invoiceId: true,
        document: { select: { id: true, docType: true, filename: true, parties: true } },
      },
    }),
    prisma.document.findMany({
      where: {
        docType: "invoice",
        expiryDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, issueDate: true, expiryDate: true, amount: true, currency: true, parties: true, referenceNumber: true, isPaid: true },
    }),
    // Carry-over: unpaid invoices due BEFORE the selected period
    prisma.document.findMany({
      where: { docType: "invoice", isPaid: false, expiryDate: { lt: rangeStart } },
      select: { id: true, amount: true, currency: true, referenceNumber: true, parties: true },
    }),
    // Carry-over: unpaid vendor/lease payment schedules due BEFORE the selected period
    prisma.paymentSchedule.findMany({
      where: {
        isPaid: false,
        dueDate: { lt: rangeStart },
        document: { docType: { in: ["client_contract", "lease_contract"] } },
      },
      select: {
        id: true, amount: true, currency: true, description: true, invoiceId: true,
        document: { select: { id: true, filename: true, parties: true, docType: true } },
      },
    }),
    getUsdRates(),
    // Wallet — all paid invoices (income side)
    prisma.document.findMany({
      where: { docType: "invoice", isPaid: true },
      select: { amount: true, currency: true, issueDate: true, expiryDate: true },
    }),
    // Wallet — all paid payroll entries (expense side)
    prisma.payrollEntry.findMany({
      where: { isPaid: true },
      select: { salary: true, currency: true, payrollRun: { select: { year: true, month: true } } },
    }),
    // Wallet — all paid lease schedules (expense side)
    prisma.paymentSchedule.findMany({
      where: { isPaid: true, document: { docType: "lease_contract" } },
      select: { amount: true, currency: true, dueDate: true },
    }),
    // Net (actual) KPI — paid lease schedules within the selected period
    // client_contract schedules are receivables (income), not expenses — excluded here
    prisma.paymentSchedule.findMany({
      where: {
        isPaid: true,
        dueDate: { gte: rangeStart, lte: rangeEnd },
        document: { docType: "lease_contract" },
      },
      select: { amount: true, currency: true, dueDate: true },
    }),
    // All expenses with a known amount (Asana + manual imports).
    // claimStatus filter: include null (n/a) and "approved"; exclude only "rejected".
    // { not: "rejected" } alone silently drops NULL rows in SQL, so we OR in the null case.
    // Exclude banking_fee expenses — they are transaction costs logged under payroll, not standalone expenses.
    prisma.expense.findMany({
      where: {
        amount: { not: null },
        expenseType: { not: "banking_fee" },
        OR: [{ claimStatus: null }, { claimStatus: { not: "rejected" } }],
      },
      select: { id: true, name: true, amount: true, currency: true, expenseType: true, dueOn: true, asanaCreatedAt: true, createdAt: true, completed: true, person: { select: { name: true } } },
    }),
    prisma.capitalInjection.findMany({
      orderBy: { date: "desc" },
      select: { id: true, amount: true, currency: true, date: true, source: true, type: true, notes: true },
    }),
  ]);

  // VAT liability data + people for payroll fallback
  const [vatConfigs, allVatPayments, allInvoicesForVat, people] = await Promise.all([
    prisma.vatConfig.findMany({ where: { active: true } }),
    prisma.vatPayment.findMany({
      include: { vatConfig: { select: { currency: true, rate: true, country: true } } },
    }),
    prisma.document.findMany({
      where: { docType: "invoice", amount: { not: null }, vatAmount: { not: null } },
      select: { amount: true, vatAmount: true, currency: true, issueDate: true, createdAt: true, legalEntity: { select: { name: true, country: true } } },
    }),
    prisma.person.findMany({
      where: { salary: { not: null } },
      select: { salary: true, salaryCurrency: true, exitDate: true, contractEnd: true },
    }),
  ]);

  // Tax liability data
  const [taxConfigs, allTaxPayments, allInvoicesForTax] = await Promise.all([
    prisma.taxConfig.findMany({ where: { active: true } }),
    prisma.taxPayment.findMany({ include: { taxConfig: { select: { currency: true } } } }),
    prisma.document.findMany({
      where: { docType: "invoice", amount: { not: null } },
      select: { amount: true, currency: true, issueDate: true, createdAt: true, legalEntity: { select: { name: true, country: true } } },
    }),
  ]);

  const paidTaxSet = new Set(
    allTaxPayments.filter(p => p.paidAmount != null).map(p => `${p.taxConfigId}|${p.periodStart.getTime()}`)
  );

  // Deduplicate vatPayments: timezone differences in stored periodStart can create two records
  // for the same logical period (e.g. Apr 1 stored as Mar 31 20:00 UTC in UTC+4 locale).
  // Round each periodStart to the nearest UTC day to collapse duplicates, keeping highest paidAmount.
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

  const paidVatSet = new Set(
    dedupedVatPayments.filter(p => p.paidAmount != null).map(p => `${p.vatConfigId}|${Math.round(p.periodStart.getTime() / 86400000)}`)
  );

  // Aggregate into month buckets
  type Bucket = {
    key: string; label: string;
    payrollUsd: number; leaseUsd: number; expenseUsd: number; expensePaidUsd: number; expenseUnpaidUsd: number; vatUsd: number; vatPaidUsd: number; taxUsd: number; taxPaidUsd: number;
    paidPayrollUsd: number; paidLeaseUsd: number; capitalUsd: number;
    payrollCount: number; leaseCount: number; expenseCount: number; vatCount: number; taxCount: number;
    payrollItems: PayrollItem[];
    leaseItems: PaymentItem[];
    expenseItems: ExpenseItem[];
    vatItems: VatItem[];
    paidVatItems: { country: string; currency: string; amount: number; periodLabel: string }[];
    taxItems: TaxItem[];
    paidTaxItems: TaxItem[];
    collectedUsd: number; pendingUsd: number; receivableCount: number;
    receivableInvoices: InvoiceDetail[];
  };

  const buckets = new Map<string, Bucket>(
    months.map(m => [m.key, {
      key: m.key, label: m.label,
      payrollUsd: 0, leaseUsd: 0, expenseUsd: 0, expensePaidUsd: 0, expenseUnpaidUsd: 0, vatUsd: 0, vatPaidUsd: 0, taxUsd: 0, taxPaidUsd: 0,
      paidPayrollUsd: 0, paidLeaseUsd: 0, capitalUsd: 0,
      payrollCount: 0, leaseCount: 0, expenseCount: 0, vatCount: 0, taxCount: 0,
      payrollItems: [], leaseItems: [], expenseItems: [], vatItems: [], paidVatItems: [], taxItems: [], paidTaxItems: [],
      collectedUsd: 0, pendingUsd: 0, receivableCount: 0, receivableInvoices: [],
    }])
  );

  for (const e of payrollEntries) {
    if (!e.payrollRun.year || !e.payrollRun.month) continue;
    const key = `${e.payrollRun.year}-${String(e.payrollRun.month).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    b.payrollUsd += toUSD(e.salary, e.currency, rates);
    b.payrollCount++;
    b.payrollItems.push({ id: e.id, employeeName: e.employeeName, amount: e.salary, currency: e.currency });
  }

  // For months with no PayrollRun (paid or unpaid), estimate from Person.salary — same logic as simulator
  const monthsWithPayrollRun = new Set(
    [...payrollEntries, ...paidPayrollEntries]
      .filter(e => e.payrollRun.year && e.payrollRun.month)
      .map(e => `${e.payrollRun.year}-${String(e.payrollRun.month).padStart(2, "0")}`)
  );
  for (const m of months) {
    if (monthsWithPayrollRun.has(m.key)) continue;
    const b = buckets.get(m.key);
    if (!b) continue;
    const monthStart = new Date(m.year, m.month - 1, 1);
    const salaryUsd = people.reduce((sum, p) => {
      const notExited      = !p.exitDate    || new Date(p.exitDate)    >= monthStart;
      const contractActive = !p.contractEnd || new Date(p.contractEnd) >= monthStart;
      if (!notExited || !contractActive) return sum;
      return sum + toUSD(p.salary!, p.salaryCurrency ?? "USD", rates);
    }, 0);
    b.payrollUsd += Math.round(salaryUsd);
  }

  for (const s of paymentSchedules) {
    const d = new Date(s.dueDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    const usd = toUSD(s.amount, s.currency, rates);
    // Derive a human label: description > first party > filename
    const parties: string[] = s.document.parties ? JSON.parse(s.document.parties) : [];
    const label = s.description || parties.find(p => p.trim()) || s.document.filename;
    const item: PaymentItem = { id: s.id, documentId: s.document.id, label, amount: s.amount, currency: s.currency };
    if (s.document.docType === "lease_contract") {
      b.leaseUsd += usd; b.leaseCount++; b.leaseItems.push(item);
    }
  }

  for (const inv of invoices) {
    const invDate = inv.expiryDate ?? inv.issueDate;
    if (!invDate || inv.amount == null || !inv.currency) continue;
    const d = new Date(invDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    const usd = toUSD(inv.amount, inv.currency, rates);
    if (inv.isPaid) {
      b.collectedUsd += usd;
    } else {
      b.pendingUsd += usd;
    }
    b.receivableCount++;
    const parties: string[] = inv.parties ? JSON.parse(inv.parties) : [];
    const vendor = parties.find(p => p.trim()) ?? "Unknown";
    b.receivableInvoices.push({
      id: inv.id,
      vendor,
      referenceNumber: inv.referenceNumber ?? null,
      amount: inv.amount,
      currency: inv.currency,
      isPaid: inv.isPaid,
    });
  }

  // One unified rate map for every month in the view period.
  // Uses the same priority as the Settings exchange rate table:
  // locked PayrollRun snapshot → cached historical → fetched historical → live.
  // This single map drives both expense calculations AND the per-month FX label.
  const periodMonthRates = new Map<string, Record<string, number>>();
  await Promise.all(months.map(async (m) => {
    const isPast = m.year < today.getFullYear() || (m.year === today.getFullYear() && m.month <= today.getMonth());
    periodMonthRates.set(m.key, isPast ? await getBestMonthRates(m.year, m.month) : rates);
  }));

  // Alias for expense bucketing below
  const expenseMonthRates = periodMonthRates;

  // Bucket expenses by dueOn (fallback: asanaCreatedAt, then createdAt for manual imports)
  for (const e of allExpenses) {
    const d = new Date((e.dueOn ?? e.asanaCreatedAt ?? e.createdAt) as Date);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    const expRates = expenseMonthRates.get(key) ?? rates;
    const usd = toUSD(e.amount!, e.currency, expRates);
    b.expenseUsd += usd;
    b.expenseCount++;
    if (e.completed) b.expensePaidUsd += usd; else b.expenseUnpaidUsd += usd;
    b.expenseItems.push({ id: e.id, name: e.name, amount: e.amount!, currency: e.currency, usdAmount: usd, expenseType: e.expenseType, personName: e.person?.name ?? null, isPaid: e.completed });
  }

  // Bucket VAT liabilities by dueDate month (unpaid periods only)
  for (const config of vatConfigs) {
    const periods = generateVatPeriods(config.startDate, config.frequencyMonths, config.anchorMonth, config.filingDeadlineDays, config.periodsAhead);
    for (const period of periods) {
      if (paidVatSet.has(`${config.id}|${Math.round(period.periodStart.getTime() / 86400000)}`)) continue;
      const key = `${period.dueDate.getFullYear()}-${String(period.dueDate.getMonth() + 1).padStart(2, "0")}`;
      const b = buckets.get(key);
      if (!b) continue;

      const periodInvoices = allInvoicesForVat.filter(inv => {
        const effectiveDate = inv.issueDate ?? inv.createdAt;
        const entityMatch = config.companyName
          ? inv.legalEntity?.name?.toLowerCase() === config.companyName.toLowerCase() &&
            inv.legalEntity?.country?.toLowerCase() === config.country.toLowerCase()
          : inv.currency === config.currency;
        return entityMatch &&
          effectiveDate != null &&
          new Date(effectiveDate) >= period.periodStart &&
          new Date(effectiveDate) <= period.periodEnd;
      });
      const vatNative = periodInvoices.reduce((s, i) => s + convertToNative(i.vatAmount ?? 0, i.currency ?? config.currency, config.currency, rates), 0);
      if (vatNative <= 0) continue;

      const usdAmount = toUSD(vatNative, config.currency, rates);
      b.vatUsd += usdAmount;
      b.vatCount++;
      b.vatItems.push({
        configId: config.id,
        country: config.country,
        currency: config.currency,
        amount: Math.round(vatNative * 100) / 100,
        usdAmount: Math.round(usdAmount),
        periodLabel: period.label,
      });
    }
  }

  // Bucket Tax liabilities by dueDate month (unpaid periods only)
  for (const config of taxConfigs) {
    const periods = generateTaxPeriods(config.startDate, config.frequencyMonths, config.anchorMonth, config.filingDeadlineDays, config.periodsAhead);

    // Most recent paid amount for this config — used as fallback estimate
    const lastPaidNative = allTaxPayments
      .filter(p => p.taxConfigId === config.id && p.paidAmount != null)
      .sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime())[0]?.paidAmount ?? null;

    for (const period of periods) {
      if (paidTaxSet.has(`${config.id}|${period.periodStart.getTime()}`)) continue;
      const key = `${period.dueDate.getFullYear()}-${String(period.dueDate.getMonth() + 1).padStart(2, "0")}`;
      const b = buckets.get(key);
      if (!b) continue;

      // Estimate from revenue in the period (use issueDate, fall back to expiryDate)
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
        // No revenue data — fall back to most recent paid amount as estimate
        taxNative = lastPaidNative;
      } else {
        // No estimate possible — still show period in detail card
        taxNative = 0;
      }

      const usdAmount = taxNative > 0 ? toUSD(taxNative, config.currency, rates) : 0;
      if (usdAmount > 0) b.taxUsd += usdAmount;
      b.taxCount++;
      b.taxItems.push({
        configId: config.id,
        country: config.country,
        taxType: config.taxType,
        currency: config.currency,
        amount: Math.round(taxNative * 100) / 100,
        usdAmount: Math.round(usdAmount),
        periodLabel: period.label,
        isEstimate: periodRevenue <= 0 || !config.revenueBase,
      });
    }
  }

  // Bucket capital injections by month so the projected balance includes them
  for (const ci of capitalInjections) {
    const d = new Date(ci.date);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    b.capitalUsd += toUSD(ci.amount, ci.currency, rates);
  }

  // Populate paid payroll and lease into buckets so bars show historical actuals
  for (const e of paidPayrollEntries) {
    if (!e.payrollRun.year || !e.payrollRun.month) continue;
    const key = `${e.payrollRun.year}-${String(e.payrollRun.month).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    b.paidPayrollUsd += toUSD(e.salary, e.currency, rates);
  }
  for (const s of paidSchedulesInPeriod) {
    const d = new Date(s.dueDate);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    b.paidLeaseUsd += toUSD(s.amount, s.currency, rates);
  }

  const periodKey    = rangeStart.getFullYear() * 12 + rangeStart.getMonth() + 1;
  const periodEndKey = rangeEnd.getFullYear() * 12 + rangeEnd.getMonth() + 1;

  // Per-month paid expenses — used to correct the running balance for past months
  const monthPaidExpenses = new Map<string, number>();
  for (const e of paidPayrollEntries) {
    if (!e.payrollRun.year || !e.payrollRun.month) continue;
    const ym = e.payrollRun.year * 12 + e.payrollRun.month;
    if (ym < periodKey || ym > periodEndKey) continue;
    const key = `${e.payrollRun.year}-${String(e.payrollRun.month).padStart(2, "0")}`;
    monthPaidExpenses.set(key, (monthPaidExpenses.get(key) ?? 0) + toUSD(e.salary, e.currency, rates));
  }
  for (const s of paidSchedulesInPeriod) {
    const d = new Date(s.dueDate);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthPaidExpenses.set(key, (monthPaidExpenses.get(key) ?? 0) + toUSD(s.amount, s.currency, rates));
  }

  // Bucket paid tax payments by paidAt date so they show as historical actuals
  for (const tp of allTaxPayments) {
    if (!tp.paidAt || tp.paidAmount == null || tp.paidAmount <= 0) continue;
    const d = new Date(tp.paidAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    const config = taxConfigs.find(c => c.id === tp.taxConfigId);
    if (!config) continue;
    const usdAmount = toUSD(tp.paidAmount, config.currency, rates);
    b.taxPaidUsd += usdAmount;
    const periodYear = tp.periodStart.getFullYear();
    const periodLabel = config.frequencyMonths === 12 ? `FY ${periodYear}` : tp.periodStart.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    b.paidTaxItems.push({
      configId: config.id,
      country: config.country,
      taxType: config.taxType,
      currency: config.currency,
      amount: Math.round(tp.paidAmount * 100) / 100,
      usdAmount: Math.round(usdAmount),
      periodLabel,
      isEstimate: false,
    });
  }

  // Add paid VAT payments to paidExpenses (for running balance correction) and to bucket for table display
  for (const vp of dedupedVatPayments) {
    if (!vp.paidAt || vp.paidAmount == null) continue;
    const d = new Date(vp.paidAt);
    const ym = d.getFullYear() * 12 + d.getMonth() + 1;
    if (ym < periodKey || ym > periodEndKey) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const usd = toUSD(vp.paidAmount, vp.vatConfig.currency, rates);
    monthPaidExpenses.set(key, (monthPaidExpenses.get(key) ?? 0) + usd);
    const b = buckets.get(key);
    if (b) {
      b.vatPaidUsd += usd;
      b.paidVatItems.push({
        country:     vp.vatConfig.country,
        currency:    vp.vatConfig.currency,
        amount:      vp.paidAmount,
        periodLabel: `paid ${new Date(vp.paidAt!).toISOString().slice(0, 10)}`,
      });
    }
  }

  // Add paid tax payments to paidExpenses (for running balance correction)
  for (const tp of allTaxPayments) {
    if (!tp.paidAt || tp.paidAmount == null || tp.paidAmount <= 0) continue;
    const d = new Date(tp.paidAt);
    const ym = d.getFullYear() * 12 + d.getMonth() + 1;
    if (ym < periodKey || ym > periodEndKey) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const config = taxConfigs.find(c => c.id === tp.taxConfigId);
    if (!config) continue;
    monthPaidExpenses.set(key, (monthPaidExpenses.get(key) ?? 0) + toUSD(tp.paidAmount, config.currency, rates));
  }

  const monthBars: MonthBar[] = Array.from(buckets.values()).map(b => {
    const payroll = Math.round(b.payrollUsd);
    const lease   = Math.round(b.leaseUsd);
    const expense = Math.round(b.expenseUsd);
    const vat     = Math.round(b.vatUsd);
    const paidVat = Math.round(b.vatPaidUsd);
    const tax     = Math.round(b.taxUsd);
    const paidTax = Math.round(b.taxPaidUsd);
    return {
    key: b.key, label: b.label,
    payroll,
    lease,
    expense,
    expensePaid:   Math.round(b.expensePaidUsd),
    expenseUnpaid: Math.round(b.expenseUnpaidUsd),
    vat,
    paidVat,
    tax,
    paidTax,
    total: payroll + lease + expense + vat + tax,
    paidPayroll: Math.round(b.paidPayrollUsd),
    paidLease:   Math.round(b.paidLeaseUsd),
    capitalUsd:  Math.round(b.capitalUsd),
    payrollCount: b.payrollCount,
    leaseCount:   b.leaseCount,
    expenseCount: b.expenseCount,
    vatCount:     b.vatCount,
    taxCount:     b.taxCount,
    payrollItems: b.payrollItems,
    leaseItems:   b.leaseItems,
    expenseItems: b.expenseItems,
    vatItems:     b.vatItems,
    paidVatItems: b.paidVatItems,
    taxItems:     b.taxItems,
    paidTaxItems: b.paidTaxItems,
    receivable:         Math.round(b.collectedUsd + b.pendingUsd),
    collected:          Math.round(b.collectedUsd),
    pending:            Math.round(b.pendingUsd),
    receivableCount:    b.receivableCount,
    receivableInvoices: b.receivableInvoices,
    paidExpenses: Math.round(monthPaidExpenses.get(b.key) ?? 0),
    };
  });

  // Carry-over: amounts from prior periods still outstanding
  // Vendor contract schedules without a linked invoice = receivable (client owes the company)
  // Vendor contract schedules with a linked invoice = already captured via overdueInvoices
  // Lease contract schedules = payable (company owes the landlord)
  const overdueLeasePayable = overdueSchedules.filter(s => s.document.docType === "lease_contract");

  // Exclude vendor schedules that are already represented by an invoice in overdueInvoices.
  // Match on amount + currency + first party so two different clients with the same amount
  // are never conflated.
  const invoicedKeys = new Set(
    overdueInvoices.map(inv => {
      const parties: string[] = inv.parties ? JSON.parse(inv.parties) : [];
      const party = parties.find((p: string) => p.trim())?.toLowerCase().trim() ?? "";
      return `${inv.amount ?? 0}|${inv.currency ?? "USD"}|${party}`;
    })
  );
  const overdueVendorReceivable = overdueSchedules.filter(s => {
    if (s.document.docType !== "client_contract" || s.invoiceId) return false;
    const parties: string[] = s.document.parties ? JSON.parse(s.document.parties) : [];
    const party = parties.find((p: string) => p.trim())?.toLowerCase().trim() ?? "";
    return !invoicedKeys.has(`${s.amount}|${s.currency}|${party}`);
  });

  const carryVendorReceivableUsd = overdueVendorReceivable.reduce((s, sc) => s + toUSD(sc.amount, sc.currency, rates), 0);
  const carryReceivableUsd = overdueInvoices.reduce((s, inv) => s + toUSD(inv.amount ?? 0, inv.currency ?? "USD", rates), 0) + carryVendorReceivableUsd;
  const carryPayableScheduleUsd = overdueLeasePayable.reduce((s, sc) => s + toUSD(sc.amount, sc.currency, rates), 0);
  const carryPayablePayrollUsd  = payrollEntries
    .filter(e => {
      if (!e.payrollRun.year || !e.payrollRun.month) return false;
      return e.payrollRun.year * 12 + e.payrollRun.month < periodKey;
    })
    .reduce((s, e) => s + toUSD(e.salary, e.currency, rates), 0);

  // Overdue unpaid VAT periods (dueDate before the view range)
  const overdueVatPayables: { label: string; amount: number; currency: string }[] = [];
  for (const config of vatConfigs) {
    const periods = generateVatPeriods(config.startDate, config.frequencyMonths, config.anchorMonth, config.filingDeadlineDays, config.periodsAhead);
    for (const period of periods) {
      if (period.dueDate >= rangeStart) continue;
      if (paidVatSet.has(`${config.id}|${Math.round(period.periodStart.getTime() / 86400000)}`)) continue;
      const periodInvoices = allInvoicesForVat.filter(inv => {
        const effectiveDate = inv.issueDate ?? inv.createdAt;
        const entityMatch = config.companyName
          ? inv.legalEntity?.name?.toLowerCase() === config.companyName.toLowerCase() &&
            inv.legalEntity?.country?.toLowerCase() === config.country.toLowerCase()
          : inv.currency === config.currency;
        return entityMatch &&
          effectiveDate != null &&
          new Date(effectiveDate) >= period.periodStart &&
          new Date(effectiveDate) <= period.periodEnd;
      });
      const vatNative = periodInvoices.reduce((s, i) =>
        s + convertToNative(i.vatAmount ?? 0, i.currency ?? config.currency, config.currency, rates), 0);
      if (vatNative <= 0) continue;
      overdueVatPayables.push({ label: `${config.country} VAT · ${period.label}`, amount: Math.round(vatNative * 100) / 100, currency: config.currency });
    }
  }
  const carryVatPayableUsd = overdueVatPayables.reduce((s, v) => s + toUSD(v.amount, v.currency, rates), 0);

  // Overdue unpaid Tax periods (dueDate before the view range)
  const overdueTaxPayables: { label: string; amount: number; currency: string }[] = [];
  for (const config of taxConfigs) {
    const periods = generateTaxPeriods(config.startDate, config.frequencyMonths, config.anchorMonth, config.filingDeadlineDays, config.periodsAhead);
    const lastPaidNative = allTaxPayments
      .filter(p => p.taxConfigId === config.id && p.paidAmount != null)
      .sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime())[0]?.paidAmount ?? null;
    for (const period of periods) {
      if (period.dueDate >= rangeStart) continue;
      if (paidTaxSet.has(`${config.id}|${period.periodStart.getTime()}`)) continue;
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
      let taxNative = 0;
      if (periodRevenue > 0) {
        const base = config.thresholdActive && config.profitThreshold
          ? Math.max(0, periodRevenue - config.profitThreshold)
          : periodRevenue;
        taxNative = Math.round(base * config.rate * 100) / 100;
      } else if (lastPaidNative != null) {
        taxNative = lastPaidNative;
      }
      if (taxNative <= 0) continue;
      overdueTaxPayables.push({ label: `${config.country} ${config.taxType} tax · ${period.label}`, amount: taxNative, currency: config.currency });
    }
  }
  const carryTaxPayableUsd = overdueTaxPayables.reduce((s, v) => s + toUSD(v.amount, v.currency, rates), 0);

  // Carry-over: unpaid manual/imported expenses from before the period start
  const carryManualExpenses = allExpenses.filter(e => {
    if (e.completed || e.amount == null) return false;
    const d = new Date((e.dueOn ?? e.asanaCreatedAt ?? e.createdAt) as Date);
    if (isNaN(d.getTime())) return false;
    return d.getFullYear() * 12 + d.getMonth() + 1 < periodKey;
  });
  const carryManualExpensesUsd = carryManualExpenses.reduce((s: number, e) => s + toUSD(e.amount!, e.currency, rates), 0);

  const carryPayableUsd  = Math.round(carryPayableScheduleUsd + carryPayablePayrollUsd + carryVatPayableUsd + carryTaxPayableUsd + carryManualExpensesUsd);
  const carryReceivable  = Math.round(carryReceivableUsd);
  const carryNet         = carryReceivable - carryPayableUsd;
  const hasCarryOver     = carryReceivable > 0 || carryPayableUsd > 0;

  // Item lists for the carry-over banner breakdown
  function scheduleLabel(s: { description: string | null; document: { parties: string | null; filename: string } }): string {
    const parties: string[] = s.document.parties ? JSON.parse(s.document.parties) : [];
    return s.description || parties.find((p: string) => p.trim()) || s.document.filename;
  }

  const carryReceivableItems: { id: string; label: string; amount: number; currency: string }[] = [
    ...overdueInvoices.map(inv => {
      const parties: string[] = inv.parties ? JSON.parse(inv.parties) : [];
      const vendor = parties.find((p: string) => p.trim()) ?? "";
      const label  = inv.referenceNumber
        ? (vendor ? `#${inv.referenceNumber} · ${vendor}` : `#${inv.referenceNumber}`)
        : (vendor || "Invoice");
      return { id: inv.id, label, amount: inv.amount ?? 0, currency: inv.currency ?? "USD" };
    }),
    // Vendor contract payments not yet invoiced — receivable from client
    ...overdueVendorReceivable.map(s => ({
      id: s.document.id,
      label: scheduleLabel(s),
      amount: s.amount,
      currency: s.currency,
    })),
  ];

  // Group overdue payroll entries by employee — multiple unpaid months → one row with summed amount
  const payrollCarryMap = new Map<string, { id: string; amount: number; currency: string; months: number }>();
  for (const e of payrollEntries) {
    if (!e.payrollRun.year || !e.payrollRun.month) continue;
    if (e.payrollRun.year * 12 + e.payrollRun.month >= periodKey) continue;
    const existing = payrollCarryMap.get(e.employeeName);
    if (existing) {
      existing.amount += e.salary;
      existing.months++;
    } else {
      payrollCarryMap.set(e.employeeName, { id: e.id, amount: e.salary, currency: e.currency, months: 1 });
    }
  }

  const carryPayableItems: { id: string; documentId: string | null; label: string; amount: number; currency: string }[] = [
    // Lease contracts — company owes the landlord
    ...overdueLeasePayable.map(s => ({
      id: s.id, documentId: s.document.id, label: scheduleLabel(s), amount: s.amount, currency: s.currency,
    })),
    // Payroll — grouped by employee; amount is the total across all overdue months
    ...Array.from(payrollCarryMap.entries()).map(([name, v]) => ({
      id: v.id,
      documentId: null as string | null,
      label: v.months > 1 ? `${name} (${v.months} months)` : name,
      amount: v.amount,
      currency: v.currency,
    })),
    // Overdue VAT liabilities
    ...overdueVatPayables.map((v, i) => ({
      id: `vat-overdue-${i}`,
      documentId: null as string | null,
      label: v.label,
      amount: v.amount,
      currency: v.currency,
    })),
    // Overdue Tax liabilities
    ...overdueTaxPayables.map((v, i) => ({
      id: `tax-overdue-${i}`,
      documentId: null as string | null,
      label: v.label,
      amount: v.amount,
      currency: v.currency,
    })),
    // Prior-period unpaid company expenses (manual imports, Asana claims before the period start)
    ...carryManualExpenses.map(e => ({
      id: e.id,
      documentId: null as string | null,
      label: e.name,
      amount: e.amount!,
      currency: e.currency,
    })),
  ];

  // ── Cash position (wallet) ───────────────────────────────────────────────
  // Income  = paid invoices (grouped by issueDate — the period an invoice belongs to)
  // Expenses = paid payroll (by run year/month) + paid lease schedules (by dueDate)
  const walletMap = new Map<number, { income: number; expenses: number }>();
  let openingBalance = 0;
  const todayYM = today.getFullYear() * 12 + today.getMonth() + 1;

  for (const inv of paidInvoices) {
    if (!inv.expiryDate) continue;
    const d = new Date(inv.expiryDate as Date);
    if (isNaN(d.getTime())) continue;
    const year = d.getFullYear();
    const ym   = year * 12 + d.getMonth() + 1;
    const usd  = toUSD(inv.amount ?? 0, inv.currency ?? "USD", rates);
    const e = walletMap.get(year) ?? { income: 0, expenses: 0 };
    e.income += usd;
    walletMap.set(year, e);
    if (ym < periodKey) openingBalance += usd;
  }
  for (const e of paidPayrollEntries) {
    if (!e.payrollRun.year || !e.payrollRun.month) continue;
    const year = e.payrollRun.year;
    const ym   = year * 12 + e.payrollRun.month;
    const usd  = toUSD(e.salary, e.currency, rates);
    const we = walletMap.get(year) ?? { income: 0, expenses: 0 };
    we.expenses += usd;
    walletMap.set(year, we);
    if (ym < periodKey) openingBalance -= usd;
  }
  for (const s of paidLeaseSchedules) {
    const d = new Date(s.dueDate);
    if (isNaN(d.getTime())) continue;
    const year = d.getFullYear();
    const ym   = year * 12 + d.getMonth() + 1;
    const usd  = toUSD(s.amount, s.currency, rates);
    const we = walletMap.get(year) ?? { income: 0, expenses: 0 };
    we.expenses += usd;
    walletMap.set(year, we);
    if (ym < periodKey) openingBalance -= usd;
  }
  for (const e of allExpenses) {
    if (!e.completed || e.amount == null) continue;
    const d = new Date((e.dueOn ?? e.asanaCreatedAt ?? e.createdAt) as Date);
    if (isNaN(d.getTime())) continue;
    const year = d.getFullYear();
    const ym   = year * 12 + d.getMonth() + 1;
    const usd  = toUSD(e.amount, e.currency, rates);
    const we = walletMap.get(year) ?? { income: 0, expenses: 0 };
    we.expenses += usd;
    walletMap.set(year, we);
    if (ym < periodKey) openingBalance -= usd;
    // NOTE: paid general expenses are NOT added to monthPaidExpenses — they're already
    // fully in b.expenseUsd (which counts all expenses, paid or not). Adding them here
    // would double-count them in the CommitmentChart `expenses = m.total + m.paidExpenses` formula.
  }
  // Paid VAT payments contribute to the cash position
  for (const vp of dedupedVatPayments) {
    if (!vp.paidAt || vp.paidAmount == null) continue;
    const d = new Date(vp.paidAt);
    if (isNaN(d.getTime())) continue;
    const year = d.getFullYear();
    const ym   = year * 12 + d.getMonth() + 1;
    const usd  = toUSD(vp.paidAmount, vp.vatConfig.currency, rates);
    const we   = walletMap.get(year) ?? { income: 0, expenses: 0 };
    we.expenses += usd;
    walletMap.set(year, we);
    if (ym < periodKey) openingBalance -= usd;
  }

  // Paid tax payments contribute to the cash position
  for (const tp of allTaxPayments) {
    if (!tp.paidAt || tp.paidAmount == null || tp.paidAmount <= 0) continue;
    const d = new Date(tp.paidAt);
    if (isNaN(d.getTime())) continue;
    const year = d.getFullYear();
    const ym   = year * 12 + d.getMonth() + 1;
    const config = taxConfigs.find(c => c.id === tp.taxConfigId);
    if (!config) continue;
    const usd = toUSD(tp.paidAmount, config.currency, rates);
    const we  = walletMap.get(year) ?? { income: 0, expenses: 0 };
    we.expenses += usd;
    walletMap.set(year, we);
    if (ym < periodKey) openingBalance -= usd;
  }

  // Capital injections: tracked separately from invoice income so the two can be displayed distinctly
  const capitalByYear = new Map<number, number>();
  for (const ci of capitalInjections) {
    const d   = new Date(ci.date);
    if (isNaN(d.getTime())) continue;
    const year = d.getFullYear();
    const ym   = year * 12 + d.getMonth() + 1;
    const usd  = toUSD(ci.amount, ci.currency, rates);
    capitalByYear.set(year, (capitalByYear.get(year) ?? 0) + usd);
    if (ym < periodKey) openingBalance += usd;
  }

  openingBalance = Math.round(openingBalance);

  // Projected opening balance: paid items (openingBalance) + unpaid carry-overs.
  // Ensures the projected balance carries forward correctly across period boundaries
  // (e.g. FY 2026 → FY 2027: Jan 2027 starts from Dec 2026's projected end balance).
  const projectedOpeningBalance = Math.round(
    openingBalance
    + carryReceivableUsd       // unpaid receivables before period
    - carryPayablePayrollUsd   // unpaid payroll before period
    - carryPayableScheduleUsd  // unpaid leases before period
    - carryManualExpensesUsd   // unpaid expenses before period
    - carryVatPayableUsd       // unpaid VAT before period
    - carryTaxPayableUsd       // unpaid tax before period
  );

  const allWalletYears = new Set([...walletMap.keys(), ...capitalByYear.keys()]);
  const walletYears = Array.from(allWalletYears)
    .sort((a, b) => a - b)
    .map(year => {
      const v   = walletMap.get(year) ?? { income: 0, expenses: 0 };
      const cap = capitalByYear.get(year) ?? 0;
      return {
        year,
        income:   Math.round(v.income),
        capital:  Math.round(cap),
        expenses: Math.round(v.expenses),
        net:      Math.round(v.income + cap - v.expenses),
      };
    });

  const currentCashNet = walletYears.reduce((s, y) => s + y.net, 0);

  // All-time collected (invoices only) and capital, for the Balance card
  const totalCollectedAllTimeUsd  = walletYears.reduce((s, y) => s + y.income, 0);
  const totalCapitalAllTimeUsd    = walletYears.reduce((s, y) => s + y.capital, 0);
  const totalPaidExpensesAllTimeUsd = walletYears.reduce((s, y) => s + y.expenses, 0);
  const currentBalanceUsd = Math.round(currentCashNet);

  // KPIs
  const totalUsd           = monthBars.reduce((s, m) => s + m.total, 0);
  const totalCollectedUsd  = monthBars.reduce((s, m) => s + m.collected, 0);
  const totalPendingUsd    = monthBars.reduce((s, m) => s + m.pending, 0);
  const totalReceivableUsd = totalCollectedUsd + totalPendingUsd;
  const netUsd             = totalReceivableUsd - totalUsd;
  const unlinkedCount      = paymentSchedules.filter(s => !s.invoiceId && s.document.docType === "client_contract").length;

  // Net (actual): collected invoices − paid expenses, both within the period
  const paidPayrollInPeriodUsd = paidPayrollEntries
    .filter(e => {
      if (!e.payrollRun.year || !e.payrollRun.month) return false;
      const ym = e.payrollRun.year * 12 + e.payrollRun.month;
      return ym >= periodKey && ym <= periodEndKey;
    })
    .reduce((sum, e) => sum + toUSD(e.salary, e.currency, rates), 0);
  const paidSchedulesInPeriodUsd = paidSchedulesInPeriod.reduce(
    (sum, s) => sum + toUSD(s.amount, s.currency, rates), 0
  );
  const paidAsanaExpensesInPeriodUsd = allExpenses
    .filter(e => {
      if (!e.completed || e.amount == null) return false;
      const d = new Date((e.dueOn ?? e.asanaCreatedAt ?? e.createdAt) as Date);
      if (isNaN(d.getTime())) return false;
      const ym = d.getFullYear() * 12 + d.getMonth() + 1;
      return ym >= periodKey && ym <= periodEndKey;
    })
    .reduce((sum, e) => sum + toUSD(e.amount!, e.currency, rates), 0);
  const paidVatInPeriodUsd = dedupedVatPayments
    .filter(vp => {
      if (!vp.paidAt || vp.paidAmount == null) return false;
      const d = new Date(vp.paidAt);
      const ym = d.getFullYear() * 12 + d.getMonth() + 1;
      return ym >= periodKey && ym <= periodEndKey;
    })
    .reduce((sum, vp) => sum + toUSD(vp.paidAmount!, vp.vatConfig.currency, rates), 0);
  const paidTaxInPeriodUsd = allTaxPayments
    .filter(tp => {
      if (!tp.paidAt || tp.paidAmount == null || tp.paidAmount <= 0) return false;
      const d = new Date(tp.paidAt);
      const ym = d.getFullYear() * 12 + d.getMonth() + 1;
      return ym >= periodKey && ym <= periodEndKey;
    })
    .reduce((sum, tp) => {
      const config = taxConfigs.find(c => c.id === tp.taxConfigId);
      return sum + (config ? toUSD(tp.paidAmount!, config.currency, rates) : 0);
    }, 0);
  const paidExpensesUsd = Math.round(paidPayrollInPeriodUsd + paidSchedulesInPeriodUsd + paidAsanaExpensesInPeriodUsd + paidVatInPeriodUsd + paidTaxInPeriodUsd);
  const netActualUsd    = Math.round(totalCollectedUsd - paidExpensesUsd);

  // FX notes — rates for all non-USD currencies actually used in the period data
  const fxCurrencies = new Set<string>();
  for (const e of payrollEntries)    fxCurrencies.add(e.currency);
  for (const s of paymentSchedules) fxCurrencies.add(s.currency);
  for (const inv of invoices)        if (inv.currency) fxCurrencies.add(inv.currency);
  for (const e of allExpenses)       fxCurrencies.add(e.currency);
  fxCurrencies.delete("USD");

  function buildNotes(r: Record<string, number>): string[] {
    return Array.from(fxCurrencies)
      .map(c => { const v = r[c]; return v ? `1 USD = ${v.toFixed(2)} ${c}` : null; })
      .filter((n): n is string => n !== null);
  }

  // Default label (no bar selected) — live rate, clearly marked
  const fxNotes = buildNotes(rates).map(n => `Live · ${n}`);

  // Per-month labels use the same rate as calculations (periodMonthRates)
  const monthFxNotes: Record<string, string[]> = {};
  months.forEach(m => { monthFxNotes[m.key] = buildNotes(periodMonthRates.get(m.key) ?? rates); });

  // Currency mix (by native amount, not USD)
  const currMap = new Map<string, number>();
  for (const e of payrollEntries) {
    if (!e.payrollRun.year || !e.payrollRun.month) continue;
    const key = `${e.payrollRun.year}-${String(e.payrollRun.month).padStart(2, "0")}`;
    if (buckets.has(key)) currMap.set(e.currency, (currMap.get(e.currency) ?? 0) + e.salary);
  }
  for (const s of paymentSchedules) {
    currMap.set(s.currency, (currMap.get(s.currency) ?? 0) + s.amount);
  }
  const totalNative = Array.from(currMap.values()).reduce((s, v) => s + v, 0);
  const topCurrencies = Array.from(currMap.entries())
    .map(([c, v]) => ({ currency: c, pct: totalNative ? Math.round(v / totalNative * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);

  // Table totals (payroll/lease include paid amounts so historical months show actuals)
  const totalPayroll    = monthBars.reduce((s, m) => s + m.payroll + m.paidPayroll, 0);
  const totalLease      = monthBars.reduce((s, m) => s + m.lease   + m.paidLease,   0);
  const totalExpense    = monthBars.reduce((s, m) => s + m.expense,    0);
  const totalVat        = monthBars.reduce((s, m) => s + m.vat + m.paidVat, 0);
  const totalTax        = monthBars.reduce((s, m) => s + m.tax + m.paidTax, 0);
  const totalReceivable = monthBars.reduce((s, m) => s + m.receivable, 0);
  const totalCapitalUsd = monthBars.reduce((s, m) => s + m.capitalUsd, 0);
  const totalDisplayUsd = totalPayroll + totalLease + totalExpense + totalVat + totalTax;
  const netDisplayUsd   = totalReceivable + totalCapitalUsd - totalDisplayUsd;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Finances" }]} />

        <main className="px-4 sm:px-8 py-4 sm:py-6 w-full max-w-7xl space-y-6">

          {/* Page heading + period selector */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Financial commitments</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                Expenses vs. receivables · {periodLabel}
              </p>
            </div>
            <Suspense fallback={null}>
              <PeriodSelector current={period} />
            </Suspense>
          </div>

          {/* Carry-over banner */}
          {hasCarryOver && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
              <div className="flex items-start gap-3 mb-3">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0">
                  <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="#d97706" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
                  <path d="M8 6v3.5M8 11.5v.5" stroke="#d97706" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <div>
                  <p className="text-xs font-bold text-amber-800">Prior period carry-over</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    Outstanding items from before {rangeStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })} — not included in the period view above.
                  </p>
                </div>
                <div className={`ml-auto shrink-0 text-right`}>
                  <p className="text-[10px] text-amber-600 font-medium uppercase tracking-wide">Net carry-over</p>
                  <p className={`text-xl font-bold tabular-nums ${carryNet >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {carryNet >= 0 ? "+" : ""}{fmtUsd(Math.abs(carryNet))}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white border border-amber-100 rounded-lg px-4 py-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Overdue receivables</p>
                  <p className="text-lg font-bold text-emerald-600 tabular-nums mb-2">{fmtUsd(carryReceivable)}</p>
                  {carryReceivableItems.length > 0 ? (
                    <div className="space-y-0.5 max-h-36 overflow-y-auto">
                      {carryReceivableItems.map(item => (
                        <Link
                          key={item.id}
                          href={`/records/${item.id}`}
                          className="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-amber-50 transition-colors group"
                        >
                          <span className="text-[10px] text-gray-600 truncate group-hover:text-amber-700">{item.label}</span>
                          <span className="text-[10px] text-gray-500 tabular-nums shrink-0 font-medium">{fmtNative(item.amount, item.currency)}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-400">unpaid invoices past due date</p>
                  )}
                </div>
                <div className="bg-white border border-amber-100 rounded-lg px-4 py-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Overdue payables</p>
                  <p className="text-lg font-bold text-red-500 tabular-nums mb-2">{fmtUsd(carryPayableUsd)}</p>
                  {carryPayableItems.length > 0 ? (
                    <div className="space-y-0.5 max-h-36 overflow-y-auto">
                      {carryPayableItems.map(item =>
                        item.documentId ? (
                          <Link
                            key={item.id}
                            href={`/records/${item.documentId}`}
                            className="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-amber-50 transition-colors group"
                          >
                            <span className="text-[10px] text-gray-600 truncate group-hover:text-amber-700">{item.label}</span>
                            <span className="text-[10px] text-gray-500 tabular-nums shrink-0 font-medium">{fmtNative(item.amount, item.currency)}</span>
                          </Link>
                        ) : (
                          <div key={item.id} className="flex items-center justify-between gap-2 px-1.5 py-1">
                            <span className="text-[10px] text-gray-600 truncate">{item.label}</span>
                            <span className="text-[10px] text-gray-500 tabular-nums shrink-0 font-medium">{fmtNative(item.amount, item.currency)}</span>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-400">vendor, lease & payroll past due</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Cash balance card */}
          <div className="bg-white border border-surface-border rounded-xl px-5 py-4">
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Cash balance</p>
                <p className={`text-2xl font-bold tabular-nums ${currentCashNet >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {currentCashNet >= 0 ? "+" : ""}{fmtUsd(Math.abs(currentCashNet))}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  <span className="text-emerald-600 font-medium">{fmtUsd(Math.round(totalCollectedAllTimeUsd))}</span>
                  <span className="mx-1 text-gray-300">collected</span>
                  {totalCapitalAllTimeUsd > 0 && (
                    <>
                      <span className="text-gray-300">+</span>
                      <span className="text-blue-500 font-medium mx-1">{fmtUsd(Math.round(totalCapitalAllTimeUsd))}</span>
                      <span className="text-gray-300">capital</span>
                    </>
                  )}
                  <span className="mx-1 text-gray-300">−</span>
                  <span className="text-red-400 font-medium ml-1">{fmtUsd(Math.round(totalPaidExpensesAllTimeUsd))}</span>
                  <span className="mx-1 text-gray-300">paid expenses</span>
                </p>
              </div>
              {walletYears.length > 0 && (
                <div className="flex gap-6 flex-wrap">
                  {walletYears.slice(-4).map(wy => (
                    <div key={wy.year} className="text-right">
                      <div className="flex items-center gap-1.5 justify-end mb-0.5">
                        <span className="text-[10px] font-bold text-gray-500">{wy.year}</span>
                        {wy.year === today.getFullYear() && (
                          <span className="text-[9px] font-medium text-gray-500 bg-gray-100 px-1 py-0.5 rounded">YTD</span>
                        )}
                      </div>
                      <p className={`text-sm font-bold tabular-nums ${wy.net >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {wy.net >= 0 ? "+" : ""}{fmtUsd(Math.abs(wy.net))}
                      </p>
                      <p className="text-[9px] text-gray-400 tabular-nums mt-0.5">
                        {fmtUsd(wy.income)}{wy.capital > 0 ? ` + ${fmtUsd(wy.capital)}` : ""} in · {fmtUsd(wy.expenses)} out
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Capital injections card */}
          <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
            <CapitalManager entries={capitalInjections.map(ci => ({ ...ci, date: ci.date.toISOString() }))} />
          </div>

          <FinanceKPIs
            monthBars={monthBars}
            totalCollectedUsd={totalCollectedUsd}
            totalPendingUsd={totalPendingUsd}
            totalUsd={totalUsd}
            paidExpensesUsd={paidExpensesUsd}
            netActualUsd={netActualUsd}
            unlinkedCount={unlinkedCount}
            periodLabel={periodLabel}
            projectedOpeningBalance={projectedOpeningBalance}
            fxNotes={fxNotes}
            monthFxNotes={monthFxNotes}
          />

          {/* Monthly table */}
          <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-gray-900">Month-by-month detail</h2>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-surface-border bg-surface-inset">
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Month</th>
                  <th className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#6366f1" }}>Payroll</th>
                  <th className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#f97316" }}>Lease</th>
                  <th className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#14b8a6" }}>Claims</th>
                  <th className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#f43f5e" }}>VAT</th>
                  <th className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#7c3aed" }}>Tax</th>
                  <th className="text-right px-5 py-3 leading-tight">
                    <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Total out</p>
                    <p className="text-[9px] text-gray-300 normal-case font-normal tracking-normal">payroll + lease + claims + VAT + tax</p>
                  </th>
                  <th className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#10b981" }}>Receivables</th>
                  <th className="text-right px-5 py-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: "#3b82f6" }}>Capital</th>
                  <th className="text-right px-5 py-3 leading-tight">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Net</p>
                    <p className="text-[9px] text-gray-300 normal-case font-normal tracking-normal">receivables + capital − expenses</p>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {monthBars.map(m => {
                  const fullPayroll = m.payroll + m.paidPayroll;
                  const fullLease   = m.lease   + m.paidLease;
                  const fullVat     = m.vat + m.paidVat;
                  const fullTax     = m.tax + m.paidTax;
                  const fullTotal   = fullPayroll + fullLease + m.expense + fullVat + fullTax;
                  const net         = m.receivable + m.capitalUsd - fullTotal;
                  return (
                    <tr key={m.key} className={`transition-colors hover:bg-surface-hover ${fullTotal === 0 && m.receivable === 0 && m.capitalUsd === 0 && m.paidVat === 0 ? "opacity-35" : ""}`}>
                      <td className="px-5 py-3 text-sm font-medium text-gray-800">{m.label}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fullPayroll > 0
                          ? <span className="text-sm text-gray-700">{fmtUsd(fullPayroll)}</span>
                          : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fullLease > 0
                          ? <span className="text-sm text-gray-700">{fmtUsd(fullLease)}</span>
                          : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {m.expense > 0
                          ? <span className="text-sm text-gray-700">{fmtUsd(m.expense)}</span>
                          : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fullVat > 0
                          ? <span
                              className="text-sm font-medium cursor-help"
                              style={{ color: "#f43f5e" }}
                              title={[
                                ...m.vatItems.map(v => `[liability] ${v.country} ${v.periodLabel}: ${v.currency} ${v.amount.toLocaleString()}`),
                                ...m.paidVatItems.map(v => `[paid] ${v.country} period ${v.periodLabel}: ${v.currency} ${v.amount.toLocaleString()}`),
                              ].join("\n") || "(no breakdown)"}
                            >{fmtUsd(fullVat)}</span>
                          : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fullTax > 0
                          ? <span className="text-sm font-medium" style={{ color: "#7c3aed" }}>{fmtUsd(fullTax)}</span>
                          : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={`text-sm font-semibold ${fullTotal > 0 ? "text-gray-900" : "text-gray-300"}`}>
                          {fullTotal > 0 ? fmtUsd(fullTotal) : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {m.receivable > 0 ? (
                          <div>
                            <span className="text-sm font-semibold text-emerald-600">{fmtUsd(m.receivable)}</span>
                            {m.collected > 0 && (
                              <p className="text-[10px] text-emerald-500 mt-0.5">{fmtUsd(m.collected)} in</p>
                            )}
                          </div>
                        ) : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {m.capitalUsd > 0
                          ? <span className="text-sm font-semibold text-blue-600">{fmtUsd(m.capitalUsd)}</span>
                          : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {(fullTotal > 0 || m.receivable > 0 || m.capitalUsd > 0) ? (
                          <span className={`text-sm font-semibold ${net >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {net >= 0 ? "+" : "−"}{fmtUsd(Math.abs(net))}
                          </span>
                        ) : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-surface-inset">
                  <td className="px-5 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm font-bold" style={{ color: "#6366f1" }}>
                    {fmtUsd(totalPayroll)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm font-bold" style={{ color: "#f97316" }}>
                    {fmtUsd(totalLease)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm font-bold" style={{ color: "#14b8a6" }}>
                    {fmtUsd(totalExpense)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm font-bold" style={{ color: "#f43f5e" }}>
                    {totalVat > 0 ? fmtUsd(totalVat) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm font-bold" style={{ color: "#7c3aed" }}>
                    {totalTax > 0 ? fmtUsd(totalTax) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm font-bold text-gray-900">
                    {fmtUsd(totalDisplayUsd)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm font-bold" style={{ color: "#10b981" }}>
                    {fmtUsd(totalReceivable)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm font-bold" style={{ color: "#3b82f6" }}>
                    {totalCapitalUsd > 0 ? fmtUsd(totalCapitalUsd) : "—"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-sm font-bold">
                    <span className={netDisplayUsd >= 0 ? "text-emerald-600" : "text-red-500"}>
                      {netDisplayUsd >= 0 ? "+" : "−"}{fmtUsd(Math.abs(netDisplayUsd))}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
