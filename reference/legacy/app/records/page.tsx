import { prisma } from "@/lib/prisma";
import { DOC_TYPE_LABELS, DOC_TYPE_COLORS } from "@/lib/doc-types";
import { formatDateTime, fmtDays } from "@/lib/format-date";
import Sidebar from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import Link from "next/link";
import DeleteButton from "../components/DeleteButton";
import PartyChips from "../components/PartyChips";
import RecordFilters from "../components/RecordFilters";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import RecordsAutoRefresh from "./RecordsAutoRefresh";

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function ExpiryChip({ date }: { date: Date }) {
  const days = daysUntil(date);
  if (days < 0) return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{fmtDays(Math.abs(days))} ago</span>;
  if (days <= 30) return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{fmtDays(days)} left</span>;
  if (days <= 90) return <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{fmtDays(days)} left</span>;
  return <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{fmtDays(days)} left</span>;
}

function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.toLowerCase();
  return fields.some(f => f?.toLowerCase().includes(needle));
}

function SortHeader({
  label, field, sort, dir, q, extra = {},
}: {
  label: string; field: string; sort: string; dir: string; q: string;
  extra?: Record<string, string>;
}) {
  const isActive = sort === field;
  const nextDir  = isActive && dir === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams({ sort: field, dir: nextDir, ...(q ? { q } : {}), ...extra });
  return (
    <Link
      href={`?${qs}`}
      className="flex items-center gap-1 group select-none"
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

const ALL_RECORDS_STATUS_OPTIONS = [
  { value: "extracted",    label: "Via upload" },
  { value: "manual",       label: "Manual entry" },
  { value: "review",       label: "Needs review" },
  { value: "processing",   label: "Processing" },
  { value: "failed",       label: "Failed" },
  { value: "email",        label: "Via email" },
  { value: "google-drive", label: "Via Google Drive" },
];

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string; party?: string; year?: string; status?: string; docType?: string }>;
}) {
  const { q = "", sort = "", dir = "asc", party = "", year = "", status = "", docType = "" } = await searchParams;
  const sortDir = dir === "desc" ? "desc" : "asc";

  const session = await auth();
  const _perms = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null);
  const canWrite = ["contracts", "government", "invoices", "leases", "purchase_orders"].some(s => _perms[s as keyof typeof _perms] === "write");

  // Map each doc type to its section so we can filter by permission
  const accessibleDocTypes = new Set<string | null>([
    ...(_perms.contracts       !== "none" ? ["employee_contract", "client_contract", "insurance", "other", null] : []),
    ...(_perms.government      !== "none" ? ["government_document", "visa", "emirates_id", "labor_card", "trade_license", "government_permit"] : []),
    ...(_perms.leases          !== "none" ? ["lease_contract"] : []),
    ...(_perms.invoices        !== "none" ? ["invoice", "invoice_report"] : []),
    ...(_perms.purchase_orders !== "none" ? ["purchase_order"] : []),
  ]);

  const allDocs = await prisma.document.findMany({ orderBy: { createdAt: "desc" } });
  const documents = allDocs.filter(d => accessibleDocTypes.has(d.docType));

  const partySet = new Set<string>();
  const yearSet  = new Set<number>();
  for (const doc of documents) {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    for (const p of parties) if (p.trim()) partySet.add(p.trim());
    const y = doc.issueDate?.getFullYear() ?? doc.createdAt.getFullYear();
    yearSet.add(y);
  }
  const partyOptions = Array.from(partySet).sort().map(p => ({ value: p, label: p }));
  const yearOptions  = Array.from(yearSet).sort((a, b) => b - a).map(y => ({ value: String(y), label: String(y) }));

  const docTypeSet = new Set(documents.map(d => d.docType).filter(Boolean) as string[]);
  const docTypeOptions = Array.from(docTypeSet)
    .sort()
    .map(t => ({ value: t, label: DOC_TYPE_LABELS[t] ?? t }));

  const filteredDocs = documents.filter((doc) => {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    if (q && !matchesQuery(q, doc.filename, doc.referenceNumber, doc.summary, ...parties)) return false;
    if (party && !parties.some(p => p.trim().toLowerCase() === party.toLowerCase())) return false;
    if (year) {
      const docYear = doc.issueDate?.getFullYear() ?? doc.createdAt.getFullYear();
      if (String(docYear) !== year) return false;
    }
    if (status === "email" || status === "google-drive") {
      if (doc.source !== status) return false;
    } else if (status && doc.status !== status) return false;
    if (docType && doc.docType !== docType) return false;
    return true;
  });

  if (sort === "issueDate") {
    filteredDocs.sort((a, b) => {
      if (!a.issueDate && !b.issueDate) return 0;
      if (!a.issueDate) return 1;
      if (!b.issueDate) return -1;
      const diff = a.issueDate.getTime() - b.issueDate.getTime();
      return sortDir === "asc" ? diff : -diff;
    });
  } else if (sort === "expiryDate") {
    filteredDocs.sort((a, b) => {
      if (!a.expiryDate && !b.expiryDate) return 0;
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      const diff = a.expiryDate.getTime() - b.expiryDate.getTime();
      return sortDir === "asc" ? diff : -diff;
    });
  }

  const CONTRACT_TYPES = ["lease_contract", "employee_contract", "client_contract"];
  const expiringSoon = documents.filter(d =>
    d.expiryDate &&
    CONTRACT_TYPES.includes(d.docType ?? "") &&
    daysUntil(d.expiryDate) >= 0 &&
    daysUntil(d.expiryDate) <= 90
  ).length;
  const failed = documents.filter(d => d.status === "failed").length;
  const extracted = documents.filter(d => d.status === "extracted").length;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <RecordsAutoRefresh />
      <Sidebar />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Documents & renewals" }]} />

        <main className="p-4 sm:p-6 w-full">

          {/* Page title */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Documents & renewals</h1>
              <p className="text-sm text-gray-400 mt-0.5">All captured documents with extracted data and expiry tracking.</p>
            </div>
            <div className="flex items-center gap-3">
              {canWrite && (
                <>
                  <Link href="/records/new" className="flex items-center gap-1.5 bg-white hover:bg-gray-50 border border-surface-border text-gray-700 text-xs font-medium px-3.5 py-2 rounded-lg transition-colors">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    New record
                  </Link>
                  <Link href="/" className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition-colors">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M6 1v7M3 4l3-3 3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M1 10h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Upload document
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Insight cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <div className="bg-white border border-surface-border border-l-[3px] border-l-gray-300 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M3 2h7l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="#6b7280" strokeWidth="1.5" fill="none" />
                    <path d="M10 2v4h4" stroke="#6b7280" strokeWidth="1.5" fill="none" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Total</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{documents.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">{extracted} extracted</p>
            </div>

            <div className={`bg-white border border-surface-border border-l-[3px] rounded-xl p-5 ${expiringSoon > 0 ? "border-l-red-500" : "border-l-red-200"}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${expiringSoon > 0 ? "bg-red-100" : "bg-gray-100"}`}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke={expiringSoon > 0 ? "#dc2626" : "#6b7280"} strokeWidth="1.5" />
                    <path d="M8 5v3.5L10.5 10" stroke={expiringSoon > 0 ? "#dc2626" : "#6b7280"} strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Expiring soon</span>
              </div>
              <p className={`text-2xl font-bold ${expiringSoon > 0 ? "text-red-600" : "text-gray-900"}`}>{expiringSoon}</p>
              <p className="text-xs text-gray-400 mt-0.5">contracts &amp; leases · 90 days</p>
            </div>

            <div className={`bg-white border border-surface-border border-l-[3px] rounded-xl p-5 ${failed > 0 ? "border-l-amber-500" : "border-l-amber-200"}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${failed > 0 ? "bg-amber-100" : "bg-gray-100"}`}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2L14.5 13H1.5L8 2z" stroke={failed > 0 ? "#d97706" : "#6b7280"} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                    <path d="M8 7v3M8 11.5v.5" stroke={failed > 0 ? "#d97706" : "#6b7280"} strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Failed</span>
              </div>
              <p className={`text-2xl font-bold ${failed > 0 ? "text-amber-600" : "text-gray-900"}`}>{failed}</p>
              <p className="text-xs text-gray-400 mt-0.5">extraction errors</p>
            </div>

            <div className="bg-white border border-surface-border border-l-[3px] border-l-gray-300 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" stroke="#6b7280" strokeWidth="1.3" fill="none" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">AI extracted</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{extracted}</p>
              <p className="text-xs text-gray-400 mt-0.5">ready to use</p>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-4">
            <RecordFilters
              q={q} party={party} year={year} status={status} docType={docType}
              partyOptions={partyOptions} yearOptions={yearOptions} statusOptions={ALL_RECORDS_STATUS_OPTIONS} docTypeOptions={docTypeOptions}
              searchPlaceholder="Search documents…"
              extraParams={{ ...(sort ? { sort } : {}), ...(sortDir !== "asc" ? { dir: sortDir } : {}), ...(docType ? { docType } : {}) }}
            />
          </div>

          {/* Table */}
          {documents.length === 0 ? (
            <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M4 4h10l6 6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                  <path d="M14 4v6h6" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">No documents yet</p>
              <p className="text-sm text-gray-400">Upload your first document to get started.</p>
              <Link href="/" className="mt-1 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
                Go to Add to OpsMind →
              </Link>
            </div>
          ) : (
            <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
                <h2 className="text-sm font-semibold text-gray-900">All documents</h2>
                <span className="text-xs text-gray-400">{documents.length} total</span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-inset">
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Type</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">File</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Parties</th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Uploaded</th>
                    <th className="text-left px-5 py-3">
                      <SortHeader label="Issue date" field="issueDate" sort={sort} dir={sortDir} q={q} extra={{ ...(party ? { party } : {}), ...(year ? { year } : {}), ...(status ? { status } : {}), ...(docType ? { docType } : {}) }} />
                    </th>
                    <th className="text-left px-5 py-3">
                      <SortHeader label="Expiry" field="expiryDate" sort={sort} dir={sortDir} q={q} extra={{ ...(party ? { party } : {}), ...(year ? { year } : {}), ...(status ? { status } : {}), ...(docType ? { docType } : {}) }} />
                    </th>
                    <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Status</th>
                    <th className="px-3 py-3 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {filteredDocs.map((doc) => {
                    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
                    return (
                      <tr key={doc.id} className="hover:bg-surface-hover transition-colors cursor-pointer">
                        <td className="px-5 py-3">
                          <Link href={`/records/${doc.id}`} className="block">
                            {doc.docType ? (
                              <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${DOC_TYPE_COLORS[doc.docType] ?? DOC_TYPE_COLORS.other}`}>
                                {DOC_TYPE_LABELS[doc.docType] ?? doc.docType}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          <Link href={`/records/${doc.id}`} className="block">
                            <p className="font-medium text-gray-900 truncate max-w-40">{doc.filename}</p>
                          </Link>
                        </td>
                        <td className="px-5 py-3 max-w-48">
                          <PartyChips parties={parties} />
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                          <Link href={`/records/${doc.id}`} className="block">
                            {formatDateTime(doc.createdAt)}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-gray-600 text-xs">
                          <Link href={`/records/${doc.id}`} className="block">
                            {doc.issueDate ? doc.issueDate.toISOString().split("T")[0] : <span className="text-gray-300">—</span>}
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          <Link href={`/records/${doc.id}`} className="block">
                            {doc.isPaid ? (
                              <div className="flex flex-col gap-1">
                                {doc.expiryDate && <span className="text-xs text-gray-700">{doc.expiryDate.toISOString().split("T")[0]}</span>}
                                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full w-fit">Paid</span>
                              </div>
                            ) : doc.expiryDate ? (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-gray-700">{doc.expiryDate.toISOString().split("T")[0]}</span>
                                <ExpiryChip date={doc.expiryDate} />
                              </div>
                            ) : <span className="text-gray-300">—</span>}
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          <Link href={`/records/${doc.id}`} className="block">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              doc.source === "email"        ? "bg-indigo-50 text-indigo-600" :
                              doc.source === "google-drive" ? "bg-blue-50 text-blue-600" :
                              doc.status === "extracted"    ? "bg-green-50 text-green-700" :
                              doc.status === "manual"       ? "bg-gray-100 text-gray-600" :
                              doc.status === "failed"       ? "bg-red-50 text-red-700" :
                              doc.status === "review"       ? "bg-amber-50 text-amber-700" :
                              "bg-blue-50 text-blue-700"
                            }`}>
                              {doc.source === "email"        ? "Via email" :
                               doc.source === "google-drive" ? "Via Google Drive" :
                               doc.status === "extracted"    ? "Via upload" :
                               doc.status === "manual"       ? "Manual entry" :
                               doc.status === "review"       ? "Needs review" :
                               doc.status}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <DeleteButton documentId={doc.id} variant="icon" hidden={!canWrite} />
                        </td>
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
