import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateTime, fmtDays } from "@/lib/format-date";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import SidebarWrapper from "../../components/SidebarWrapper";
import TopBar from "../../components/TopBar";
import DeletePersonButton from "../DeletePersonButton";
import ActivityTimeline from "../../components/ActivityTimeline";
import EditPersonModal from "../../components/EditPersonModal";
import PersonRatesCard from "../../components/PersonRatesCard";
import Money from "../../components/Money";
import GenerateContractModal from "../../components/GenerateContractModal";
import PayslipCurrencyToggle from "../../components/PayslipCurrencyToggle";
import SyncPayrollFromScheduleButton from "../../components/SyncPayrollFromScheduleButton";

async function getUsdRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 86400 },
    });
    const data = await res.json();
    return data.rates ?? {};
  } catch {
    return { EGP: 50, AED: 3.67, EUR: 0.92 };
  }
}

function toUSD(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  if (!rate) return amount;
  return amount / rate;
}

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

type SalaryComponent = { name: string; amount: number };

function parseSalaryComponents(json: string | null | undefined): SalaryComponent[] {
  if (!json) return [];
  try { return JSON.parse(json) as SalaryComponent[]; } catch { return []; }
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [person, rates, contractTemplates, personExpenses] = await Promise.all([
    prisma.person.findUnique({
      where: { id },
      include: {
        document: {
          select: {
            id: true,
            docType: true,
            filename: true,
            parties: true,
            issueDate: true,
            renewalDeadline: true,
          },
        },
        payrollEntries: {
          orderBy: [
            { payrollRun: { year: "asc" } },
            { payrollRun: { month: "asc" } },
          ],
          include: {
            payrollRun: {
              select: { id: true, period: true, month: true, year: true, createdAt: true },
            },
          },
        },
      },
    }),
    getUsdRates(),
    prisma.contractTemplate.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } }),
    prisma.expense.findMany({
      where: { personId: id, amount: { not: null }, claimStatus: { not: "rejected" } },
      select: { id: true, name: true, amount: true, currency: true, expenseType: true, dueOn: true, asanaCreatedAt: true },
      orderBy: { asanaCreatedAt: "desc" },
    }),
  ]);

  if (!person) notFound();

  // Build expense claims map keyed by YYYY-MM
  const expensesByMonth = new Map<string, typeof personExpenses>();
  for (const e of personExpenses) {
    const eDate = e.dueOn ?? e.asanaCreatedAt;
    if (!eDate) continue;
    const key = `${eDate.getFullYear()}-${String(eDate.getMonth() + 1).padStart(2, "0")}`;
    if (!expensesByMonth.has(key)) expensesByMonth.set(key, []);
    expensesByMonth.get(key)!.push(e);
  }

  const session = await auth();
  const canWrite = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null).people === "write";

  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const sortedEntries = [...person.payrollEntries].sort((a, b) => {
    const yearDiff = (a.payrollRun.year ?? 0) - (b.payrollRun.year ?? 0);
    if (yearDiff !== 0) return yearDiff;
    return (a.payrollRun.month ?? 0) - (b.payrollRun.month ?? 0);
  });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear  = now.getFullYear();

  const currentEntry = sortedEntries.find(
    e => e.payrollRun.month === currentMonth && e.payrollRun.year === currentYear
  ) ?? null;
  const latestEntry = sortedEntries.at(-1) ?? null;
  const activeEntry = currentEntry ?? latestEntry;

  const displaySalary = activeEntry
    ? {
        amount: activeEntry.salary,
        currency: activeEntry.currency,
        source: "payroll" as const,
        isCurrent: !!currentEntry,
        label: activeEntry.payrollRun.month && activeEntry.payrollRun.year
          ? `Salary as per ${MONTH_NAMES[activeEntry.payrollRun.month]} ${activeEntry.payrollRun.year} Payroll`
          : activeEntry.payrollRun.period || "payroll",
      }
    : person.salary != null
    ? { amount: person.salary, currency: person.salaryCurrency ?? "AED", source: "contract" as const, isCurrent: false, label: "from contract" }
    : null;

  // Detect upcoming salary change from a future contract
  const upcomingSalary =
    person.contractStart && person.contractStart > now &&
    person.salary != null &&
    activeEntry &&
    Math.abs(person.salary - activeEntry.salary) > 0.001
      ? {
          amount: person.salary,
          currency: person.salaryCurrency ?? "AED",
          components: parseSalaryComponents(person.salaryComponents),
          from: person.contractStart,
        }
      : null;

  // Renewal alarm logic
  const daysToEnd = person.contractEnd ? daysUntil(person.contractEnd) : null;
  const renewalDeadline = person.document?.renewalDeadline
    ?? (person.contractEnd ? new Date(person.contractEnd.getTime() - 90 * 86400000) : null);
  const daysToRenewal = renewalDeadline ? daysUntil(renewalDeadline) : null;

  const showAlarm = daysToEnd !== null && daysToEnd <= 90;
  const alarmExpired = daysToEnd !== null && daysToEnd < 0;

  // Day after contract end — pre-filled as the new contract's start date for renewal
  const renewalStartDate = person.contractEnd
    ? (() => {
        const d = new Date(person.contractEnd);
        d.setDate(d.getDate() + 1);
        return d.toISOString().split("T")[0];
      })()
    : null;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "People", href: "/people" }, { label: person.name }]} />

        <main className="px-8 py-6">
          <div className="flex gap-6 items-start max-w-6xl">

          {/* Left column */}
          <div className="flex-1 min-w-0">

          {/* Back + Actions */}
          <div className="mb-4 flex items-center justify-between">
            <Link
              href="/people"
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to People
            </Link>
            <div className="flex items-center gap-2">
              <EditPersonModal
                hidden={!canWrite}
                person={{
                  id: person.id,
                  name: person.name,
                  jobTitle: person.jobTitle ?? null,
                  department: person.department ?? null,
                  nationality: person.nationality ?? null,
                  email: person.email ?? null,
                  contractStart: person.contractStart?.toISOString().split("T")[0] ?? null,
                  contractEnd: person.contractEnd?.toISOString().split("T")[0] ?? null,
                  salary: person.salary ?? null,
                  salaryCurrency: person.salaryCurrency ?? null,
                  costPerHour: person.costPerHour ?? null,
                  billingRate: person.billingRate ?? null,
                  rateCurrency: person.rateCurrency ?? null,
                  employmentType: person.employmentType ?? "fulltime",
                  weeklyHours: person.weeklyHours ?? 40,
                }}
              />
              {canWrite && (
                <DeletePersonButton
                  personId={person.id}
                  personName={person.name}
                  redirectTo="/people"
                />
              )}
            </div>
          </div>

          {/* Renewal alarm banner */}
          {showAlarm && (
            <div className={`mb-5 rounded-xl border px-5 py-4 flex items-start gap-4 ${
              alarmExpired
                ? "bg-red-50 border-red-200"
                : daysToEnd! <= 30
                ? "bg-red-50 border-red-200"
                : "bg-amber-50 border-amber-200"
            }`}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                alarmExpired || daysToEnd! <= 30 ? "bg-red-100" : "bg-amber-100"
              }`}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.5L1.5 12.5h13L8 1.5z" stroke={alarmExpired || daysToEnd! <= 30 ? "#dc2626" : "#d97706"} strokeWidth="1.4" fill="none" strokeLinejoin="round" />
                  <path d="M8 6v3.5M8 11v.5" stroke={alarmExpired || daysToEnd! <= 30 ? "#dc2626" : "#d97706"} strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${alarmExpired || daysToEnd! <= 30 ? "text-red-800" : "text-amber-800"}`}>
                  {alarmExpired
                    ? `Contract expired ${Math.abs(daysToEnd!)} days ago`
                    : `Contract expires in ${daysToEnd} day${daysToEnd !== 1 ? "s" : ""}`}
                </p>
                <p className={`text-xs mt-0.5 ${alarmExpired || daysToEnd! <= 30 ? "text-red-600" : "text-amber-600"}`}>
                  {alarmExpired
                    ? "Renewal is overdue — action required immediately."
                    : renewalDeadline
                    ? `Renewal notice due by ${renewalDeadline.toISOString().split("T")[0]}${daysToRenewal !== null && daysToRenewal <= 0 ? " (overdue)" : daysToRenewal !== null ? ` · in ${daysToRenewal} days` : ""}`
                    : "Start the renewal process now to avoid disruption."}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canWrite && contractTemplates.length > 0 && renewalStartDate && (
                  <GenerateContractModal
                    person={{
                      id: person.id,
                      name: person.name,
                      existingDocumentId: person.document?.id ?? null,
                      jobTitle: person.jobTitle,
                      department: person.department,
                      nationality: person.nationality,
                      contractStart: person.contractStart?.toISOString() ?? null,
                      contractEnd: person.contractEnd?.toISOString() ?? null,
                      salary: person.salary,
                      salaryCurrency: person.salaryCurrency,
                      salaryComponents: person.salaryComponents,
                      renewalStartDate,
                    }}
                    templates={contractTemplates.map((tpl) => ({
                      id: tpl.id,
                      name: tpl.name,
                      placeholders: tpl.placeholders ? JSON.parse(tpl.placeholders) : [],
                    }))}
                  />
                )}
                {person.document && (
                  <Link
                    href={`/records/${person.document.id}`}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                      alarmExpired || daysToEnd! <= 30
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "bg-amber-500 text-white hover:bg-amber-600"
                    }`}
                  >
                    View contract →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Header card */}
          <div className="bg-white border border-surface-border rounded-xl p-6 mb-5">
            <div className="flex items-start gap-5">
              <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                <span className="text-xl font-bold text-indigo-600">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-gray-900">{person.name}</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  {person.jobTitle ?? <span className="text-gray-300">No title</span>}
                  {person.department && <span className="text-gray-400"> · {person.department}</span>}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {person.nationality && (
                    <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {person.nationality}
                    </span>
                  )}
                  {person.email && (
                    <a
                      href={`mailto:${person.email}`}
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
                    >
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" className="shrink-0">
                        <rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                        <path d="M1 4l6 4 6-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      </svg>
                      {person.email}
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Info cards row */}
          <div className="grid grid-cols-3 gap-4 mb-5">

            {/* Contract dates card */}
            <div className={`bg-white border rounded-xl p-5 col-span-1 ${showAlarm ? (alarmExpired || daysToEnd! <= 30 ? "border-red-200" : "border-amber-200") : "border-surface-border"}`}>
              <div className="flex items-center gap-2 mb-4">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${showAlarm ? (alarmExpired || daysToEnd! <= 30 ? "bg-red-100" : "bg-amber-100") : "bg-emerald-50"}`}>
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="2" width="12" height="11" rx="1.5" stroke={showAlarm ? (alarmExpired || daysToEnd! <= 30 ? "#dc2626" : "#d97706") : "#059669"} strokeWidth="1.3" fill="none" />
                    <path d="M4 1v2M10 1v2M1 5h12" stroke={showAlarm ? (alarmExpired || daysToEnd! <= 30 ? "#dc2626" : "#d97706") : "#059669"} strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Contract period</span>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Start date</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {person.contractStart
                      ? person.contractStart.toISOString().split("T")[0]
                      : <span className="text-gray-300">—</span>}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">End date</p>
                  {person.contractEnd ? (
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {person.contractEnd.toISOString().split("T")[0]}
                      </p>
                      {(() => {
                        const d = daysUntil(person.contractEnd!);
                        const cls = d < 0 ? "text-red-600 bg-red-50" : d <= 30 ? "text-red-600 bg-red-50" : d <= 90 ? "text-amber-600 bg-amber-50" : "text-green-700 bg-green-50";
                        return (
                          <span className={`inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>
                            {d < 0 ? `Expired ${fmtDays(Math.abs(d))} ago` : `${fmtDays(d)} remaining`}
                          </span>
                        );
                      })()}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-300">—</p>
                  )}
                </div>
              </div>
            </div>

            {/* Current salary card */}
            <div className="bg-white border border-surface-border rounded-xl p-5 col-span-1">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-indigo-50 flex items-center justify-center shrink-0">
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="5.5" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                      <path d="M7 4.5v1m0 3v1m-1.5-3h2.5a1 1 0 0 1 0 2H5.5a1 1 0 0 0 0 2H8" stroke="#4f46e5" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Current salary</span>
                </div>
                {displaySalary?.isCurrent && (
                  <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                    This month
                  </span>
                )}
                {displaySalary && !displaySalary.isCurrent && displaySalary.source === "payroll" && (
                  <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                    No run yet
                  </span>
                )}
              </div>

              {displaySalary ? (
                (() => {
                  // Two-section view: current payroll vs upcoming contract salary
                  if (upcomingSalary) {
                    return (
                      <>
                        {/* Current payroll amount */}
                        <Money
                          amount={displaySalary.amount}
                          currency={displaySalary.currency}
                          rates={rates}
                          size="lg"
                          align="left"
                        />
                        <p className="text-xs text-gray-400 mt-1 mb-3 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                          {displaySalary.label}
                        </p>

                        {/* Divider — upcoming contract */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-px flex-1 bg-surface-border" />
                          <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider whitespace-nowrap">
                            From {upcomingSalary.from.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          <div className="h-px flex-1 bg-surface-border" />
                        </div>

                        {/* Upcoming salary breakdown */}
                        {upcomingSalary.components.length > 1 ? (
                          <div className="space-y-1">
                            {upcomingSalary.components.map((c, i) => (
                              <div key={i} className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-gray-400 truncate">{c.name}</span>
                                <span className="text-[11px] font-semibold text-gray-700 tabular-nums shrink-0">
                                  {upcomingSalary.currency} {c.amount.toLocaleString()}
                                </span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between gap-2 border-t border-surface-border pt-1 mt-1">
                              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Total</span>
                              <span className="text-[11px] font-bold text-indigo-700 tabular-nums">
                                {upcomingSalary.currency} {upcomingSalary.amount.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <Money amount={upcomingSalary.amount} currency={upcomingSalary.currency} rates={rates} size="sm" align="left" />
                        )}
                      </>
                    );
                  }

                  // Single-section: current salary (from payroll entry or contract)
                  const components = parseSalaryComponents(
                    activeEntry?.salaryComponents ?? person.salaryComponents
                  );
                  return (
                    <>
                      {components.length > 1 ? (
                        <div className="space-y-1 mb-2">
                          {components.map((c, i) => (
                            <div key={i} className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-gray-400 truncate">{c.name}</span>
                              <span className="text-[11px] font-semibold text-gray-700 tabular-nums shrink-0">
                                {displaySalary.currency} {c.amount.toLocaleString()}
                              </span>
                            </div>
                          ))}
                          <div className="flex items-center justify-between gap-2 border-t border-surface-border pt-1 mt-1">
                            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Total</span>
                            <span className="text-[11px] font-bold text-gray-900 tabular-nums">
                              {displaySalary.currency} {displaySalary.amount.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <Money
                          amount={displaySalary.amount}
                          currency={displaySalary.currency}
                          rates={rates}
                          size="lg"
                          align="left"
                        />
                      )}
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        {displaySalary.source === "payroll" ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                            {displaySalary.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                            {displaySalary.label}
                          </span>
                        )}
                      </p>
                    </>
                  );
                })()
              ) : (
                <p className="text-2xl font-bold text-gray-300">—</p>
              )}

              {/* Payslip currency preference — only for non-USD contract currencies */}
              {canWrite && displaySalary && displaySalary.currency !== "USD" && (
                <PayslipCurrencyToggle
                  personId={person.id}
                  currency={displaySalary.currency}
                  initialValue={person.payslipInContractCurrency}
                />
              )}
            </div>

            {/* Contract document card */}
            <div className="bg-white border border-surface-border rounded-xl p-5 col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 1.5h6.5l3 3v8a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5z" stroke="#059669" strokeWidth="1.3" fill="none" />
                    <path d="M4.5 6h5M4.5 8h4M4.5 10h2.5" stroke="#059669" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Contract doc</span>
              </div>

              {person.document ? (
                <Link
                  href={`/records/${person.document.id}`}
                  className="group block"
                >
                  <p className="text-sm font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors leading-snug truncate">
                    {person.document.filename}
                  </p>
                  {person.document.issueDate && (
                    <p className="text-xs text-gray-400 mt-1">
                      Issued {person.document.issueDate.toISOString().split("T")[0]}
                    </p>
                  )}
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 group-hover:text-indigo-800 transition-colors">
                    View contract
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5h6M5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </Link>
              ) : (
                <p className="text-sm text-gray-300">No contract linked</p>
              )}

              {/* Generate from template */}
              {canWrite && contractTemplates.length > 0 && (
                <div className={`${person.document ? "mt-4 pt-4 border-t border-surface-border" : "mt-2"}`}>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Generate from template</p>
                  <GenerateContractModal
                    person={{
                      id: person.id,
                      name: person.name,
                      existingDocumentId: person.document?.id ?? null,
                      jobTitle: person.jobTitle,
                      department: person.department,
                      nationality: person.nationality,
                      contractStart: person.contractStart?.toISOString() ?? null,
                      contractEnd: person.contractEnd?.toISOString() ?? null,
                      salary: person.salary,
                      salaryCurrency: person.salaryCurrency,
                      salaryComponents: person.salaryComponents,
                    }}
                    templates={contractTemplates.map((tpl) => ({
                      id: tpl.id,
                      name: tpl.name,
                      placeholders: tpl.placeholders ? JSON.parse(tpl.placeholders) : [],
                    }))}
                  />
                </div>
              )}
            </div>
          </div>

          <PersonRatesCard
            personId={person.id}
            costPerHour={person.costPerHour ?? null}
            billingRate={person.billingRate ?? null}
            rateCurrency={person.rateCurrency ?? null}
            canWrite={canWrite}
          />

          {/* Payment history */}
          {(() => {
            const now = new Date();
            const defaultCurrency = sortedEntries[0]?.currency ?? "AED";
            const isMultiCurrency = sortedEntries.some(e => e.currency !== defaultCurrency);
            const totalRemaining = isMultiCurrency ? null : sortedEntries.filter(e => !e.isPaid).reduce((s, e) => s + e.salary, 0);
            const totalPaid      = isMultiCurrency ? null : sortedEntries.filter(e => e.isPaid).reduce((s, e) => s + e.salary, 0);

            const withMeta = sortedEntries.map((entry, i) => {
              const d = entry.payrollRun.month && entry.payrollRun.year
                ? new Date(entry.payrollRun.year, entry.payrollRun.month, 0)
                : null;
              const daysLeft  = d ? Math.ceil((d.getTime() - now.getTime()) / 86400000) : null;
              const isOverdue = !entry.isPaid && daysLeft !== null && daysLeft < 0;
              const isDueSoon = !entry.isPaid && daysLeft !== null && daysLeft >= 0 && daysLeft <= 14;
              const isLatest  = i === 0;
              return { entry, d, daysLeft, isOverdue, isDueSoon, isLatest };
            });

            const overdueCount  = withMeta.filter(m => m.isOverdue).length;
            const upcomingCount = withMeta.filter(m => !m.entry.isPaid && !m.isOverdue).length;
            const paidCount     = withMeta.filter(m => m.entry.isPaid).length;

            // Group by year (asc)
            const yearMap = new Map<number, typeof withMeta>();
            for (const m of withMeta) {
              const yr = m.entry.payrollRun.year ?? 0;
              if (!yearMap.has(yr)) yearMap.set(yr, []);
              yearMap.get(yr)!.push(m);
            }
            const years = Array.from(yearMap.entries()).sort((a, b) => a[0] - b[0]);

            return (
              <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-indigo-50 flex items-center justify-center shrink-0">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="6" stroke="#4f46e5" strokeWidth="1.3" fill="none" />
                        <path d="M8 5v2.5m0 3V12m-2-3.5h3.5a1 1 0 0 0 0-2H7a1 1 0 0 1 0-2H10" stroke="#4f46e5" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <h2 className="text-sm font-semibold text-gray-900">Payroll history</h2>
                    <span className="text-xs text-gray-400 bg-surface-inset px-2 py-0.5 rounded-full">
                      {sortedEntries.length} {sortedEntries.length === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    {canWrite && person.document?.docType === "employee_contract" && (
                      <SyncPayrollFromScheduleButton personId={person.id} />
                    )}
                    {!isMultiCurrency && (totalRemaining! > 0 || totalPaid! > 0) && (
                      <div className="text-right">
                        {totalRemaining! > 0 && (
                          <p className="text-xs font-semibold text-gray-900">{defaultCurrency} {totalRemaining!.toLocaleString()} remaining</p>
                        )}
                        {totalPaid! > 0 && (
                          <p className="text-xs text-gray-400">{defaultCurrency} {totalPaid!.toLocaleString()} paid</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Status chips */}
                {sortedEntries.length > 0 && (
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
                )}

                {sortedEntries.length === 0 ? (
                  <div className="p-12 flex flex-col items-center gap-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <circle cx="10" cy="10" r="8" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                        <path d="M10 6v2.5m0 3V14m-2.5-3.5h3.5a1.2 1.2 0 0 0 0-2.4H9a1.2 1.2 0 0 1 0-2.4h3" stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-600">No payroll entries yet</p>
                    <p className="text-xs text-gray-400">This person hasn&apos;t appeared in any payroll run.</p>
                  </div>
                ) : (
                  years.map(([yr, items]) => (
                    <div key={yr}>
                      <div className="px-5 py-2 bg-surface-inset border-b border-surface-border">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{yr || "—"}</span>
                      </div>
                      <div className="divide-y divide-surface-border">
                        {items.map(({ entry, d, daysLeft, isOverdue, isDueSoon, isLatest }) => {
                          const periodLabel = entry.payrollRun.period ||
                            (entry.payrollRun.month && entry.payrollRun.year
                              ? `${MONTH_NAMES[entry.payrollRun.month]} ${entry.payrollRun.year}`
                              : "—");
                          return (
                            <div
                              key={entry.id}
                              className={`flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-hover ${entry.isPaid ? "opacity-60" : isOverdue ? "bg-red-50/20" : isDueSoon ? "bg-amber-50/20" : ""}`}
                            >
                              {/* Read-only status — paid/unpaid is managed from the payroll run page */}
                              <div className="shrink-0" title={entry.isPaid ? "Paid" : "Unpaid"}>
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                  entry.isPaid ? "bg-green-500 border-green-500" : "border-gray-200 bg-white"
                                }`}>
                                  {entry.isPaid && (
                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                      <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  )}
                                </div>
                              </div>

                              {/* Date block */}
                              {d ? (
                                <div className="w-10 text-center shrink-0">
                                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">{MONTHS_SHORT[d.getMonth()]}</p>
                                  <p className="text-lg font-bold text-gray-900 leading-tight">{d.getDate()}</p>
                                  <p className="text-[9px] text-gray-400">{d.getFullYear()}</p>
                                </div>
                              ) : (
                                <div className="w-10 shrink-0" />
                              )}

                              {/* Description + status */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Link
                                    href={`/payroll?month=${entry.payrollRun.month}&year=${entry.payrollRun.year}`}
                                    className={`text-sm font-medium hover:text-indigo-600 transition-colors ${entry.isPaid ? "line-through text-gray-400" : "text-gray-800"}`}
                                  >
                                    {periodLabel}
                                  </Link>
                                  {isLatest && !entry.isPaid && (
                                    <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Latest</span>
                                  )}
                                </div>
                                {entry.isPaid ? (
                                  <p className="text-xs text-green-600 mt-0.5">Paid</p>
                                ) : isOverdue ? (
                                  <p className="text-xs text-red-500 font-medium mt-0.5">{fmtDays(Math.abs(daysLeft!))} overdue</p>
                                ) : isDueSoon ? (
                                  <p className="text-xs text-amber-600 mt-0.5">{daysLeft === 0 ? "Due today" : `in ${fmtDays(daysLeft!)}`}</p>
                                ) : (
                                  <p className="text-xs text-gray-400 mt-0.5">Upcoming</p>
                                )}
                              </div>

                              {/* Amount + breakdown */}
                              <div className="shrink-0 text-right min-w-[130px]">
                                {(() => {
                                  const comps = parseSalaryComponents(entry.salaryComponents);
                                  const monthKey = entry.payrollRun.month && entry.payrollRun.year
                                    ? `${entry.payrollRun.year}-${String(entry.payrollRun.month).padStart(2, "0")}`
                                    : null;
                                  const claims = monthKey ? (expensesByMonth.get(monthKey) ?? []) : [];
                                  const salaryUsd = toUSD(entry.salary, entry.currency, rates);
                                  const claimsUsd = claims.reduce((s, c) => s + toUSD(c.amount!, c.currency, rates), 0);
                                  const hasClaims = claims.length > 0;
                                  return (
                                    <div className="space-y-0.5">
                                      {comps.length > 1 ? (
                                        <>
                                          {comps.map((c, i) => (
                                            <div key={i} className="flex items-center justify-end gap-2">
                                              <span className={`text-[10px] ${entry.isPaid ? "text-gray-300" : "text-gray-400"} truncate max-w-[100px]`}>{c.name}</span>
                                              <span className={`text-[10px] font-semibold tabular-nums ${entry.isPaid ? "text-gray-300" : "text-gray-600"}`}>
                                                {entry.currency} {c.amount.toLocaleString()}
                                              </span>
                                            </div>
                                          ))}
                                          <div className={`flex items-center justify-end gap-1 border-t border-surface-border pt-0.5 ${entry.isPaid ? "opacity-40" : ""}`}>
                                            <span className="text-[10px] font-bold text-gray-400">{hasClaims ? "Salary" : "Total"}</span>
                                            <span className="text-xs font-bold text-gray-900 tabular-nums">{entry.currency} {entry.salary.toLocaleString()}</span>
                                          </div>
                                        </>
                                      ) : (
                                        <Money
                                          amount={entry.salary}
                                          currency={entry.currency}
                                          rates={rates}
                                          size="sm"
                                          muted={entry.isPaid}
                                        />
                                      )}
                                      {hasClaims && (
                                        <>
                                          <div className="border-t border-surface-border pt-0.5 mt-0.5">
                                            {claims.map((c) => (
                                              <div key={c.id} className="flex items-center justify-end gap-1.5 mt-0.5">
                                                <span className="text-[10px] text-teal-600 truncate max-w-[90px]" title={c.name}>{c.name}</span>
                                                <span className="text-[10px] font-medium tabular-nums text-teal-700">
                                                  +USD {toUSD(c.amount!, c.currency, rates).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                          <div className="flex items-center justify-end gap-1 border-t border-teal-100 pt-0.5">
                                            <span className="text-[10px] font-bold text-gray-500">Total to pay</span>
                                            <span className="text-sm font-bold tabular-nums text-gray-900">
                                              USD {(salaryUsd + claimsUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </span>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })()}

          </div>{/* end left column */}

          {/* Right column — activity timeline */}
          <div className="w-96 shrink-0 sticky top-12 self-start">
            <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-border">
                <h2 className="text-sm font-semibold text-gray-900">Activity</h2>
              </div>
              <ActivityTimeline entityId={person.id} />
            </div>
          </div>

          </div>{/* end flex row */}
        </main>
      </div>
    </div>
  );
}
