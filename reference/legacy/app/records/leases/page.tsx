import { prisma } from "@/lib/prisma";
import { formatDateTime, fmtDays } from "@/lib/format-date";
import PartyChips from "../../components/PartyChips";
import Sidebar from "../../components/SidebarWrapper";
import TopBar from "../../components/TopBar";
import DeleteButton from "../../components/DeleteButton";
import Link from "next/link";
import RecordFilters from "../../components/RecordFilters";
import { getUsdRates, toUSD } from "@/lib/fx";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function ExpiryChip({ date }: { date: Date }) {
  const days = daysUntil(date);
  if (days < 0)   return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Expired</span>;
  if (days <= 30)  return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{fmtDays(days)} left</span>;
  if (days <= 90)  return <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{fmtDays(days)} left</span>;
  return <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{fmtDays(days)} left</span>;
}

function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.toLowerCase();
  return fields.some(f => f?.toLowerCase().includes(needle));
}

const LEASE_STATUS_OPTIONS = [
  { value: "active",        label: "Active" },
  { value: "expired",       label: "Expired" },
  { value: "renewing-soon", label: "Renewing soon (90d)" },
];

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; party?: string; year?: string; status?: string }>;
}) {
  const { q = "", party = "", year = "", status = "" } = await searchParams;
  const session = await auth();
  const canWrite = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null).leases === "write";

  const [leases, usdRates] = await Promise.all([
    prisma.document.findMany({
      where: { docType: "lease_contract" },
      orderBy: { expiryDate: "asc" },
    }),
    getUsdRates(),
  ]);

  const partySet = new Set<string>();
  const yearSet  = new Set<number>();
  for (const doc of leases) {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    for (const p of parties) if (p.trim()) partySet.add(p.trim());
    const y = doc.issueDate?.getFullYear() ?? doc.expiryDate?.getFullYear();
    if (y) yearSet.add(y);
  }
  const partyOptions = Array.from(partySet).sort().map(p => ({ value: p, label: p }));
  const yearOptions  = Array.from(yearSet).sort((a, b) => b - a).map(y => ({ value: String(y), label: String(y) }));

  const filteredLeases = leases.filter((doc) => {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    if (q && !matchesQuery(q, doc.filename, doc.referenceNumber, doc.summary, ...parties)) return false;
    if (party && !parties.some(p => p.trim().toLowerCase() === party.toLowerCase())) return false;
    if (year) {
      const docYear = doc.issueDate?.getFullYear() ?? doc.expiryDate?.getFullYear();
      if (String(docYear) !== year) return false;
    }
    if (status === "active"        && doc.expiryDate && daysUntil(doc.expiryDate) < 0) return false;
    if (status === "expired"       && !(doc.expiryDate && daysUntil(doc.expiryDate) < 0)) return false;
    if (status === "renewing-soon" && !(doc.expiryDate && daysUntil(doc.expiryDate) >= 0 && daysUntil(doc.expiryDate) <= 90)) return false;
    return true;
  });

  const activeCount  = leases.filter(l => !l.expiryDate || daysUntil(l.expiryDate) >= 0).length;
  const expiredCount = leases.filter(l => l.expiryDate && daysUntil(l.expiryDate) < 0).length;
  const urgentCount  = leases.filter(l => l.expiryDate && daysUntil(l.expiryDate) >= 0 && daysUntil(l.expiryDate) <= 90).length;
  const totalUSD     = leases.reduce((sum, l) => l.amount && l.currency ? sum + toUSD(l.amount, l.currency, usdRates) : sum, 0);
  const hasAmounts   = leases.some(l => l.amount != null);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <Sidebar />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Records", href: "/records" }, { label: "Rentals & Leases" }]} />

        <main className="p-4 sm:p-6 w-full">
          <div>

          {/* Page title */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Rentals & Leases</h1>
              <p className="text-sm text-gray-400 mt-0.5">Lease and rental contracts with payment schedule tracking.</p>
            </div>
            {canWrite && (
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition-colors">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v7M3 4l3-3 3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M1 10h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Upload lease
              </Link>
            </div>
            )}
          </div>

          {/* Insight cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <div className="bg-white border border-surface-border border-l-[3px] border-l-gray-300 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M2 14V7l6-5 6 5v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" stroke="#6b7280" strokeWidth="1.3" fill="none" />
                    <path d="M6 14v-4h4v4" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Total</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{leases.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">{activeCount} active · {expiredCount} expired</p>
            </div>

            <div className={`bg-white border border-surface-border border-l-[3px] rounded-xl p-5 ${urgentCount > 0 ? "border-l-amber-500" : "border-l-amber-200"}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${urgentCount > 0 ? "bg-amber-100" : "bg-amber-50"}`}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke={urgentCount > 0 ? "#d97706" : "#fcd34d"} strokeWidth="1.5" />
                    <path d="M8 5v3.5L5.5 10" stroke={urgentCount > 0 ? "#d97706" : "#fcd34d"} strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Renewing soon</span>
              </div>
              <p className={`text-2xl font-bold ${urgentCount > 0 ? "text-amber-600" : "text-gray-900"}`}>{urgentCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">within 90 days</p>
            </div>

            <div className="bg-white border border-surface-border border-l-[3px] border-l-emerald-400 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="#059669" strokeWidth="1.3" fill="none" />
                    <path d="M8 5v2.5m0 0h-1.5m1.5 0h1.5M8 7.5V11m-2-2h4" stroke="#059669" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Total value</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {hasAmounts && totalUSD > 0 ? `USD ${Math.round(totalUSD).toLocaleString()}` : "—"}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{hasAmounts ? "≈ combined in USD" : "no amounts"}</p>
            </div>

            <div className={`bg-white border border-surface-border border-l-[3px] rounded-xl p-5 ${expiredCount > 0 ? "border-l-red-500" : "border-l-red-200"}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${expiredCount > 0 ? "bg-red-100" : "bg-red-50"}`}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2L14.5 13H1.5L8 2z" stroke={expiredCount > 0 ? "#dc2626" : "#fca5a5"} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                    <path d="M8 6.5v3M8 11v.5" stroke={expiredCount > 0 ? "#dc2626" : "#fca5a5"} strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Expired</span>
              </div>
              <p className={`text-2xl font-bold ${expiredCount > 0 ? "text-red-600" : "text-gray-900"}`}>{expiredCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">past expiry date</p>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-4">
            <RecordFilters
              q={q} party={party} year={year} status={status}
              partyOptions={partyOptions} yearOptions={yearOptions} statusOptions={LEASE_STATUS_OPTIONS}
              searchPlaceholder="Search leases…"
            />
          </div>

          {/* Table */}
          {leases.length === 0 ? (
            <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M3 21V10l9-7 9 7v11" stroke="#9ca3af" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                  <path d="M9 21v-6h6v6" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">No lease contracts yet</p>
              <p className="text-sm text-gray-400">Upload a lease or rental agreement to track it here.</p>
              {canWrite && <Link href="/" className="mt-1 text-sm font-medium text-gray-700 hover:text-gray-900">Upload a lease →</Link>}
            </div>
          ) : (
            <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
                <h2 className="text-sm font-semibold text-gray-900">All leases</h2>
                <span className="text-xs text-gray-400">{leases.length} total</span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-inset">
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Parties</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Uploaded</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Start date</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Expiry</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Renewal notice by</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Amount</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Payment terms</th>
                    {canWrite && <th className="px-5 py-3 w-8"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {filteredLeases.map((doc) => {
                    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
                    const isUrgent  = doc.expiryDate && daysUntil(doc.expiryDate) >= 0 && daysUntil(doc.expiryDate) <= 90;
                    const isExpired = doc.expiryDate && daysUntil(doc.expiryDate) < 0;
                    return (
                      <tr key={doc.id} className={`hover:bg-surface-hover transition-colors cursor-pointer ${isExpired ? "opacity-60" : isUrgent ? "bg-amber-50/20" : ""}`}>
                        <td className="px-5 py-3">
                          <Link href={`/records/${doc.id}`} className="block">
                            <PartyChips parties={parties} />
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                          <Link href={`/records/${doc.id}`} className="block">
                            {formatDateTime(doc.createdAt)}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-600">
                          <Link href={`/records/${doc.id}`} className="block">
                            {doc.issueDate ? doc.issueDate.toISOString().split("T")[0] : <span className="text-gray-300">—</span>}
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          <Link href={`/records/${doc.id}`} className="block">
                            {doc.expiryDate ? (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-gray-700">{doc.expiryDate.toISOString().split("T")[0]}</span>
                                <ExpiryChip date={doc.expiryDate} />
                              </div>
                            ) : <span className="text-gray-300">—</span>}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-600">
                          <Link href={`/records/${doc.id}`} className="block">
                            {doc.renewalDeadline ? doc.renewalDeadline.toISOString().split("T")[0] : <span className="text-gray-300">—</span>}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-xs">
                          <Link href={`/records/${doc.id}`} className="block">
                            {doc.amount != null
                              ? <span className="font-medium text-gray-700">{doc.currency ?? ""} {doc.amount.toLocaleString()}</span>
                              : <span className="text-gray-300">—</span>}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500 max-w-48">
                          <Link href={`/records/${doc.id}`} className="block truncate max-w-48">
                            {doc.paymentTerms ?? <span className="text-gray-300">—</span>}
                          </Link>
                        </td>
                        {canWrite && (
                        <td className="px-3 py-3">
                          <DeleteButton documentId={doc.id} variant="icon" />
                        </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
          </div>
        </main>
      </div>
    </div>
  );
}
