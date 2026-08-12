import { prisma } from "@/lib/prisma";
import { getUsdRates, toUSD } from "@/lib/fx";
import { fmtDays } from "@/lib/format-date";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import DeletePersonButton from "./DeletePersonButton";
import AddPersonModal from "../components/AddPersonModal";
import Money from "../components/Money";
import Link from "next/link";
import SearchInput from "../components/SearchInput";
import GenerateContractModal from "../components/GenerateContractModal";
import ExitEmployeeModal from "../components/ExitEmployeeModal";
import PayrollOnlyRow from "../components/PayrollOnlyRow";

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function ContractStatusChip({ date }: { date: Date }) {
  const days = daysUntil(date);
  const label = date.toISOString().split("T")[0];

  let chipClass = "text-green-700 bg-green-50";
  let dayLabel = `${fmtDays(days)} left`;
  if (days < 0) {
    chipClass = "text-red-700 bg-red-50";
    dayLabel = `Expired ${fmtDays(Math.abs(days))} ago`;
  } else if (days <= 90) {
    chipClass = "text-red-700 bg-red-50";
    dayLabel = `${fmtDays(days)} left`;
  } else if (days <= 180) {
    chipClass = "text-amber-700 bg-amber-50";
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-700 text-sm">{label}</span>
      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full w-fit ${chipClass}`}>
        {dayLabel}
      </span>
    </div>
  );
}

function ExitStatusChip({ exitDate }: { exitDate: Date }) {
  const isPast = exitDate < new Date();
  const label = exitDate.toISOString().split("T")[0];
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-fit leading-none mt-0.5 ${
      isPast
        ? "bg-gray-100 text-gray-500"
        : "bg-amber-50 text-amber-600 border border-amber-200"
    }`}>
      {isPast ? `Exited ${label}` : `Exiting ${label}`}
    </span>
  );
}

function SortHeader({
  label, field, sort, dir, q, align = "left",
}: {
  label: string; field: string; sort: string; dir: string; q: string; align?: "left" | "right";
}) {
  const isActive = sort === field;
  const nextDir  = isActive && dir === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams({ sort: field, dir: nextDir, ...(q ? { q } : {}) });

  return (
    <Link
      href={`?${qs}`}
      className={`flex items-center gap-1 group select-none ${align === "right" ? "justify-end" : ""}`}
    >
      <span className={`text-[11px] font-medium uppercase tracking-wide transition-colors ${isActive ? "text-gray-700" : "text-gray-400 group-hover:text-gray-600"}`}>
        {label}
      </span>
      <span className="flex flex-col gap-[1px]">
        <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
          <path d="M3.5 0L7 5H0L3.5 0Z" fill={isActive && dir === "asc" ? "#374151" : "#cbd5e1"} />
        </svg>
        <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
          <path d="M3.5 5L0 0H7L3.5 5Z" fill={isActive && dir === "desc" ? "#374151" : "#cbd5e1"} />
        </svg>
      </span>
    </Link>
  );
}

function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.toLowerCase();
  return fields.some(f => f?.toLowerCase().includes(needle));
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string }>;
}) {
  const { q = "", sort = "", dir = "asc" } = await searchParams;
  const sortDir = dir === "desc" ? "desc" : "asc";

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear  = now.getFullYear();

  const session = await auth();
  const canWrite = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null).people === "write";

  const [people, currentMonthEntries, payrollEntriesRaw, rates, activeTemplates] = await Promise.all([
    prisma.person.findMany({
      orderBy: { createdAt: "desc" },
      include: { document: { select: { id: true } } },
    }),
    prisma.payrollEntry.findMany({
      where: {
        personId: { not: null },
        payrollRun: { month: currentMonth, year: currentYear },
      },
      select: { personId: true, salary: true, currency: true },
    }),
    prisma.payrollEntry.findMany({
      where: { personId: null },
      select: {
        employeeName: true, salary: true, currency: true,
        payrollRun: { select: { month: true, year: true } },
      },
      orderBy: [{ payrollRun: { year: "desc" } }, { payrollRun: { month: "desc" } }],
    }),
    getUsdRates(),
    prisma.contractTemplate.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } }),
  ]);

  const currentSalaryMap = new Map<string, { salary: number; currency: string }>();
  for (const e of currentMonthEntries) {
    if (e.personId) currentSalaryMap.set(e.personId, { salary: e.salary, currency: e.currency });
  }

  const personNames = new Set(people.map((p) => p.name.toLowerCase()));
  const payrollOnlyMap = new Map<string, { name: string; salary: number | null; currency: string | null }>();
  for (const entry of payrollEntriesRaw) {
    const key = entry.employeeName.toLowerCase();
    if (!payrollOnlyMap.has(key) && !personNames.has(key)) {
      payrollOnlyMap.set(key, { name: entry.employeeName, salary: entry.salary, currency: entry.currency });
    }
  }
  const payrollOnly = Array.from(payrollOnlyMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  const filteredPeople = (q
    ? people.filter((p) => matchesQuery(q, p.name, p.jobTitle, p.department, p.nationality))
    : [...people]
  );

  // Sort filteredPeople
  if (sort === "contractStart") {
    filteredPeople.sort((a, b) => {
      if (!a.contractStart && !b.contractStart) return 0;
      if (!a.contractStart) return 1;
      if (!b.contractStart) return -1;
      const diff = a.contractStart.getTime() - b.contractStart.getTime();
      return sortDir === "asc" ? diff : -diff;
    });
  } else if (sort === "contractEnd") {
    filteredPeople.sort((a, b) => {
      if (!a.contractEnd && !b.contractEnd) return 0;
      if (!a.contractEnd) return 1;
      if (!b.contractEnd) return -1;
      const diff = a.contractEnd.getTime() - b.contractEnd.getTime();
      return sortDir === "asc" ? diff : -diff;
    });
  } else if (sort === "salary") {
    filteredPeople.sort((a, b) => {
      const sA = currentSalaryMap.get(a.id) ?? (a.salary != null ? { salary: a.salary, currency: a.salaryCurrency ?? "AED" } : null);
      const sB = currentSalaryMap.get(b.id) ?? (b.salary != null ? { salary: b.salary, currency: b.salaryCurrency ?? "AED" } : null);
      const uA = sA ? toUSD(sA.salary, sA.currency, rates) : -1;
      const uB = sB ? toUSD(sB.salary, sB.currency, rates) : -1;
      return sortDir === "asc" ? uA - uB : uB - uA;
    });
  }

  const filteredPayrollOnly = q
    ? payrollOnly.filter((e) => matchesQuery(q, e.name))
    : payrollOnly;

  const expiringSoon = people.filter(
    (p) => p.contractEnd && daysUntil(p.contractEnd) >= 0 && daysUntil(p.contractEnd) <= 90
  ).length;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "People" }]} />

        <main className="px-4 sm:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">People</h1>
              <p className="text-sm text-gray-500 mt-1">
                Employee records auto-created from uploaded contracts.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <AddPersonModal hidden={!canWrite} />
              {canWrite && (
                <Link
                  href="/"
                  className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 2v6M4 5l3-3 3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 11h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Upload contract
                </Link>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-surface-border rounded-xl p-4">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Total employees</p>
              <p className="text-3xl font-bold text-gray-900">{people.length + payrollOnly.length}</p>
            </div>
            <div className={`border rounded-xl p-4 ${expiringSoon > 0 ? "bg-red-50 border-red-100" : "bg-white border-surface-border"}`}>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Contracts expiring ≤90 days</p>
              <p className={`text-3xl font-bold ${expiringSoon > 0 ? "text-red-600" : "text-gray-900"}`}>{expiringSoon}</p>
            </div>
            <div className="bg-white border border-surface-border rounded-xl p-4">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Active contracts</p>
              <p className="text-3xl font-bold text-gray-900">
                {people.filter((p) => !p.exitDate || p.exitDate >= now).filter((p) => !p.contractEnd || daysUntil(p.contractEnd) >= 0).length}
              </p>
            </div>
          </div>

          <div className="mb-4">
            <SearchInput value={q} placeholder="Search people…" />
          </div>

          {filteredPeople.length === 0 && filteredPayrollOnly.length === 0 ? (
            <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="9" cy="7" r="4" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                  <path d="M2 21c0-4 3-7 7-7s7 3 7 7" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                  <path d="M16 11c2.2.7 4 2.8 4 5" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                  <circle cx="16" cy="6" r="3" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">No employee records yet</p>
              <p className="text-sm text-gray-400">
                Upload an employee contract or add an employee manually.
              </p>
              <div className="flex items-center gap-3 mt-2">
                <AddPersonModal hidden={!canWrite} />
                {canWrite && (
                  <Link href="/" className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
                    Upload a contract →
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-inset">
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Employee</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Job title</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Department</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Nationality</th>
                    <th className="text-left px-5 py-3">
                      <SortHeader label="Contract start" field="contractStart" sort={sort} dir={sortDir} q={q} />
                    </th>
                    <th className="text-left px-5 py-3">
                      <SortHeader label="Contract end" field="contractEnd" sort={sort} dir={sortDir} q={q} />
                    </th>
                    <th className="text-right px-5 py-3">
                      <SortHeader label="Salary" field="salary" sort={sort} dir={sortDir} q={q} align="right" />
                    </th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Contract</th>
                    <th className="px-5 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {filteredPeople.map((person) => {
                    const isExited = person.exitDate && person.exitDate < now;
                    const isExpiringSoon = !isExited && person.contractEnd && daysUntil(person.contractEnd) >= 0 && daysUntil(person.contractEnd) <= 90;
                    const isExpired = !isExited && person.contractEnd && daysUntil(person.contractEnd) < 0;
                    return (
                      <tr
                        key={person.id}
                        className={`transition-colors cursor-pointer ${
                          isExited ? "bg-gray-50 hover:bg-surface-hover opacity-70 hover:opacity-100" :
                          isExpiringSoon ? "bg-red-50/40 hover:bg-red-50/60" :
                          isExpired ? "bg-surface-inset hover:bg-surface-hover" :
                          "hover:bg-surface-hover"
                        }`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isExited ? "bg-gray-100" : "bg-gray-200"}`}>
                              <span className={`text-xs font-bold ${isExited ? "text-gray-400" : "text-gray-600"}`}>
                                {person.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <Link
                                  href={"/people/" + person.id}
                                  className="font-medium text-gray-900 hover:text-gray-600 transition-colors"
                                >
                                  {person.name}
                                </Link>
                                {person.employmentType === "parttime" ? (
                                  <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full leading-none">
                                    PT · {person.weeklyHours ?? 20}h/wk
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-full leading-none">
                                    FT
                                  </span>
                                )}
                              </div>
                              {person.exitDate && <ExitStatusChip exitDate={person.exitDate} />}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {person.jobTitle ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {person.department ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {person.nationality ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {person.contractStart
                            ? person.contractStart.toISOString().split("T")[0]
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3">
                          {person.contractEnd
                            ? <ContractStatusChip date={person.contractEnd} />
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3">
                          {(() => {
                            const curr = currentSalaryMap.get(person.id);
                            const sal = curr ?? (person.salary != null ? { salary: person.salary, currency: person.salaryCurrency ?? "AED" } : null);
                            return sal ? (
                              <Money amount={sal.salary} currency={sal.currency} rates={rates} size="sm" />
                            ) : (
                              <span className="text-gray-300">—</span>
                            );
                          })()}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {person.document ? (
                              <Link
                                href={`/records/${person.document.id}`}
                                className="text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
                              >
                                View →
                              </Link>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                            {canWrite && (
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
                                templates={activeTemplates.map((tpl) => ({
                                  id: tpl.id,
                                  name: tpl.name,
                                  placeholders: tpl.placeholders ? JSON.parse(tpl.placeholders) : [],
                                }))}
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            {canWrite && (
                              <ExitEmployeeModal
                                person={{
                                  id: person.id,
                                  name: person.name,
                                  salary: person.salary,
                                  currency: person.salaryCurrency,
                                  exitDate: person.exitDate?.toISOString().split("T")[0] ?? null,
                                  exitReason: person.exitReason,
                                }}
                              />
                            )}
                            {canWrite && (
                              <DeletePersonButton personId={person.id} personName={person.name} />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredPayrollOnly.map((emp) => (
                    <PayrollOnlyRow
                      key={`po-${emp.name}`}
                      name={emp.name}
                      salary={emp.salary}
                      currency={emp.currency}
                      rates={rates}
                      canWrite={canWrite}
                    />
                  ))}
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
