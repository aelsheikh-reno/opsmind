import { prisma } from "@/lib/prisma";
import { DOC_TYPE_LABELS, DOC_TYPE_COLORS } from "@/lib/doc-types";
import { getUsdRates, toUSD } from "@/lib/fx";
import { fmtDays } from "@/lib/format-date";
import { getCashPosition } from "@/lib/wallet";
import { generateVatPeriods } from "@/lib/vat";
import { generateTaxPeriods } from "@/lib/tax";
import Sidebar from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import Link from "next/link";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import { redirect } from "next/navigation";
import ProjectHealthCard from "./ProjectHealthCard";
import type { ReactNode } from "react";

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function TimelineIcon({ docType }: { docType: string | null }) {
  const t = docType ?? "other";
  const icons: Record<string, { bg: string; fg: string; path: React.ReactNode }> = {
    visa: {
      bg: "bg-blue-50", fg: "#3b82f6",
      path: <><rect x="2.5" y="3" width="11" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M5 7a2.5 2.5 0 0 1 3 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><circle cx="6.5" cy="5.5" r="1" fill="currentColor" opacity=".7" /><path d="M5 9.5h6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".5" /></>,
    },
    emirates_id: {
      bg: "bg-violet-50", fg: "#7c3aed",
      path: <><rect x="1.5" y="3.5" width="13" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.3" fill="none" /><circle cx="5" cy="7.5" r="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" /><path d="M8 6.5h4M8 8.5h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></>,
    },
    labor_card: {
      bg: "bg-indigo-50", fg: "#4f46e5",
      path: <><rect x="1.5" y="3.5" width="13" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M5 8.5V7a1.5 1.5 0 0 1 3 0v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" /><path d="M9.5 6.5h2M9.5 8.5h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></>,
    },
    trade_license: {
      bg: "bg-amber-50", fg: "#d97706",
      path: <><path d="M2 8.5V13h12V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" /><path d="M1 8.5h14M6 8.5V5h4v3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" /><path d="M6 13v-2.5h4V13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></>,
    },
    employee_contract: {
      bg: "bg-emerald-50", fg: "#059669",
      path: <><circle cx="6" cy="5" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M2 13c0-2.8 1.8-4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" /><path d="M10 8l1.5 1.5L14 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>,
    },
    client_contract: {
      bg: "bg-teal-50", fg: "#0d9488",
      path: <><path d="M2.5 9.5C2.5 7 4 5.5 5.5 5.5S8 7 8 7s.5-1.5 2.5-1.5S13 7 13 9.5c0 2-2.5 4-5 5-2.5-1-5.5-3-5.5-5z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" /></>,
    },
    lease_contract: {
      bg: "bg-orange-50", fg: "#ea580c",
      path: <><path d="M2 13V7.5L8 3l6 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M6 14v-3.5h4V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></>,
    },
    invoice: {
      bg: "bg-orange-50", fg: "#ea580c",
      path: <><path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M5 7h6M5 9h4M7 11h.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></>,
    },
    invoice_report: {
      bg: "bg-orange-50", fg: "#c2410c",
      path: <><path d="M2 4h8l2 2v6H2V4z" stroke="currentColor" strokeWidth="1.2" fill="none" /><path d="M4 11.5h8l1 1.5H4l1-1.5z" stroke="currentColor" strokeWidth="1.1" fill="none" opacity=".6" /><path d="M4 7h6M4 9h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></>,
    },
    payroll: {
      bg: "bg-pink-50", fg: "#db2777",
      path: <><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M8 5.5v1m0 3v1m-1.5-3.5h2.5a1 1 0 0 1 0 2H7a1 1 0 0 0 0 2h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></>,
    },
    insurance: {
      bg: "bg-cyan-50", fg: "#0891b2",
      path: <><path d="M8 2L2.5 4.5v4C2.5 11.5 5 13.5 8 14.5c3-1 5.5-3 5.5-6v-4L8 2z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" /><path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>,
    },
    government_permit: {
      bg: "bg-red-50", fg: "#dc2626",
      path: <><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none" /><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.1" fill="none" opacity=".6" /><path d="M8 2.5V5M8 11v2.5M2.5 8H5M11 8h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></>,
    },
    other: {
      bg: "bg-gray-100", fg: "#6b7280",
      path: <><path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M5 7h6M5 9.5h4M5 12h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></>,
    },
  };
  const cfg = icons[t] ?? icons.other;
  return (
    <div className={`w-8 h-8 rounded-xl ${cfg.bg} flex items-center justify-center shrink-0`} style={{ color: cfg.fg }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">{cfg.path}</svg>
    </div>
  );
}


const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const CONTRACT_DOC_TYPES  = ["employee_contract", "client_contract", "insurance", "other"] as const;
const GOVERNMENT_DOC_TYPES = ["visa", "emirates_id", "labor_card", "trade_license", "government_permit"] as const;
const LEASE_DOC_TYPES      = ["lease_contract"] as const;
const INVOICE_DOC_TYPES    = ["invoice", "invoice_report", "purchase_order"] as const;

function docTypeSection(t: string | null): string {
  if (!t) return "contracts";
  if ((GOVERNMENT_DOC_TYPES as readonly string[]).includes(t)) return "government";
  if ((LEASE_DOC_TYPES as readonly string[]).includes(t)) return "leases";
  if ((INVOICE_DOC_TYPES as readonly string[]).includes(t)) return "invoices";
  return "contracts";
}

export default async function DashboardPage() {
  const now = new Date();
  const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
  const in90 = new Date(now); in90.setDate(in90.getDate() + 90);

  const session = await auth();
  const wizardDone = await prisma.setting.findUnique({ where: { key: "wizardCompleted" } });
  if (!wizardDone || wizardDone.value !== "true") redirect("/onboarding");

  const perms = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null);
  const canPeople     = perms.people     !== "none";
  const canContracts  = perms.contracts  !== "none";
  const canGovernment = perms.government !== "none";
  const canInvoices   = perms.invoices   !== "none";
  const canLeases     = perms.leases     !== "none";
  const canPayroll    = perms.payroll    !== "none";
  const canProjects   = perms.projects   !== "none";

  const accessibleDocTypes: string[] = [
    ...(canContracts  ? CONTRACT_DOC_TYPES  : []),
    ...(canGovernment ? GOVERNMENT_DOC_TYPES : []),
    ...(canLeases     ? LEASE_DOC_TYPES     : []),
    ...(canInvoices   ? INVOICE_DOC_TYPES   : []),
  ];

  const renewalDocTypes = [
    ...(canContracts  ? CONTRACT_DOC_TYPES  : []),
    ...(canGovernment ? GOVERNMENT_DOC_TYPES : []),
    ...(canLeases     ? LEASE_DOC_TYPES     : []),
  ];

  const docInclude = { select: { id: true, parties: true, docType: true, filename: true, person: { select: { name: true } } } } as const;

  const [allDocsRaw, urgentDocsRaw, upcomingDocsRaw, recentDocsRaw, employeesRaw, invoiceDocsRaw, contractCountRaw, payrollDaySetting, entityNameSetting, usdRates, upcomingPaymentsRaw, overduePaymentsRaw, unprocessedRunsRaw, allPayrollRunsRaw, unlinkedPaymentsRaw, vatConfigsRaw, taxConfigsRaw, capitalInjectionsRaw, paidPayrollEntriesRaw] = await Promise.all([
    prisma.document.count(),
    prisma.document.findMany({
      where: { status: "extracted", expiryDate: { gt: now, lte: in30 }, docType: { notIn: ["invoice", "invoice_report"] } },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.document.findMany({
      where: { status: "extracted", expiryDate: { gt: in30, lte: in90 }, docType: { notIn: ["invoice", "invoice_report"] } },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.document.findMany({
      where: { status: "extracted" },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { person: { select: { name: true } } },
    }),
    prisma.person.findMany({
      orderBy: { contractEnd: "asc" },
      include: { document: { select: { id: true, renewalDeadline: true } } },
    }),
    prisma.document.findMany({
      where: { status: "extracted", docType: "invoice", isPaid: false },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.document.count({
      where: { status: "extracted", docType: { in: ["employee_contract", "client_contract"] } },
    }),
    prisma.setting.findUnique({ where: { key: "payrollDay" } }),
    prisma.setting.findUnique({ where: { key: "entityName" } }),
    getUsdRates(),
    prisma.paymentSchedule.findMany({
      where: { isPaid: false, dueDate: { gte: now, lte: in90 }, document: { docType: { not: "employee_contract" } } },
      orderBy: { dueDate: "asc" },
      include: { document: docInclude },
    }),
    prisma.paymentSchedule.findMany({
      where: { isPaid: false, dueDate: { lt: now }, document: { docType: { not: "employee_contract" } } },
      orderBy: { dueDate: "asc" },
      include: { document: docInclude },
    }),
    prisma.payrollRun.findMany({
      where: { isProcessed: false, month: { not: null }, year: { not: null } },
      include: { entries: { select: { salary: true, currency: true, isPaid: true } } },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    }),
    prisma.payrollRun.findMany({
      where: { month: { not: null }, year: { not: null } },
      select: { month: true, year: true, isProcessed: true },
    }),
    prisma.paymentSchedule.findMany({
      where: { isPaid: false, invoiceId: null, document: { docType: { in: ["client_contract", "purchase_order"] } } },
      orderBy: { dueDate: "asc" },
      include: { document: { select: { id: true, docType: true, parties: true, filename: true } } },
    }),
    prisma.vatConfig.findMany({
      where: { active: true },
      include: { payments: { select: { periodStart: true } } },
    }),
    prisma.taxConfig.findMany({
      where: { active: true },
      include: { payments: { select: { periodStart: true } } },
    }),
    prisma.capitalInjection.findMany({
      orderBy: { date: "desc" },
      select: { id: true, amount: true, currency: true, date: true, source: true, type: true },
    }),

    // Total paid salaries (all time)
    prisma.payrollEntry.findMany({
      where: { isPaid: true },
      select: { salary: true, currency: true },
    }),
  ]);

  // Permission-filter all fetched data (server component — raw data never reaches client)
  const allDocs        = accessibleDocTypes.length > 0 ? allDocsRaw : 0;
  const urgentDocs     = urgentDocsRaw.filter(d => accessibleDocTypes.includes(d.docType ?? "other"));
  const upcomingDocs   = upcomingDocsRaw.filter(d => accessibleDocTypes.includes(d.docType ?? "other"));
  const recentDocs     = recentDocsRaw.filter(d => accessibleDocTypes.includes(d.docType ?? "other")).slice(0, 6);
  const employees      = canPeople ? employeesRaw : [];
  const invoiceDocs    = canInvoices ? invoiceDocsRaw : [];
  const contractCount  = canContracts ? contractCountRaw : 0;
  const upcomingPayments = (canLeases || canInvoices)
    ? upcomingPaymentsRaw.filter(p => {
        const t = p.document.docType;
        return (canLeases && t === "lease_contract") || (canInvoices && (t === "client_contract" || t === "purchase_order"));
      })
    : [];
  const overduePayments = (canLeases || canInvoices)
    ? overduePaymentsRaw.filter(p => {
        const t = p.document.docType;
        return (canLeases && t === "lease_contract") || (canInvoices && (t === "client_contract" || t === "purchase_order"));
      })
    : [];
  const unprocessedRuns  = canPayroll ? unprocessedRunsRaw : [];
  const allPayrollRuns   = canPayroll ? allPayrollRunsRaw : [];
  const unlinkedPayments = canInvoices ? unlinkedPaymentsRaw : [];
  const capitalInjections = capitalInjectionsRaw;
  const totalCapitalUsd   = capitalInjections.reduce((s, c) => s + toUSD(c.amount, c.currency, usdRates), 0);

  // Total paid salaries (all time)
  const totalPaidSalariesUSD = canPayroll
    ? paidPayrollEntriesRaw.reduce((s, e) => s + toUSD(e.salary, e.currency, usdRates), 0)
    : 0;

  // Cash position — computed by the same shared function as the finances page
  const { currentCashNet, totalIncome: totalCollectedAllTime, totalExpenses: totalPaidExpensesAllTime } =
    await getCashPosition(usdRates);

  // Expenses excluding salaries (leases + expense claims + VAT + taxes)
  const totalExpensesExcludingSalariesUSD = totalPaidExpensesAllTime - totalPaidSalariesUSD;

  // VAT & Tax obligation items for the timeline (overdue or due within 90 days, unpaid)
  type TaxObligationItem = {
    kind: "vat_obligation" | "tax_obligation";
    sortDate: Date;
    label: string;
    country: string;
    currency: string;
    configId: string;
    isOverdue: boolean;
    taxType?: string;
    companyName?: string | null;
  };

  const taxObligationItems: TaxObligationItem[] = [];

  for (const config of vatConfigsRaw) {
    const paidStarts = new Set(config.payments.map((p) => p.periodStart.getTime()));
    const periods = generateVatPeriods(config.startDate, config.frequencyMonths, config.anchorMonth, config.filingDeadlineDays, config.periodsAhead);
    for (const period of periods) {
      if (paidStarts.has(period.periodStart.getTime())) continue;
      const daysToDeadline = daysUntil(period.dueDate);
      if (daysToDeadline > 90) continue;
      taxObligationItems.push({
        kind: "vat_obligation",
        sortDate: period.dueDate,
        label: period.label,
        country: config.country,
        currency: config.currency,
        configId: config.id,
        isOverdue: period.isOverdue,
        companyName: config.companyName,
      });
    }
  }

  for (const config of taxConfigsRaw) {
    const paidStarts = new Set(config.payments.map((p) => p.periodStart.getTime()));
    const periods = generateTaxPeriods(config.startDate, config.frequencyMonths, config.anchorMonth, config.filingDeadlineDays, config.periodsAhead);
    for (const period of periods) {
      if (paidStarts.has(period.periodStart.getTime())) continue;
      const daysToDeadline = daysUntil(period.dueDate);
      if (daysToDeadline > 90) continue;
      taxObligationItems.push({
        kind: "tax_obligation",
        sortDate: period.dueDate,
        label: period.label,
        country: config.country,
        currency: config.currency,
        configId: config.id,
        isOverdue: period.isOverdue,
        taxType: config.taxType,
        companyName: config.companyName,
      });
    }
  }

  const companyName = entityNameSetting?.value?.toLowerCase().trim() ?? "";

  // Compute next payroll date
  const payrollDay = payrollDaySetting ? parseInt(payrollDaySetting.value, 10) : null;
  let nextPayrollDate: Date | null = null;
  if (payrollDay) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), payrollDay);
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
    nextPayrollDate = candidate;
  }
  const daysToPayroll = nextPayrollDate ? daysUntil(nextPayrollDate) : null;
  const expectedPayrollUSD = employees
    .filter(e => e.salary != null)
    .reduce((sum, e) => sum + toUSD(e.salary!, e.salaryCurrency ?? "AED", usdRates), 0);

  const overdueInvoices = invoiceDocs.filter(d => d.expiryDate && daysUntil(d.expiryDate) < 0);
  const complianceDoc = urgentDocs[0] ?? upcomingDocs[0] ?? null;
  const renewalDocs = [...urgentDocs, ...upcomingDocs].filter(d => d.docType !== "invoice");
  const renewalsTotal = renewalDocs.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const allUpcoming = [...urgentDocs, ...upcomingDocs]
    .sort((a, b) => (a.expiryDate?.getTime() ?? 0) - (b.expiryDate?.getTime() ?? 0))
    .slice(0, 8);

  // Unified timeline: docs + employee contracts + upcoming lease payments + payroll + taxes, sorted by date
  type TimelineItem =
    | { kind: "doc";                 sortDate: Date; doc:     typeof allUpcoming[0] }
    | { kind: "person";              sortDate: Date; person:  typeof employees[0] }
    | { kind: "payment";             sortDate: Date; payment: typeof upcomingPayments[0] }
    | { kind: "payroll";             sortDate: Date }
    | { kind: "unprocessed_payroll"; sortDate: Date; run: typeof unprocessedRuns[0]; isPartial: boolean }
    | TaxObligationItem;

  // Build timeline entries for unprocessed runs:
  // — always include past-due runs
  // — always include partial runs (some entries paid) even if not yet due, so the user sees incomplete work
  const unprocessedPayrollEntriesRaw = unprocessedRuns
    .filter(r => r.month !== null && r.year !== null)
    .map(run => {
      const day = payrollDay ?? 1;
      const sortDate = new Date(run.year!, run.month! - 1, day);
      const paidCount = run.entries.filter(e => e.isPaid).length;
      const isPartial = paidCount > 0 && paidCount < run.entries.length;
      return { kind: "unprocessed_payroll" as const, sortDate, run, isPartial };
    })
    .filter(e => {
      const isPastDue = e.sortDate.getTime() < now.getTime();
      const isCurrentMonth = e.run.month === now.getMonth() + 1 && e.run.year === now.getFullYear();
      return isPastDue || isCurrentMonth || e.isPartial;
    });

  // Suppress the "Payroll run" reminder when a run already exists for that month (processed or unprocessed — the
  // unprocessed entry handles the display in the latter case)
  const hasRunForNextMonth = nextPayrollDate != null && allPayrollRuns.some(
    r => r.month === nextPayrollDate.getMonth() + 1 && r.year === nextPayrollDate.getFullYear()
  );
  // But if that run was just unmarked and is now unprocessed, it surfaces as "Payroll pending" above —
  // the suppression still holds so we don't show both
  const unprocessedPayrollEntries: TimelineItem[] = unprocessedPayrollEntriesRaw;
  const payrollTimelineEntry: TimelineItem[] =
    nextPayrollDate && daysUntil(nextPayrollDate) <= 90 && !hasRunForNextMonth
      ? [{ kind: "payroll" as const, sortDate: nextPayrollDate }]
      : [];

  const timelineItems: TimelineItem[] = [
    ...allUpcoming
      .filter(doc => accessibleDocTypes.includes(doc.docType ?? "other"))
      .map(doc => ({ kind: "doc" as const, sortDate: doc.expiryDate!, doc })),
    ...(canPeople ? employees
      .filter(e => e.contractEnd && daysUntil(e.contractEnd) >= 0 && daysUntil(e.contractEnd) <= 90 && !e.document)
      .map(person => ({ kind: "person" as const, sortDate: person.contractEnd!, person })) : []),
    ...upcomingPayments.map(p => ({ kind: "payment" as const, sortDate: p.dueDate, payment: p })),
    ...overduePayments.map(p => ({ kind: "payment" as const, sortDate: p.dueDate, payment: p })),
    ...(canPayroll ? payrollTimelineEntry : []),
    ...(canPayroll ? unprocessedPayrollEntries : []),
    ...taxObligationItems,
  ].sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime());

  // Generate morning briefing bullets from real data
  const briefingItems: ReactNode[] = [];

  // Renewals — one linked bullet per doc (urgent first, then upcoming, max 5)
  for (const doc of renewalDocs.slice(0, 5)) {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    const name = parties.length > 0 ? parties.join(", ") : doc.filename.replace(/\.[^.]+$/, "");
    const label = DOC_TYPE_LABELS[doc.docType ?? "other"] ?? "Document";
    const days = daysUntil(doc.expiryDate!);
    const isUrgent = days <= 30;
    briefingItems.push(
      <span className="inline-flex flex-wrap items-center gap-1">
        <Link href={`/records/${doc.id}`} className={`font-semibold hover:underline underline-offset-2 ${isUrgent ? "text-orange-700" : "text-indigo-700"}`}>
          {name}
        </Link>
        <span className="text-gray-400">·</span>
        <span className="text-gray-600">{label}</span>
        <span className="text-gray-400">·</span>
        <span className={`font-medium ${isUrgent ? "text-orange-600" : "text-blue-600"}`}>
          {days <= 0 ? "expires today" : `expires in ${days} day${days !== 1 ? "s" : ""}`}
        </span>
        {isUrgent && <span className="text-orange-600">— file renewal now</span>}
      </span>
    );
  }
  if (renewalDocs.length > 5) {
    briefingItems.push(`+${renewalDocs.length - 5} more renewal${renewalDocs.length - 5 > 1 ? "s" : ""} in the next 90 days.`);
  }

  if (overdueInvoices.length > 0) {
    const vendors = Array.from(new Set(overdueInvoices.flatMap(d => (d.parties ? JSON.parse(d.parties) as string[] : [])))).slice(0, 2);
    briefingItems.push(`${overdueInvoices.length} invoice${overdueInvoices.length > 1 ? "s" : ""} overdue — follow up with ${vendors.join(", ") || "vendors"}.`);
  }
  if (overduePayments.length > 0) {
    const byCur = new Map<string, number>();
    for (const p of overduePayments) byCur.set(p.currency, (byCur.get(p.currency) ?? 0) + p.amount);
    const amountStr = Array.from(byCur.entries()).map(([c, t]) => `${c} ${t.toLocaleString()}`).join(" + ");
    briefingItems.push(`${overduePayments.length} payment${overduePayments.length > 1 ? "s" : ""} overdue — ${amountStr} outstanding.`);
  }
  if (unlinkedPayments.length > 0) {
    briefingItems.push(`${unlinkedPayments.length} scheduled payment${unlinkedPayments.length > 1 ? "s have" : " has"} no invoice linked — see the action list below.`);
  }
  if (daysToPayroll !== null && daysToPayroll <= 7) {
    const amtStr = expectedPayrollUSD > 0 ? ` — USD ${Math.round(expectedPayrollUSD).toLocaleString()} expected` : "";
    briefingItems.push(`Payroll processes in ${daysToPayroll} day${daysToPayroll !== 1 ? "s" : ""} on the ${nextPayrollDate!.getDate()}th${amtStr}.`);
  }
  if (briefingItems.length === 0 && allDocs > 0) {
    briefingItems.push("All documents are current — no action required in the next 30 days.");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <Sidebar />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Dashboard" }]} />

        <main className="flex-1 p-4 sm:p-6 max-w-screen-xl w-full">

          {/* Morning briefing */}
          {briefingItems.length > 0 && (
            <div className="mb-5 bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-4">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                <span className="text-sm font-semibold text-gray-900">OpsMind read your operations overnight</span>
                <span className="text-xs font-medium text-indigo-600 bg-white border border-indigo-100 px-2 py-0.5 rounded-full">Morning briefing</span>
              </div>
              <ul className="space-y-1.5 pl-4">
                {briefingItems.map((item, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-indigo-400 mt-0.5 shrink-0 leading-none">•</span>
                    <span className="flex-1">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Main layout: left column + right sidebar */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
            {/* Left column */}
            <div className="flex flex-col gap-4">
            {/* Compliance + Receivables */}
            {(canContracts || canGovernment || canLeases || canInvoices) && (
            <div className={`grid gap-4 ${(canContracts || canGovernment || canLeases) && canInvoices ? "grid-cols-2" : "grid-cols-1"}`}>

            {/* Compliance & Renewals — merged */}
            {(canContracts || canGovernment || canLeases) && (
            <div className={`bg-white border rounded-xl p-5 ${urgentDocs.length > 0 ? "border-orange-100" : "border-surface-border"}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${urgentDocs.length > 0 ? "bg-orange-100" : "bg-gray-100"}`}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1l6 2.5v5C14 11 11.5 13.5 8 15c-3.5-1.5-6-4-6-6.5v-5L8 1z" stroke={urgentDocs.length > 0 ? "#ea580c" : "#9ca3af"} strokeWidth="1.5" fill="none" />
                    </svg>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Compliance & Renewals</span>
                </div>
                {renewalDocs.length > 0 && (
                  <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">{renewalDocs.length} in 90d</span>
                )}
              </div>

              {complianceDoc ? (() => {
                const days = daysUntil(complianceDoc.expiryDate!);
                const parties: string[] = complianceDoc.parties ? JSON.parse(complianceDoc.parties) : [];
                const label = DOC_TYPE_LABELS[complianceDoc.docType ?? "other"] ?? "Document";
                const issueDate = complianceDoc.issueDate ?? new Date(complianceDoc.expiryDate!.getTime() - 365 * 86400000);
                const total = complianceDoc.expiryDate!.getTime() - issueDate.getTime();
                const elapsed = Date.now() - issueDate.getTime();
                const pct = Math.min(100, Math.max(2, (elapsed / total) * 100));
                const restDocs = renewalDocs.filter(d => d.id !== complianceDoc.id).slice(0, 3);
                return (
                  <div>
                    {/* Most urgent item with progress bar */}
                    <Link href={`/records/${complianceDoc.id}`} className="block group mb-3">
                      <p className="text-base font-bold text-gray-900 mb-0.5 group-hover:text-indigo-700 transition-colors">
                        {label} expires in {days} day{days !== 1 ? "s" : ""}
                      </p>
                      {parties.length > 0 && <p className="text-xs text-gray-500 mb-2">{parties.join(", ")}</p>}
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                        <div className={`h-full rounded-full transition-all ${days <= 30 ? "bg-orange-400" : "bg-amber-300"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] text-gray-400">{Math.max(0, Math.round(elapsed / 86400000))}d ago</span>
                        <span className={`text-[10px] font-semibold ${days <= 30 ? "text-orange-500" : "text-amber-500"}`}>
                          {complianceDoc.expiryDate!.toISOString().split("T")[0]}
                        </span>
                      </div>
                    </Link>

                    {/* Remaining renewals */}
                    {restDocs.length > 0 && (
                      <>
                        <div className="border-t border-surface-border mt-3 mb-2" />
                        <div className="space-y-0">
                          {restDocs.map((doc, i) => {
                            const d = daysUntil(doc.expiryDate!);
                            const p: string[] = doc.parties ? JSON.parse(doc.parties) : [];
                            return (
                              <Link key={doc.id} href={`/records/${doc.id}`} className={`flex items-center justify-between py-1.5 ${i > 0 ? "border-t border-surface-border" : ""} hover:bg-surface-hover -mx-1 px-1 rounded transition-colors`}>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-gray-700 truncate max-w-[140px]">{p.length > 0 ? p.join(", ") : doc.filename.replace(/\.[^.]+$/, "")}</p>
                                  <p className="text-[10px] text-gray-400">{DOC_TYPE_LABELS[doc.docType ?? "other"]}</p>
                                </div>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${d <= 30 ? "text-orange-600 bg-orange-50" : "text-blue-600 bg-blue-50"}`}>
                                  in {d}d
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      </>
                    )}

                    <div className="flex items-center justify-between mt-3">
                      <Link href={`/records/${complianceDoc.id}`} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">Manage renewal →</Link>
                      {renewalDocs.length > 1 && (
                        <Link href="/records" className="text-xs text-gray-400 hover:text-gray-600">Review all →</Link>
                      )}
                    </div>
                  </div>
                );
              })() : (
                <div className="flex items-center gap-2.5 py-2">
                  <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7l2.5 2.5L11 4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">All documents current</p>
                    <p className="text-xs text-gray-400">Nothing expiring within 90 days</p>
                  </div>
                </div>
              )}
            </div>
            )}{/* end Compliance & Renewals */}

            {/* Receivables */}
            {canInvoices && (
            <div className={`bg-white border rounded-xl p-5 ${overdueInvoices.length > 0 ? "border-red-100" : "border-surface-border"}`}>
              <div className="flex items-center gap-2 mb-4">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${overdueInvoices.length > 0 ? "bg-red-100" : "bg-gray-100"}`}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M2 2h12v12l-2-1-2 1-2-1-2 1-2-1V2z" stroke={overdueInvoices.length > 0 ? "#dc2626" : "#9ca3af"} strokeWidth="1.5" fill="none" />
                    <path d="M5 6h6M5 9h4" stroke={overdueInvoices.length > 0 ? "#dc2626" : "#9ca3af"} strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Receivables</span>
              </div>

              {invoiceDocs.length > 0 ? (
                <>
                  <p className="text-base font-bold text-gray-900 mb-3">
                    {overdueInvoices.length > 0
                      ? `${overdueInvoices.length} invoice${overdueInvoices.length > 1 ? "s" : ""} overdue`
                      : `${invoiceDocs.length} invoice${invoiceDocs.length > 1 ? "s" : ""} tracked`}
                  </p>
                  <div className="space-y-2.5 mb-3">
                    {invoiceDocs.slice(0, 3).map(doc => {
                      const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
                      const days = doc.expiryDate ? daysUntil(doc.expiryDate) : null;
                      const pct = days !== null ? Math.min(100, Math.max(0, ((30 - Math.max(0, days)) / 30) * 100)) : 0;
                      return (
                        <div key={doc.id}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-600 truncate max-w-[140px]">{parties.length > 0 ? parties.join(", ") : doc.filename.replace(/\.[^.]+$/, "")}</span>
                            <span className={`text-[10px] font-semibold ${days !== null && days < 0 ? "text-red-500" : "text-gray-400"}`}>
                              {days !== null ? (days < 0 ? `${fmtDays(Math.abs(days))} overdue` : fmtDays(days)) : "—"}
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${days !== null && days < 0 ? "bg-red-400" : "bg-orange-300"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Link href="/records/invoices" className="text-xs font-medium text-indigo-600 hover:text-indigo-800">View invoices →</Link>
                </>
              ) : (
                <div className="py-2">
                  <p className="text-sm text-gray-400">No invoices tracked yet</p>
                  <Link href="/" className="text-xs font-medium text-indigo-600 hover:text-indigo-800 mt-1 inline-block">Upload invoice →</Link>
                </div>
              )}
            </div>
            )}{/* end Receivables */}
            </div>
            )}{/* end compliance+receivables grid */}

          {/* Payments without invoice */}
          {unlinkedPayments.length > 0 && (() => {
            // Group by contract document
            const byDoc = new Map<string, { doc: typeof unlinkedPayments[0]["document"]; payments: typeof unlinkedPayments }>();
            for (const p of unlinkedPayments) {
              const existing = byDoc.get(p.documentId);
              if (existing) existing.payments.push(p);
              else byDoc.set(p.documentId, { doc: p.document, payments: [p] });
            }
            const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const docTypeLabel: Record<string, string> = {
              client_contract: "Client",
              lease_contract: "Lease",
              employee_contract: "Employee",
              purchase_order: "PO",
            };
            const docTypeBadge: Record<string, string> = {
              client_contract: "bg-teal-50 text-teal-700",
              lease_contract: "bg-orange-50 text-orange-700",
              employee_contract: "bg-emerald-50 text-emerald-700",
              purchase_order: "bg-blue-50 text-blue-700",
            };
            return (
              <div className="mb-5 bg-white border border-amber-100 rounded-xl overflow-hidden">
                {/* Section header */}
                <div className="px-5 py-3.5 border-b border-amber-100 bg-amber-50/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 text-amber-500">
                        <path d="M7 1L13 12H1L7 1z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
                        <path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        <circle cx="7" cy="10" r="0.7" fill="currentColor" />
                      </svg>
                      <span className="text-sm font-semibold text-gray-900">Invoice required for upcoming payments</span>
                      <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                        {unlinkedPayments.length} payment{unlinkedPayments.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-amber-700/70 mt-1 leading-relaxed">
                    The following contract payments are due but no invoice has been created or linked yet. Open each contract to issue or attach one before the due date.
                  </p>
                </div>

                <div className="divide-y divide-surface-border">
                  {Array.from(byDoc.entries()).map(([docId, { doc, payments }]) => {
                    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
                    const vendorName = parties.length > 0 ? parties.join(", ") : doc.filename.replace(/\.[^.]+$/, "");
                    const label = docTypeLabel[doc.docType ?? ""] ?? "Contract";
                    const badge = docTypeBadge[doc.docType ?? ""] ?? "bg-gray-100 text-gray-600";
                    return (
                      <div key={docId} className="px-5 py-4">
                        {/* Contract header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest shrink-0 ${badge}`}>{label}</span>
                            <span className="text-sm font-bold text-gray-900 truncate">{vendorName}</span>
                            <span className="text-[11px] text-gray-400 shrink-0">· {payments.length} payment{payments.length !== 1 ? "s" : ""} pending</span>
                          </div>
                          <Link
                            href={`/records/${docId}`}
                            className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors shrink-0 ml-4"
                          >
                            Open contract
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </Link>
                        </div>

                        {/* Payment cards */}
                        <div className="flex flex-wrap gap-2">
                          {payments.map(p => {
                            const d = new Date(p.dueDate);
                            const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
                            const isOverdue = days < 0;
                            const isDueSoon = days >= 0 && days <= 14;
                            const statusColor = isOverdue ? "text-red-500" : isDueSoon ? "text-amber-500" : "text-gray-400";
                            const statusText = isOverdue
                              ? `${fmtDays(Math.abs(days))} overdue`
                              : days === 0 ? "Due today"
                              : `in ${fmtDays(days)}`;
                            return (
                              <div
                                key={p.id}
                                className={`flex items-stretch rounded-xl border overflow-hidden min-w-[170px] ${
                                  isOverdue ? "border-red-100" : isDueSoon ? "border-amber-100" : "border-gray-100"
                                }`}
                              >
                                {/* Date column */}
                                <div className={`flex flex-col items-center justify-center px-3 py-3 text-center shrink-0 ${
                                  isOverdue ? "bg-red-50" : isDueSoon ? "bg-amber-50" : "bg-gray-50"
                                }`}>
                                  <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 leading-none">{MONTHS_SHORT[d.getMonth()]}</span>
                                  <span className={`text-xl font-black leading-tight ${isOverdue ? "text-red-600" : isDueSoon ? "text-amber-600" : "text-gray-800"}`}>
                                    {d.getDate()}
                                  </span>
                                  <span className="text-[9px] text-gray-400 leading-none">{d.getFullYear()}</span>
                                </div>

                                {/* Content column */}
                                <div className="flex flex-col justify-center px-3 py-3 flex-1 min-w-0 bg-white">
                                  <div className="flex items-start justify-between gap-1.5">
                                    <p className="text-sm font-bold text-gray-900 leading-tight">
                                      {p.currency} {p.amount.toLocaleString()}
                                    </p>
                                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" className="text-amber-400 shrink-0 mt-0.5">
                                      <path d="M7 1L13 12H1L7 1z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
                                      <path d="M7 5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                      <circle cx="7" cy="9.5" r="0.65" fill="currentColor" />
                                    </svg>
                                  </div>
                                  {p.description && (
                                    <p className="text-[10px] text-gray-400 truncate mt-0.5 max-w-[120px]">{p.description}</p>
                                  )}
                                  <p className={`text-[11px] font-semibold mt-1 ${statusColor}`}>{statusText}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

              {/* Project health — live client component, auto-refreshes on focus + 90s interval */}
              {canProjects && <ProjectHealthCard />}

              {/* What's coming up */}
              <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
                <h2 className="text-sm font-semibold text-gray-900">What&apos;s coming up</h2>
                <Link href="/records" className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                  Next 90 days
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>

              {timelineItems.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <p className="text-sm text-gray-400">Nothing coming up in the next 90 days</p>
                  <Link href="/" className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-800">Upload documents →</Link>
                </div>
              ) : (
                <div className="divide-y divide-[#EEEAE0]">
                  {timelineItems.map((item) => {
                    const d = item.sortDate;
                    const days = daysUntil(d);

                    if (item.kind === "doc") {
                      const { doc } = item;
                      const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
                      return (
                        <Link key={`doc-${doc.id}`} href={`/records/${doc.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-hover transition-colors cursor-pointer">
                          <div className="w-9 text-center shrink-0">
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{MONTHS[d.getMonth()]}</p>
                            <p className="text-xl font-bold text-gray-900 leading-tight">{d.getDate()}</p>
                            <p className="text-[9px] text-gray-400">in {days}d</p>
                          </div>
                          <TimelineIcon docType={doc.docType} />
                          <div className="flex-1 min-w-0">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${DOC_TYPE_COLORS[doc.docType ?? "other"] ?? "bg-gray-100 text-gray-600"}`}>
                              {DOC_TYPE_LABELS[doc.docType ?? "other"] ?? doc.docType}
                            </span>
                            <p className="text-sm text-gray-700 truncate mt-0.5">{parties.length > 0 ? parties.join(", ") : doc.filename.replace(/\.[^.]+$/, "")}</p>
                          </div>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-gray-300 shrink-0">
                            <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Link>
                      );
                    }

                    if (item.kind === "person") {
                      const { person } = item;
                      return (
                        <Link key={`person-${person.id}`} href={`/people/${person.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-hover transition-colors cursor-pointer">
                          <div className="w-9 text-center shrink-0">
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{MONTHS[d.getMonth()]}</p>
                            <p className="text-xl font-bold text-gray-900 leading-tight">{d.getDate()}</p>
                            <p className="text-[9px] text-gray-400">in {days}d</p>
                          </div>
                          <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                              <circle cx="8" cy="5.5" r="3" stroke="#059669" strokeWidth="1.4" fill="none" />
                              <path d="M2 14c0-3.5 2.5-5.5 6-5.5s6 2 6 5.5" stroke="#059669" strokeWidth="1.4" strokeLinecap="round" fill="none" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-700">Employee Contract</span>
                            <p className="text-sm text-gray-700 truncate mt-0.5">{person.name}</p>
                            {person.jobTitle && <p className="text-xs text-gray-400">{person.jobTitle}</p>}
                          </div>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-gray-300 shrink-0">
                            <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Link>
                      );
                    }

                    if (item.kind === "payment") {
                    const { payment } = item;
                    const docParties: string[] = payment.document.parties ? JSON.parse(payment.document.parties) : [];
                    const contractName = payment.document.person?.name ?? (docParties.length > 0 ? docParties.join(", ") : payment.document.filename.replace(/\.[^.]+$/, ""));
                    const isOverdue = days < 0;
                    const isDueSoon = !isOverdue && days <= 7;
                    const isSalary = payment.document.docType === "employee_contract";
                    const paymentLabel = isSalary ? "Salary" : "Lease payment";
                    const overdueLabel = isSalary ? "Overdue salary" : "Overdue payment";
                    const rowBg = isOverdue ? "bg-red-50/40" : isDueSoon ? "bg-violet-50/30" : "";
                    const iconColor = isOverdue ? "#dc2626" : "#7c3aed";
                    const iconBg = isOverdue ? "bg-red-50" : "bg-violet-50";
                    const pillClass = isOverdue ? "bg-red-50 text-red-700" : "bg-violet-50 text-violet-700";
                    const amountClass = isOverdue ? "text-red-600" : isDueSoon ? "text-violet-700" : "text-gray-800";
                    const dateClass = isOverdue ? "text-red-600" : isDueSoon ? "text-violet-700" : "text-gray-900";
                    return (
                      <Link key={`pay-${payment.id}`} href={`/records/${payment.document.id}`} className={`flex items-center gap-4 px-5 py-3 hover:bg-surface-hover transition-colors cursor-pointer ${rowBg}`}>
                        <div className="w-9 text-center shrink-0">
                          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{MONTHS[d.getMonth()]}</p>
                          <p className={`text-xl font-bold leading-tight ${dateClass}`}>{d.getDate()}</p>
                          <p className={`text-[9px] font-semibold ${isOverdue ? "text-red-500" : "text-gray-400"}`}>
                            {isOverdue ? `${fmtDays(Math.abs(days))} ago` : `in ${fmtDays(days)}`}
                          </p>
                        </div>
                        <div className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke={iconColor} strokeWidth="1.3" fill="none" />
                            <path d="M5 7.5h2.5M5 9.5h4M10.5 5.5v2m0 2v.5" stroke={iconColor} strokeWidth="1.3" strokeLinecap="round" />
                            <path d="M9 6.5h2.5a.5.5 0 0 1 0 1H9" stroke={iconColor} strokeWidth="1.1" strokeLinecap="round" fill="none" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pillClass}`}>
                              {isOverdue ? overdueLabel : paymentLabel}
                            </span>
                            {isOverdue && (
                              <span className="text-[10px] font-bold text-red-600 uppercase tracking-wide">Action needed</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-700 truncate mt-0.5">{contractName}</p>
                          <p className="text-xs text-gray-400">{payment.description}</p>
                          {!payment.invoiceId && !isSalary && (
                            <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 bg-amber-50 border border-amber-100 rounded-md w-fit">
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="shrink-0 text-amber-500">
                                <path d="M6 1L11 10H1L6 1z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
                                <path d="M6 4.5v2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                <circle cx="6" cy="8.5" r="0.6" fill="currentColor" />
                              </svg>
                              <span className="text-[10px] font-semibold text-amber-700">Invoice required — open contract to create &amp; link</span>
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-semibold tabular-nums ${amountClass}`}>
                            {payment.currency} {payment.amount.toLocaleString()}
                          </p>
                        </div>
                      </Link>
                    );
                    }

                    if (item.kind === "unprocessed_payroll") {
                      const { run, isPartial } = item;
                      const isPast = days < 0;
                      const isCurrentMonth = run.month === now.getMonth() + 1 && run.year === now.getFullYear();
                      const runTotal = run.entries.reduce((s, e) => s + toUSD(e.salary, e.currency, usdRates), 0);
                      const paidCount = run.entries.filter(e => e.isPaid).length;
                      const totalCount = run.entries.length;
                      const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
                      const monthLabel = run.month ? MONTH_NAMES[run.month - 1] : "";
                      const rowBg = isPast ? "bg-amber-50/40" : isCurrentMonth ? "bg-amber-50/20" : "";
                      const pillClass = isPast ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
                      const dateClass = isPast ? "text-red-600" : isCurrentMonth ? "text-amber-600" : "text-gray-900";
                      return (
                        <Link key={`upayroll-${run.id}`} href={`/payroll?month=${run.month}&year=${run.year}`} className={`flex items-center gap-4 px-5 py-3 hover:bg-surface-hover transition-colors cursor-pointer ${rowBg}`}>
                          <div className="w-9 text-center shrink-0">
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{MONTHS[d.getMonth()]}</p>
                            <p className={`text-xl font-bold leading-tight ${dateClass}`}>{d.getDate()}</p>
                            <p className={`text-[9px] font-semibold ${isPast ? "text-red-500" : "text-gray-400"}`}>
                              {isPast ? `${fmtDays(Math.abs(days))} ago` : `in ${fmtDays(days)}`}
                            </p>
                          </div>
                          <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                              <circle cx="5.5" cy="5" r="2" stroke="#d97706" strokeWidth="1.3" fill="none" />
                              <circle cx="10.5" cy="5" r="2" stroke="#d97706" strokeWidth="1.3" fill="none" />
                              <path d="M1.5 14c0-2.5 1.8-4 4-4s4 1.5 4 4" stroke="#d97706" strokeWidth="1.3" strokeLinecap="round" fill="none" />
                              <path d="M12 10c1.5.5 2.5 1.8 2.5 4" stroke="#d97706" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity=".6" />
                              <path d="M13 2l.5 4M13 7.5v.5" stroke="#d97706" strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pillClass}`}>
                                {isPast ? "Payroll overdue" : "Payroll pending"}
                              </span>
                              {isPartial && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                                  Partial — {paidCount}/{totalCount} paid
                                </span>
                              )}
                              {isPast && !isPartial && <span className="text-[10px] font-bold text-red-600 uppercase tracking-wide">Not processed</span>}
                            </div>
                            <p className="text-sm text-gray-700 mt-0.5">{monthLabel} {run.year}</p>
                            <p className="text-xs text-gray-400">{run.entries.length} employee{run.entries.length !== 1 ? "s" : ""}</p>
                          </div>
                          <div className="text-right shrink-0">
                            {runTotal > 0 && (
                              <p className={`text-sm font-semibold tabular-nums ${isPast ? "text-amber-600" : "text-gray-800"}`}>
                                USD {Math.round(runTotal).toLocaleString()}
                              </p>
                            )}
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-gray-300 mt-0.5 ml-auto">
                              <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </Link>
                      );
                    }

                    if (item.kind === "vat_obligation" || item.kind === "tax_obligation") {
                      const isOverdue = item.isOverdue || days < 0;
                      const isDueSoon = !isOverdue && days <= 14;
                      const isVat = item.kind === "vat_obligation";
                      const TAX_TYPE_LABELS: Record<string, string> = { corporate: "Corporate Tax", income: "Income Tax", withholding: "Withholding Tax", other: "Tax" };
                      const typeLabel = isVat ? "VAT" : (TAX_TYPE_LABELS[item.taxType ?? "other"] ?? "Tax");
                      const pillClass = isOverdue ? "bg-red-50 text-red-700" : isDueSoon ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700";
                      const iconColor = isOverdue ? "#dc2626" : isDueSoon ? "#d97706" : "#7c3aed";
                      const iconBg   = isOverdue ? "bg-red-50"  : isDueSoon ? "bg-amber-50"  : "bg-violet-50";
                      const rowBg    = isOverdue ? "bg-red-50/40" : isDueSoon ? "bg-amber-50/20" : "";
                      const dateClass = isOverdue ? "text-red-600" : isDueSoon ? "text-amber-600" : "text-gray-900";
                      const href = isVat ? `/vat` : `/taxes`;
                      return (
                        <Link key={`${item.kind}-${item.configId}-${item.label}`} href={href} className={`flex items-center gap-4 px-5 py-3 hover:bg-surface-hover transition-colors cursor-pointer ${rowBg}`}>
                          <div className="w-9 text-center shrink-0">
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{MONTHS[d.getMonth()]}</p>
                            <p className={`text-xl font-bold leading-tight ${dateClass}`}>{d.getDate()}</p>
                            <p className={`text-[9px] font-semibold ${isOverdue ? "text-red-500" : "text-gray-400"}`}>
                              {isOverdue ? `${fmtDays(Math.abs(days))} ago` : `in ${fmtDays(days)}`}
                            </p>
                          </div>
                          <div className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                              <rect x="1" y="3" width="14" height="10" rx="1.5" stroke={iconColor} strokeWidth="1.3" fill="none" />
                              <path d="M5 8h2m0 0h2m-2 0V6m0 2v2" stroke={iconColor} strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pillClass}`}>
                                {isOverdue ? `Overdue ${typeLabel}` : `${typeLabel} due`}
                              </span>
                              {isOverdue && <span className="text-[10px] font-bold text-red-600 uppercase tracking-wide">File now</span>}
                            </div>
                            <p className="text-sm text-gray-700 truncate mt-0.5">
                              {item.companyName ?? item.country} · {item.label}
                            </p>
                            <p className="text-xs text-gray-400">{item.country} · {item.currency}</p>
                          </div>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-gray-300 shrink-0">
                            <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Link>
                      );
                    }

                    // kind === "payroll"
                    const isPayrollSoon = days <= 3;
                    const employeeCount = employees.filter(e => e.salary != null).length;
                    return (
                      <Link key="payroll" href="/payroll" className={`flex items-center gap-4 px-5 py-3 hover:bg-surface-hover transition-colors cursor-pointer ${isPayrollSoon ? "bg-indigo-50/30" : ""}`}>
                        <div className="w-9 text-center shrink-0">
                          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{MONTHS[d.getMonth()]}</p>
                          <p className={`text-xl font-bold leading-tight ${isPayrollSoon ? "text-indigo-600" : "text-gray-900"}`}>{d.getDate()}</p>
                          <p className="text-[9px] text-gray-400">in {days}d</p>
                        </div>
                        <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <circle cx="5.5" cy="5" r="2" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                            <circle cx="10.5" cy="5" r="2" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                            <path d="M1.5 14c0-2.5 1.8-4 4-4s4 1.5 4 4" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round" fill="none" />
                            <path d="M12 10c1.5.5 2.5 1.8 2.5 4" stroke="#4f46e5" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity=".6" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isPayrollSoon ? "bg-indigo-100 text-indigo-700" : "bg-indigo-50 text-indigo-600"}`}>Payroll run</span>
                          <p className="text-sm text-gray-700 mt-0.5">
                            {days === 0 ? "Processing today" : days === 1 ? "Processing tomorrow" : `In ${days} days`}
                          </p>
                          {employeeCount > 0 && (
                            <p className="text-xs text-gray-400">{employeeCount} employee{employeeCount !== 1 ? "s" : ""}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {expectedPayrollUSD > 0 && (
                            <p className={`text-sm font-semibold tabular-nums ${isPayrollSoon ? "text-indigo-600" : "text-gray-800"}`}>
                              USD {Math.round(expectedPayrollUSD).toLocaleString()}
                            </p>
                          )}
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-gray-300 mt-0.5 ml-auto">
                            <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            </div>{/* end left column */}

            {/* Right sidebar */}
            <div className="flex flex-col gap-4">

              {/* Payment schedule */}
              {(canLeases || canInvoices) && (() => {
                const allScheduled = [...overduePayments, ...upcomingPayments];
                const hasAlert = overduePayments.length > 0;
                const sumByCur = (pmts: typeof overduePayments) => {
                  const m = new Map<string, number>();
                  for (const p of pmts) m.set(p.currency, (m.get(p.currency) ?? 0) + p.amount);
                  return m;
                };
                const formatCurTotals = (m: Map<string, number>) =>
                  Array.from(m.entries()).map(([c, t]) => `${c} ${t.toLocaleString()}`).join(" + ");
                const overdueByCur  = sumByCur(overduePayments);
                const upcomingByCur = sumByCur(upcomingPayments);
                return (
                  <div className={`bg-white border rounded-xl p-5 ${hasAlert ? "border-red-100" : "border-surface-border"}`}>
                    <div className="flex items-center gap-2 mb-4">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${hasAlert ? "bg-red-100" : "bg-violet-50"}`}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <rect x="2" y="3" width="12" height="10" rx="1.5" stroke={hasAlert ? "#dc2626" : "#7c3aed"} strokeWidth="1.3" fill="none" />
                          <path d="M5 7.5h2.5M5 9.5h4M10.5 5.5v2m0 2v.5" stroke={hasAlert ? "#dc2626" : "#7c3aed"} strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                      </div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Payment schedule</span>
                    </div>
                    {allScheduled.length > 0 ? (
                      <>
                        {overduePayments.length > 0 ? (
                          <p className="text-base font-bold text-red-600 mb-0.5">
                            {overduePayments.length} payment{overduePayments.length > 1 ? "s" : ""} overdue
                          </p>
                        ) : (
                          <p className="text-base font-bold text-gray-900 mb-0.5">
                            {upcomingPayments.length} payment{upcomingPayments.length > 1 ? "s" : ""} upcoming
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mb-3">
                          {overdueByCur.size > 0 && <span className="text-red-500 font-medium">{formatCurTotals(overdueByCur)} overdue</span>}
                          {overdueByCur.size > 0 && upcomingByCur.size > 0 && <span className="text-gray-300 mx-1">·</span>}
                          {upcomingByCur.size > 0 && <span>{formatCurTotals(upcomingByCur)} upcoming</span>}
                        </p>
                        <div className="space-y-0 mb-3">
                          {allScheduled.slice(0, 3).map((p, i) => {
                            const docParties: string[] = p.document.parties ? JSON.parse(p.document.parties) : [];
                            const name = p.document.person?.name ?? (docParties.length > 0 ? docParties.join(", ") : p.document.filename.replace(/\.[^.]+$/, ""));
                            const days = daysUntil(p.dueDate);
                            const isOverdue = days < 0;
                            return (
                              <Link key={p.id} href={`/records/${p.document.id}`} className={`flex items-center justify-between py-1.5 ${i > 0 ? "border-t border-surface-border" : ""} hover:bg-surface-hover -mx-1 px-1 rounded transition-colors`}>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-gray-700 truncate max-w-[160px]">{name}</p>
                                  <p className={`text-[10px] font-medium ${isOverdue ? "text-red-500" : "text-gray-400"}`}>
                                    {isOverdue ? `${fmtDays(Math.abs(days))} overdue` : `in ${fmtDays(days)}`}
                                  </p>
                                </div>
                                <span className={`text-[10px] font-semibold shrink-0 ${isOverdue ? "text-red-600" : "text-gray-700"}`}>
                                  {p.currency} {p.amount.toLocaleString()}
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                        <Link href="/records" className="text-xs font-medium text-indigo-600 hover:text-indigo-800">View schedule →</Link>
                      </>
                    ) : (
                      <div className="py-2">
                        <p className="text-sm text-gray-400">No payments scheduled</p>
                        <p className="text-xs text-gray-300 mt-0.5">Upload a lease or vendor contract to track payment schedules</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Cash position */}
              {(perms.finances !== "none") && (
              <div className="bg-white border border-surface-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="7" r="5.5" stroke="#059669" strokeWidth="1.3" />
                        <path d="M7 4.5v1m0 3v1m-1.5-3.5h2.5a1 1 0 0 1 0 2H5.5a1 1 0 0 0 0 2H8" stroke="#059669" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cash position</span>
                  </div>
                  <Link href="/finances" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                    View finances →
                  </Link>
                </div>
                <p className={`text-2xl font-bold tabular-nums mb-0.5 ${currentCashNet >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {currentCashNet >= 0 ? "+" : ""}
                  {Math.abs(currentCashNet) >= 1_000_000
                    ? `$${(Math.abs(currentCashNet) / 1_000_000).toFixed(2)}M`
                    : Math.abs(currentCashNet) >= 1_000
                    ? `$${(Math.abs(currentCashNet) / 1_000).toFixed(1)}K`
                    : `$${Math.abs(currentCashNet).toLocaleString()}`}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  <span className="text-emerald-600 font-medium">
                    {totalCollectedAllTime >= 1_000_000
                      ? `$${(totalCollectedAllTime / 1_000_000).toFixed(2)}M`
                      : totalCollectedAllTime >= 1_000
                      ? `$${(totalCollectedAllTime / 1_000).toFixed(1)}K`
                      : `$${totalCollectedAllTime.toLocaleString()}`}
                  </span>
                  <span className="mx-1 text-gray-300">collected</span>
                  <span className="text-gray-300">−</span>
                  <span className="text-red-400 font-medium ml-1">
                    {totalPaidExpensesAllTime >= 1_000_000
                      ? `$${(totalPaidExpensesAllTime / 1_000_000).toFixed(2)}M`
                      : totalPaidExpensesAllTime >= 1_000
                      ? `$${(totalPaidExpensesAllTime / 1_000).toFixed(1)}K`
                      : `$${totalPaidExpensesAllTime.toLocaleString()}`}
                  </span>
                  <span className="mx-1 text-gray-300">paid out</span>
                </p>
              </div>
              )}

              {/* Expenses & Salaries KPI cards */}
              {(perms.finances !== "none" || canPayroll) && (
                <div className="grid grid-cols-2 gap-3">
                  {perms.finances !== "none" && (
                    <div className="bg-white border border-surface-border rounded-xl px-4 py-3">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Expenses</p>
                      <p className="text-lg font-bold text-gray-900 tabular-nums leading-tight">
                        {totalExpensesExcludingSalariesUSD >= 1_000_000
                          ? `$${(totalExpensesExcludingSalariesUSD / 1_000_000).toFixed(2)}M`
                          : totalExpensesExcludingSalariesUSD >= 1_000
                          ? `$${(totalExpensesExcludingSalariesUSD / 1_000).toFixed(1)}K`
                          : `$${Math.round(totalExpensesExcludingSalariesUSD).toLocaleString()}`}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">excl. salaries · USD</p>
                    </div>
                  )}
                  {canPayroll && (
                    <div className="bg-white border border-surface-border rounded-xl px-4 py-3">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Total salaries</p>
                      <p className="text-lg font-bold text-gray-900 tabular-nums leading-tight">
                        {totalPaidSalariesUSD >= 1_000_000
                          ? `$${(totalPaidSalariesUSD / 1_000_000).toFixed(2)}M`
                          : totalPaidSalariesUSD >= 1_000
                          ? `$${(totalPaidSalariesUSD / 1_000).toFixed(1)}K`
                          : `$${Math.round(totalPaidSalariesUSD).toLocaleString()}`}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">paid · USD equiv.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Recent activity */}
              <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-surface-border">
                <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
                <Link href="/records" className="text-xs text-gray-400 hover:text-gray-600">All activity</Link>
              </div>
              <div className="divide-y divide-[#EEEAE0]">
                {recentDocs.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-gray-400">No documents yet</p>
                  </div>
                ) : recentDocs.map(doc => {
                  const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
                  const otherParty = doc.person?.name
                    ?? parties.find(p => p.toLowerCase().trim() !== companyName)
                    ?? parties[0]
                    ?? doc.filename.replace(/\.[^.]+$/, "");
                  const diff = Math.floor((Date.now() - doc.createdAt.getTime()) / 60000);
                  const ago = diff < 60 ? `${diff}m ago` : diff < 1440 ? `${Math.floor(diff / 60)}h ago` : `${Math.floor(diff / 1440)}d ago`;
                  return (
                    <Link key={doc.id} href={`/records/${doc.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors cursor-pointer">
                      <TimelineIcon docType={doc.docType} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{otherParty}</p>
                        <p className="text-[10px] text-gray-400">{DOC_TYPE_LABELS[doc.docType ?? "other"] ?? doc.docType} · uploaded</p>
                      </div>
                      <p className="text-[10px] text-gray-400 shrink-0">{ago}</p>
                    </Link>
                  );
                })}
              </div>
            </div>

              {/* Quick stats */}
              <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3.5 border-b border-surface-border">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  <h2 className="text-sm font-semibold text-gray-900">Quick stats</h2>
                </div>
                <Link href="/records" className="text-xs text-indigo-600 hover:text-indigo-800">View all</Link>
              </div>
              <div className="divide-y divide-[#EEEAE0]">
                {[
                  { label: "Total documents",  value: allDocs,            href: "/records",           show: accessibleDocTypes.length > 0 },
                  { label: "Contracts",         value: contractCount,      href: "/records/contracts",  show: canContracts },
                  { label: "People tracked",    value: employees.length,   href: "/people",             show: canPeople },
                  { label: "Unpaid invoices",   value: invoiceDocs.length, href: "/records/invoices",   show: canInvoices },
                ].filter(s => s.show).map(({ label, value, href }) => (
                  <Link key={label} href={href} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-hover transition-colors cursor-pointer">
                    <span className="text-xs text-gray-600">{label}</span>
                    <span className="text-xs font-semibold text-gray-900">{value}</span>
                  </Link>
                ))}
                {urgentDocs.length > 0 && (
                  <Link href="/records" className="flex items-center justify-between px-4 py-2.5 bg-red-50/40 hover:bg-red-50/60 transition-colors cursor-pointer">
                    <span className="text-xs text-red-700 font-medium">Expiring in 30 days</span>
                    <span className="text-xs font-semibold text-red-600">{urgentDocs.length}</span>
                  </Link>
                )}
              </div>
              <div className="px-4 py-3 border-t border-surface-border">
                <Link href="/ai" className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 group transition-colors">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1l1 3.2L11 6l-4 1.8L6 11l-1-3.8L1 6l4-1.8L6 1z" fill="#6366f1" />
                  </svg>
                  <span>Ask about your operations...</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                    <path d="M2 5h6M5 2l3 3-3 3" stroke="#6366f1" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>
            </div>
            </div>{/* end right sidebar */}
          </div>{/* end main layout */}

          {/* Employee contracts table */}
          {employees.length > 0 && (
            <div className="mt-4 bg-white border border-surface-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
                <h2 className="text-sm font-semibold text-gray-900">Employee contracts</h2>
                <Link href="/people" className="text-xs text-gray-400 hover:text-gray-600">View all →</Link>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-inset">
                    {["Employee", "Hiring date", "Contract end", "Days remaining", "Renewal reminder", "Status"].map(h => (
                      <th key={h} className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {employees.map(person => {
                    const renewalDeadline = person.document?.renewalDeadline
                      ?? (person.contractEnd ? new Date(new Date(person.contractEnd).getTime() - 90 * 86400000) : null);
                    const daysToEnd = person.contractEnd ? daysUntil(person.contractEnd) : null;
                    const daysToReminder = renewalDeadline ? daysUntil(renewalDeadline) : null;

                    let rowClass = "transition-colors cursor-pointer hover:bg-surface-hover";
                    if (daysToEnd !== null && daysToEnd < 0) rowClass = "bg-red-50/50 hover:bg-red-50/70 transition-colors cursor-pointer";
                    else if (daysToEnd !== null && daysToEnd <= 7) rowClass = "bg-red-50/40 hover:bg-red-50/60 transition-colors cursor-pointer";
                    else if (daysToEnd !== null && daysToEnd <= 30) rowClass = "bg-red-50/20 hover:bg-red-50/40 transition-colors cursor-pointer";
                    else if (daysToEnd !== null && daysToEnd <= 90) rowClass = "bg-amber-50/20 hover:bg-amber-50/40 transition-colors cursor-pointer";

                    let statusEl: React.ReactNode = <span className="text-xs text-gray-300">—</span>;
                    if (daysToEnd !== null) {
                      if (daysToEnd < 0) statusEl = <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">Expired</span>;
                      else if (daysToEnd === 0) statusEl = <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">Expires today</span>;
                      else if (daysToEnd <= 7) statusEl = <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Renew now</span>;
                      else if (daysToEnd <= 30) statusEl = <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Urgent renewal</span>;
                      else if (daysToEnd <= 60) statusEl = <span className="text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">Due soon</span>;
                      else if (daysToEnd <= 90) statusEl = <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Review needed</span>;
                      else if (daysToEnd <= 180) statusEl = <span className="text-xs font-semibold text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">Coming up</span>;
                      else statusEl = <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Active</span>;
                    }

                    return (
                      <tr key={person.id} className={rowClass}>
                        <td className="px-5 py-3">
                          <Link href={`/people/${person.id}`} className="flex items-center gap-2.5 group">
                            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-indigo-600">
                                {person.name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 transition-colors">{person.name}</p>
                              {person.jobTitle && <p className="text-xs text-gray-400">{person.jobTitle}</p>}
                            </div>
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-600">
                          {person.contractStart ? person.contractStart.toISOString().split("T")[0] : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-600">
                          {person.contractEnd ? person.contractEnd.toISOString().split("T")[0] : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3">
                          {daysToEnd === null ? (
                            <span className="text-gray-300 text-sm">—</span>
                          ) : daysToEnd < 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-red-800 bg-red-100 px-2.5 py-1 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />Expired {fmtDays(Math.abs(daysToEnd))} ago
                            </span>
                          ) : daysToEnd === 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-red-800 bg-red-100 px-2.5 py-1 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse shrink-0" />Expires today
                            </span>
                          ) : daysToEnd <= 7 ? (
                            <div>
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2.5 py-1 rounded-full">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />{fmtDays(daysToEnd)} left
                              </span>
                              <p className="text-[10px] font-bold text-red-600 mt-0.5 ml-0.5 uppercase tracking-wide">Renew now</p>
                            </div>
                          ) : daysToEnd <= 30 ? (
                            <div>
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2.5 py-1 rounded-full">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />{fmtDays(daysToEnd)} left
                              </span>
                              <p className="text-[10px] text-red-500 mt-0.5 ml-0.5">Begin renewal process</p>
                            </div>
                          ) : daysToEnd <= 60 ? (
                            <div>
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-50 px-2.5 py-1 rounded-full">
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />{fmtDays(daysToEnd)} left
                              </span>
                              <p className="text-[10px] text-orange-500 mt-0.5 ml-0.5">Plan renewal</p>
                            </div>
                          ) : daysToEnd <= 90 ? (
                            <div>
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />{fmtDays(daysToEnd)} left
                              </span>
                              <p className="text-[10px] text-amber-500 mt-0.5 ml-0.5">Review contract</p>
                            </div>
                          ) : daysToEnd <= 180 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-700 bg-yellow-50 px-2.5 py-1 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />{fmtDays(daysToEnd)} left
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />{fmtDays(daysToEnd)} left
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {renewalDeadline ? (
                            <div>
                              <p className="text-sm text-gray-600">{renewalDeadline.toISOString().split("T")[0]}</p>
                              {daysToReminder !== null && daysToReminder >= 0 && daysToReminder <= 30 && (
                                <p className="text-xs text-red-500 font-medium mt-0.5">Due in {daysToReminder}d</p>
                              )}
                              {daysToReminder !== null && daysToReminder < 0 && (
                                <p className="text-xs text-red-500 font-medium mt-0.5">Reminder passed</p>
                              )}
                            </div>
                          ) : <span className="text-gray-300 text-sm">—</span>}
                        </td>
                        <td className="px-5 py-3">{statusEl}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
