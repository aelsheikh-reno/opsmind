import { prisma } from "@/lib/prisma";
import { getUsdRates, toUSD } from "@/lib/fx";
import { getCashPosition } from "@/lib/wallet";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import Link from "next/link";
import TrendChart, { type TrendMonth } from "./TrendChart";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

const DOC_TYPE_LABEL: Record<string, string> = {
  employee_contract: "Contract", lease: "Lease", trade_license: "Trade License",
  visa: "Visa", emirates_id: "Emirates ID", labor_card: "Labor Card",
  government: "Gov. Doc", invoice: "Invoice",
};

type KpiColor = "indigo" | "violet" | "blue" | "green" | "red" | "amber" | "gray";

const KPI_COLORS: Record<KpiColor, { card: string; title: string; value: string }> = {
  indigo: { card: "bg-indigo-600",  title: "text-indigo-200", value: "text-white" },
  violet: { card: "bg-violet-600",  title: "text-violet-200", value: "text-white" },
  blue:   { card: "bg-blue-600",    title: "text-blue-200",   value: "text-white" },
  green:  { card: "bg-emerald-600", title: "text-emerald-200", value: "text-white" },
  red:    { card: "bg-red-500",     title: "text-red-200",    value: "text-white" },
  amber:  { card: "bg-amber-500",   title: "text-amber-100",  value: "text-white" },
  gray:   { card: "bg-white border border-surface-border", title: "text-gray-400", value: "text-gray-900" },
};

function KpiCard({ title, value, sub, color = "gray" }: { title: string; value: string; sub?: string; color?: KpiColor }) {
  const c = KPI_COLORS[color];
  return (
    <div className={`rounded-xl p-4 ${c.card}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${c.title}`}>{title}</p>
      <p className={`text-2xl font-bold leading-none tabular-nums ${c.value}`}>{value}</p>
      {sub && <p className={`text-[11px] mt-1.5 ${c.title}`}>{sub}</p>}
    </div>
  );
}

export default async function ExecutivePage() {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const d30 = new Date(now.getTime() + 30 * 86400000);
  const d90 = new Date(now.getTime() + 90 * 86400000);

  const [
    rates,
    headcount,
    thisMonthRun,
    unpaidInvoices,
    pendingClaims,
    expiringDocs,
    upcomingPayments,
    paidInvoices6m,
    payrollRuns6m,
  ] = await Promise.all([
    getUsdRates(),
    prisma.person.count({ where: { exitDate: null } }),
    prisma.payrollRun.findFirst({
      where: { month: now.getMonth() + 1, year: now.getFullYear() },
      include: { entries: { select: { salary: true, currency: true } } },
    }),
    prisma.document.findMany({
      where: { docType: "invoice", isPaid: false, amount: { not: null } },
      select: { id: true, amount: true, currency: true, issueDate: true, expiryDate: true, filename: true },
    }),
    prisma.expense.findMany({
      where: { claimStatus: "pending", amount: { not: null } },
      select: {
        id: true, name: true, amount: true, currency: true, createdAt: true,
        person: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.document.findMany({
      where: { expiryDate: { gte: now, lte: d90 }, docType: { not: "invoice" } },
      select: { id: true, filename: true, docType: true, expiryDate: true },
      orderBy: { expiryDate: "asc" },
      take: 8,
    }),
    prisma.paymentSchedule.findMany({
      where: { isPaid: false, dueDate: { gte: now, lte: d30 } },
      include: { document: { select: { filename: true, docType: true } } },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
    prisma.document.findMany({
      where: {
        docType: "invoice", isPaid: true, amount: { not: null },
        OR: [
          { paidAt: { gte: sixMonthsAgo } },
          { AND: [{ paidAt: null }, { issueDate: { gte: sixMonthsAgo } }] },
        ],
      },
      select: { amount: true, currency: true, paidAt: true, issueDate: true },
    }),
    prisma.payrollRun.findMany({
      where: { month: { not: null }, year: { gte: sixMonthsAgo.getFullYear() } },
      include: { entries: { select: { salary: true, currency: true } } },
    }),
  ]);

  // KPI computations
  const payrollBurnUsd = thisMonthRun
    ? thisMonthRun.entries.reduce((s, e) => s + toUSD(e.salary, e.currency, rates), 0)
    : 0;

  const receivablesUsd = unpaidInvoices.reduce((s, i) => s + toUSD(i.amount!, i.currency ?? "USD", rates), 0);

  // An invoice is overdue when its due date (expiryDate) has passed and it is still unpaid.
  // Fall back to issueDate only when no due date is set, treating it as due immediately.
  const overdueInvoices = unpaidInvoices.filter(i => {
    const dueDate = i.expiryDate ?? i.issueDate;
    return dueDate != null && dueDate < now;
  });
  const overdueUsd = overdueInvoices.reduce((s, i) => s + toUSD(i.amount!, i.currency ?? "USD", rates), 0);

  const pendingClaimsUsd = pendingClaims.reduce((s, c) => s + toUSD(c.amount!, c.currency, rates), 0);

  const { currentCashNet: cashPositionUsd } = await getCashPosition(rates);

  const expiringIn30 = expiringDocs.filter(d => d.expiryDate && daysUntil(d.expiryDate) <= 30).length;

  // 6-month trend
  const trendMonths: TrendMonth[] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { label: MONTH_SHORT[d.getMonth()], income: 0, expense: 0, _month: d.getMonth() + 1, _year: d.getFullYear() } as TrendMonth & { _month: number; _year: number };
  }) as (TrendMonth & { _month: number; _year: number })[];

  for (const inv of paidInvoices6m) {
    const d = inv.paidAt ?? inv.issueDate;
    if (!d) continue;
    const b = (trendMonths as (TrendMonth & { _month: number; _year: number })[])
      .find(m => m._month === d.getMonth() + 1 && m._year === d.getFullYear());
    if (b) b.income += toUSD(inv.amount!, inv.currency ?? "USD", rates);
  }

  for (const run of payrollRuns6m) {
    if (!run.month || !run.year) continue;
    const b = (trendMonths as (TrendMonth & { _month: number; _year: number })[])
      .find(m => m._month === run.month && m._year === run.year);
    if (b) {
      for (const e of run.entries) b.expense += toUSD(e.salary, e.currency, rates);
    }
  }

  const todayLabel = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const currentMonthLabel = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Command Center" }]} />

        <main className="px-4 sm:px-8 py-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
            <p className="text-sm text-gray-400 mt-0.5">{todayLabel} · Live operational overview</p>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard title="Headcount" value={headcount.toString()} sub="active employees" color="indigo" />
            <KpiCard title="Payroll this month" value={payrollBurnUsd > 0 ? fmtUSD(payrollBurnUsd) : "—"} sub={currentMonthLabel} color="violet" />
            <KpiCard title="Open receivables" value={fmtUSD(receivablesUsd)} sub={`${unpaidInvoices.length} invoice${unpaidInvoices.length !== 1 ? "s" : ""}`} color="blue" />
            <KpiCard title="Cash position" value={fmtUSD(Math.abs(cashPositionUsd))} sub={cashPositionUsd >= 0 ? `collected − all paid` : "net negative"} color={cashPositionUsd >= 0 ? "green" : "red"} />
            <KpiCard title="Overdue" value={overdueInvoices.length.toString()} sub={overdueInvoices.length > 0 ? fmtUSD(overdueUsd) : "All current"} color={overdueInvoices.length > 0 ? "red" : "gray"} />
            <KpiCard title="Expiring in 30d" value={expiringIn30.toString()} sub="contracts & docs" color={expiringIn30 > 0 ? "amber" : "gray"} />
          </div>

          {/* Trend + Upcoming obligations */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 bg-white border border-surface-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">6-month snapshot</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Invoice income vs. payroll expense · USD</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-2.5 rounded-sm bg-indigo-400 inline-block" />Income
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-2.5 rounded-sm bg-rose-300 inline-block" />Payroll
                  </span>
                </div>
              </div>
              <TrendChart months={trendMonths.map(m => ({ label: m.label, income: m.income, expense: m.expense }))} />
            </div>

            <div className="lg:col-span-2 bg-white border border-surface-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Next 30 days</h2>
                <span className="text-xs text-gray-400">Upcoming payments</span>
              </div>
              {upcomingPayments.length === 0 ? (
                <div className="flex flex-col items-center py-6 gap-1.5">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="8" stroke="#d1d5db" strokeWidth="1.5" />
                    <path d="M10 6v4l2.5 2.5" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <p className="text-xs text-gray-400">No payments due in next 30 days</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingPayments.map(p => {
                    const days = daysUntil(p.dueDate);
                    const urgency = days <= 5 ? "bg-red-50 text-red-600" : days <= 14 ? "bg-amber-50 text-amber-600" : "bg-surface-inset text-gray-500";
                    return (
                      <div key={p.id} className="flex items-center gap-3">
                        <div className={`text-center px-2 py-1 rounded-lg shrink-0 ${urgency}`}>
                          <p className="text-[10px] font-bold leading-tight">
                            {p.dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </p>
                          <p className="text-[9px] font-medium">{days}d</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">{p.document.filename}</p>
                          <p className="text-[10px] text-gray-400">{DOC_TYPE_LABEL[p.document.docType ?? ""] ?? p.document.docType}</p>
                        </div>
                        <span className="text-xs font-semibold text-gray-700 tabular-nums shrink-0">
                          {fmtUSD(toUSD(p.amount, p.currency, rates))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Expiring docs + Pending claims */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Expiring */}
            <div className="bg-white border border-surface-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Expiring within 90 days</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{expiringDocs.length} document{expiringDocs.length !== 1 ? "s" : ""} need attention</p>
                </div>
                <Link href="/records" className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors">
                  View all →
                </Link>
              </div>
              {expiringDocs.length === 0 ? (
                <div className="flex flex-col items-center py-6 gap-1.5">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="8" stroke="#d1d5db" strokeWidth="1.5" />
                    <path d="M6.5 10l2.5 2.5 4.5-4.5" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <p className="text-xs text-gray-400">No documents expiring in 90 days</p>
                </div>
              ) : (
                <div className="divide-y divide-surface-border">
                  {expiringDocs.map(doc => {
                    const days = daysUntil(doc.expiryDate!);
                    const urgency = days <= 14
                      ? "text-red-600 bg-red-50 border-red-100"
                      : days <= 30
                        ? "text-amber-600 bg-amber-50 border-amber-100"
                        : "text-gray-500 bg-surface-inset border-gray-100";
                    return (
                      <Link key={doc.id} href={`/records/${doc.id}`}
                        className="flex items-center gap-3 py-2.5 -mx-5 px-5 hover:bg-surface-hover transition-colors">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full border shrink-0 ${urgency}`}>
                          {days}d
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">{doc.filename}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {DOC_TYPE_LABEL[doc.docType ?? ""] ?? doc.docType}
                            {" · "}
                            {doc.expiryDate?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-gray-300 shrink-0">
                          <path d="M4.5 2.5l3 3.5-3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pending claims */}
            <div className="bg-white border border-surface-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Pending approvals</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {pendingClaims.length} claim{pendingClaims.length !== 1 ? "s" : ""} · {fmtUSD(pendingClaimsUsd)} total
                  </p>
                </div>
                <Link href="/expenses" className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors">
                  Review →
                </Link>
              </div>
              {pendingClaims.length === 0 ? (
                <div className="flex flex-col items-center py-6 gap-1.5">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="8" stroke="#d1d5db" strokeWidth="1.5" />
                    <path d="M6.5 10l2.5 2.5 4.5-4.5" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <p className="text-xs text-gray-400">No pending expense claims</p>
                </div>
              ) : (
                <div className="divide-y divide-surface-border">
                  {pendingClaims.map(c => (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <div className="w-7 h-7 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-teal-600">
                          {(c.person?.name ?? "?").split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{c.name}</p>
                        <p className="text-[10px] text-gray-400">
                          {c.person?.name ?? "Unknown"} · {c.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-teal-700 tabular-nums shrink-0">
                        {c.currency} {c.amount!.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
