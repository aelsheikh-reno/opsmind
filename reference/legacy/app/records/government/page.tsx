import { prisma } from "@/lib/prisma";
import { DOC_TYPE_LABELS, DOC_TYPE_COLORS } from "@/lib/doc-types";
import { formatDateTime, fmtDays } from "@/lib/format-date";
import Sidebar from "../../components/SidebarWrapper";
import TopBar from "../../components/TopBar";
import Link from "next/link";
import PartyChips from "../../components/PartyChips";
import RecordFilters from "../../components/RecordFilters";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";

const GOV_DOC_TYPES = ["visa", "emirates_id", "labor_card", "trade_license", "government_permit"] as const;

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function ExpiryChip({ date }: { date: Date }) {
  const days = daysUntil(date);
  if (days < 0) return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Expired</span>;
  if (days <= 30) return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{fmtDays(days)} left</span>;
  if (days <= 90) return <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{fmtDays(days)} left</span>;
  return <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{fmtDays(days)} left</span>;
}

function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.toLowerCase();
  return fields.some(f => f?.toLowerCase().includes(needle));
}

const GOV_STATUS_OPTIONS = [
  { value: "active",        label: "Active" },
  { value: "expired",       label: "Expired" },
  { value: "expiring-soon", label: "Expiring soon (30d)" },
];

export default async function GovernmentalDocsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; party?: string; year?: string; status?: string }>;
}) {
  const { q = "", party = "", year = "", status = "" } = await searchParams;
  const session = await auth();
  const canWrite = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null).government === "write";

  const docs = await prisma.document.findMany({
    where: { docType: { in: [...GOV_DOC_TYPES] } },
    orderBy: { expiryDate: "asc" },
  });

  const partySet = new Set<string>();
  const yearSet  = new Set<number>();
  for (const doc of docs) {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    for (const p of parties) if (p.trim()) partySet.add(p.trim());
    const y = doc.issueDate?.getFullYear() ?? doc.expiryDate?.getFullYear();
    if (y) yearSet.add(y);
  }
  const partyOptions = Array.from(partySet).sort().map(p => ({ value: p, label: p }));
  const yearOptions  = Array.from(yearSet).sort((a, b) => b - a).map(y => ({ value: String(y), label: String(y) }));

  const filteredDocs = docs.filter((doc) => {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    if (q && !matchesQuery(q, doc.filename, doc.referenceNumber, doc.summary, ...parties)) return false;
    if (party && !parties.some(p => p.trim().toLowerCase() === party.toLowerCase())) return false;
    if (year) {
      const docYear = doc.issueDate?.getFullYear() ?? doc.expiryDate?.getFullYear();
      if (String(docYear) !== year) return false;
    }
    if (status === "active"        && doc.expiryDate && daysUntil(doc.expiryDate) < 0) return false;
    if (status === "expired"       && !(doc.expiryDate && daysUntil(doc.expiryDate) < 0)) return false;
    if (status === "expiring-soon" && !(doc.expiryDate && daysUntil(doc.expiryDate) >= 0 && daysUntil(doc.expiryDate) <= 30)) return false;
    return true;
  });

  const expiredCount  = docs.filter((d) => d.expiryDate && daysUntil(d.expiryDate) < 0).length;
  const urgentCount   = docs.filter((d) => d.expiryDate && daysUntil(d.expiryDate) >= 0 && daysUntil(d.expiryDate) <= 30).length;
  const alertCount    = expiredCount + urgentCount;

  const typeBreakdown = GOV_DOC_TYPES.map((t) => ({
    type: t,
    label: DOC_TYPE_LABELS[t] ?? t,
    count: docs.filter((d) => d.docType === t).length,
  })).filter((b) => b.count > 0);

  const topTwo = typeBreakdown.slice(0, 2);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <Sidebar />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Records", href: "/records" }, { label: "Governmental docs" }]} />

        <main className="p-4 sm:p-6 w-full">
          <div>

          {/* Page title */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Governmental docs</h1>
              <p className="text-sm text-gray-400 mt-0.5">Visas, Emirates IDs, labor cards, trade licenses, and permits.</p>
            </div>
            {canWrite && (
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition-colors">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v7M3 4l3-3 3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M1 10h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Upload document
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
                    <path d="M3 2h7l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="#6b7280" strokeWidth="1.5" fill="none" />
                    <path d="M5 7h6M5 9.5h4" stroke="#6b7280" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Total</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{docs.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">{typeBreakdown.length} type{typeBreakdown.length !== 1 ? "s" : ""}</p>
            </div>

            {topTwo[0] ? (
              <div className="bg-white border border-surface-border border-l-[3px] border-l-blue-400 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center shrink-0">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="7" width="12" height="7" rx="1" stroke="#3b82f6" strokeWidth="1.3" fill="none" />
                      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#3b82f6" strokeWidth="1.3" fill="none" />
                    </svg>
                  </div>
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{topTwo[0].label}</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{topTwo[0].count}</p>
                <p className="text-xs text-gray-400 mt-0.5">documents</p>
              </div>
            ) : (
              <div className="bg-white border border-surface-border border-l-[3px] border-l-blue-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center shrink-0">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="7" width="12" height="7" rx="1" stroke="#93c5fd" strokeWidth="1.3" fill="none" />
                      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#93c5fd" strokeWidth="1.3" fill="none" />
                    </svg>
                  </div>
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Top type</span>
                </div>
                <p className="text-2xl font-bold text-gray-300">—</p>
                <p className="text-xs text-gray-400 mt-0.5">none yet</p>
              </div>
            )}

            {topTwo[1] ? (
              <div className="bg-white border border-surface-border border-l-[3px] border-l-purple-400 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-purple-50 flex items-center justify-center shrink-0">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <circle cx="6" cy="5" r="3" stroke="#7c3aed" strokeWidth="1.3" fill="none" />
                      <path d="M1 14c0-3 2-5 5-5s5 2 5 5" stroke="#7c3aed" strokeWidth="1.3" strokeLinecap="round" fill="none" />
                    </svg>
                  </div>
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{topTwo[1].label}</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{topTwo[1].count}</p>
                <p className="text-xs text-gray-400 mt-0.5">documents</p>
              </div>
            ) : (
              <div className="bg-white border border-surface-border border-l-[3px] border-l-purple-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-purple-50 flex items-center justify-center shrink-0">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                      <circle cx="6" cy="5" r="3" stroke="#c4b5fd" strokeWidth="1.3" fill="none" />
                      <path d="M1 14c0-3 2-5 5-5s5 2 5 5" stroke="#c4b5fd" strokeWidth="1.3" strokeLinecap="round" fill="none" />
                    </svg>
                  </div>
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">2nd type</span>
                </div>
                <p className="text-2xl font-bold text-gray-300">—</p>
                <p className="text-xs text-gray-400 mt-0.5">none yet</p>
              </div>
            )}

            <div className={`bg-white border border-surface-border border-l-[3px] rounded-xl p-5 ${alertCount > 0 ? "border-l-red-500" : "border-l-red-200"}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${alertCount > 0 ? "bg-red-100" : "bg-red-50"}`}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2L14.5 13H1.5L8 2z" stroke={alertCount > 0 ? "#dc2626" : "#fca5a5"} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                    <path d="M8 6.5v3M8 11v.5" stroke={alertCount > 0 ? "#dc2626" : "#fca5a5"} strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Needs attention</span>
              </div>
              <p className={`text-2xl font-bold ${alertCount > 0 ? "text-red-600" : "text-gray-900"}`}>{alertCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">{expiredCount} expired · {urgentCount} expiring soon</p>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-4">
            <RecordFilters
              q={q} party={party} year={year} status={status}
              partyOptions={partyOptions} yearOptions={yearOptions} statusOptions={GOV_STATUS_OPTIONS}
              searchPlaceholder="Search documents…"
            />
          </div>

          {/* Table */}
          {docs.length === 0 ? (
            <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">No governmental documents yet</p>
              <p className="text-sm text-gray-400">Upload visas, Emirates IDs, trade licenses, and other government documents.</p>
              {canWrite && <Link href="/" className="mt-1 text-sm font-medium text-gray-700 hover:text-gray-900">Upload a document →</Link>}
            </div>
          ) : (
            <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
                <h2 className="text-sm font-semibold text-gray-900">All governmental documents</h2>
                <span className="text-xs text-gray-400">{docs.length} total</span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-inset">
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3 w-44">Type</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Holder / parties</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Reference no.</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Uploaded</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Issue date</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3 w-36">Expiry</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Renewal notice by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {filteredDocs.map((doc) => {
                    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
                    const isExpired = doc.expiryDate && daysUntil(doc.expiryDate) < 0;
                    const isUrgent  = doc.expiryDate && daysUntil(doc.expiryDate) >= 0 && daysUntil(doc.expiryDate) <= 30;
                    return (
                      <tr key={doc.id} className={`hover:bg-surface-hover transition-colors cursor-pointer ${isExpired ? "bg-red-50/30" : isUrgent ? "bg-amber-50/20" : ""}`}>
                        <td className="px-5 py-3">
                          <Link href={`/records/${doc.id}`} className="block">
                            <span className={`inline-flex text-xs font-semibold px-2.5 py-1 rounded-full ${DOC_TYPE_COLORS[doc.docType ?? "other"] ?? DOC_TYPE_COLORS.other}`}>
                              {DOC_TYPE_LABELS[doc.docType ?? "other"] ?? doc.docType}
                            </span>
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          <PartyChips parties={parties} />
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-gray-600">
                          <Link href={`/records/${doc.id}`} className="block">
                            {doc.referenceNumber ?? <span className="text-gray-300 font-sans">—</span>}
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
