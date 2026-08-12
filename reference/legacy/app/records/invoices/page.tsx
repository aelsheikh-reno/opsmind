import { prisma } from "@/lib/prisma";
import Sidebar from "../../components/SidebarWrapper";
import TopBar from "../../components/TopBar";
import CreateInvoiceModal from "../../components/CreateInvoiceModal";
import BulkAnalyzeModal from "./BulkAnalyzeModal";
import Link from "next/link";
import RecordFilters from "../../components/RecordFilters";
import { getUsdRates, toUSD } from "@/lib/fx";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import InvoicesTable from "./InvoicesTable";

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.toLowerCase();
  return fields.some(f => f?.toLowerCase().includes(needle));
}

const INVOICE_STATUS_OPTIONS = [
  { value: "paid",    label: "Paid" },
  { value: "unpaid",  label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; party?: string; year?: string; status?: string; entity?: string }>;
}) {
  const { q = "", party = "", year = "", status = "", entity = "" } = await searchParams;
  const session = await auth();
  const canWrite = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null).invoices === "write";

  const [invoices, usdRates] = await Promise.all([
    prisma.document.findMany({
      where: { docType: "invoice" },
      orderBy: [{ isPaid: "asc" }, { expiryDate: "asc" }],
      include: { legalEntity: { select: { name: true } } },
    }),
    getUsdRates(),
  ]);

  const partySet = new Set<string>();
  const yearSet  = new Set<number>();
  for (const doc of invoices) {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    for (const p of parties) if (p.trim()) partySet.add(p.trim());
    const y = doc.issueDate?.getFullYear() ?? doc.expiryDate?.getFullYear();
    if (y) yearSet.add(y);
  }
  const partyOptions = Array.from(partySet).sort().map(p => ({ value: p, label: p }));
  const yearOptions  = Array.from(yearSet).sort((a, b) => b - a).map(y => ({ value: String(y), label: String(y) }));

  const filteredInvoices = invoices.filter((doc) => {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    if (q && !matchesQuery(q, doc.filename, doc.referenceNumber, doc.notes, ...parties)) return false;
    if (party && !parties.some(p => p.trim().toLowerCase() === party.toLowerCase())) return false;
    if (year) {
      const docYear = doc.issueDate?.getFullYear() ?? doc.expiryDate?.getFullYear();
      if (String(docYear) !== year) return false;
    }
    if (status === "paid"    && !doc.isPaid) return false;
    if (status === "unpaid"  && doc.isPaid) return false;
    if (status === "overdue" && !((!doc.isPaid) && doc.expiryDate && daysUntil(doc.expiryDate) < 0)) return false;
    if (entity === "untagged" && doc.legalEntityId != null) return false;
    return true;
  });

  const unpaid        = filteredInvoices.filter(i => !i.isPaid);
  const overdueCount  = unpaid.filter(i => i.expiryDate && daysUntil(i.expiryDate) < 0).length;
  const dueSoonCount  = unpaid.filter(i => i.expiryDate && daysUntil(i.expiryDate) >= 0 && daysUntil(i.expiryDate) <= 30).length;
  const paidCount     = filteredInvoices.filter(i => i.isPaid).length;
  const untaggedCount = invoices.filter(i => i.legalEntityId == null).length;

  const isFiltered = !!(q || party || year || status || entity);

  // Per-currency totals — filtered / collected / outstanding
  type CurBucket = { total: number; collected: number };
  const byCurrency = new Map<string, CurBucket>();
  for (const inv of filteredInvoices) {
    if (inv.amount == null || !inv.currency) continue;
    const b = byCurrency.get(inv.currency) ?? { total: 0, collected: 0 };
    b.total += inv.amount;
    if (inv.isPaid) b.collected += inv.amount;
    byCurrency.set(inv.currency, b);
  }
  const currencyRows = Array.from(byCurrency.entries()).sort(
    ([a, av], [b, bv]) => toUSD(bv.total, b, usdRates) - toUSD(av.total, a, usdRates)
  );
  const totalAllUSD       = currencyRows.reduce((s, [c, b]) => s + toUSD(b.total,     c, usdRates), 0);
  const totalCollectedUSD = currencyRows.reduce((s, [c, b]) => s + toUSD(b.collected, c, usdRates), 0);
  const totalUnpaidUSD    = totalAllUSD - totalCollectedUSD;

  // Legacy — kept for Outstanding card
  const unpaidByCur = new Map<string, number>();
  for (const inv of unpaid) {
    if (inv.amount != null && inv.currency) {
      unpaidByCur.set(inv.currency, (unpaidByCur.get(inv.currency) ?? 0) + inv.amount);
    }
  }
  const nonUsdCurrencies = Array.from(unpaidByCur.keys()).filter(c => c !== "USD");

  function fmtUsd(v: number) {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
    return `$${Math.round(v).toLocaleString()}`;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <Sidebar />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Records", href: "/records" }, { label: "Invoices" }]} />

        <main className="p-4 sm:p-6 w-full">
          <div>

          {/* Page title */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Invoices</h1>
              <p className="text-sm text-gray-400 mt-0.5">Captured invoices with payment tracking.</p>
            </div>
            {canWrite && (
            <div className="flex items-center gap-2">
              <CreateInvoiceModal />
              <BulkAnalyzeModal />
              <Link href="/" className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition-colors">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v7M3 4l3-3 3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M1 10h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Upload invoice
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
                {isFiltered && <span className="text-[9px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full ml-auto">Filtered</span>}
              </div>
              <p className="text-2xl font-bold text-gray-900">{filteredInvoices.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">{paidCount} paid · {unpaid.length} outstanding</p>
            </div>

            <div className={`bg-white border border-surface-border border-l-[3px] rounded-xl p-5 ${overdueCount > 0 ? "border-l-red-500" : "border-l-red-200"}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${overdueCount > 0 ? "bg-red-100" : "bg-red-50"}`}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke={overdueCount > 0 ? "#dc2626" : "#fca5a5"} strokeWidth="1.5" />
                    <path d="M8 5v3.5L5.5 10" stroke={overdueCount > 0 ? "#dc2626" : "#fca5a5"} strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Overdue</span>
              </div>
              <p className={`text-2xl font-bold ${overdueCount > 0 ? "text-red-600" : "text-gray-900"}`}>{overdueCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">unpaid &amp; past due</p>
            </div>

            <div className={`bg-white border border-surface-border border-l-[3px] rounded-xl p-5 ${dueSoonCount > 0 ? "border-l-orange-500" : "border-l-orange-200"}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${dueSoonCount > 0 ? "bg-orange-100" : "bg-orange-50"}`}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2L14.5 13H1.5L8 2z" stroke={dueSoonCount > 0 ? "#ea580c" : "#fdba74"} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                    <path d="M8 6.5v3M8 11v.5" stroke={dueSoonCount > 0 ? "#ea580c" : "#fdba74"} strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Due soon</span>
              </div>
              <p className={`text-2xl font-bold ${dueSoonCount > 0 ? "text-orange-600" : "text-gray-900"}`}>{dueSoonCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">within 30 days</p>
            </div>

            <div className="bg-white border border-surface-border border-l-[3px] border-l-emerald-400 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="#059669" strokeWidth="1.3" fill="none" />
                    <path d="M8 5v2.5m0 0h-1.5m1.5 0h1.5M8 7.5V11m-2-2h4" stroke="#059669" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Outstanding</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {totalUnpaidUSD > 0 ? `≈ USD ${Math.round(totalUnpaidUSD).toLocaleString()}` : "—"}
              </p>
              {unpaidByCur.size > 0 ? (
                <>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {Array.from(unpaidByCur.entries()).map(([c, t]) => `${c} ${t.toLocaleString()}`).join(" · ")} outstanding
                  </p>
                  {nonUsdCurrencies.length > 0 && (
                    <p className="text-[10px] text-gray-300 mt-1">
                      {nonUsdCurrencies.map(c => `1 USD = ${(usdRates[c] ?? 1).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${c}`).join(" · ")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">no amounts</p>
              )}
            </div>
          </div>

          {/* Financial summary */}
          {currencyRows.length > 0 && (
            <div className="bg-white border border-surface-border rounded-xl p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Invoice totals</h2>
                <span className="text-[11px] text-gray-400">{filteredInvoices.filter(i => i.amount != null).length} invoices with amounts</span>
              </div>

              <div className="grid grid-cols-3 gap-6 mb-4">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Total invoiced</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{fmtUsd(totalAllUSD)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">USD equivalent</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Collected</p>
                  <p className="text-xl font-bold text-emerald-600 tabular-nums">{fmtUsd(totalCollectedUSD)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {totalAllUSD > 0 ? `${Math.round(totalCollectedUSD / totalAllUSD * 100)}% of total` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Outstanding</p>
                  <p className={`text-xl font-bold tabular-nums ${totalUnpaidUSD > 0 ? "text-amber-600" : "text-gray-400"}`}>
                    {fmtUsd(totalUnpaidUSD)}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">unpaid invoices</p>
                </div>
              </div>

              {totalAllUSD > 0 && (
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, totalCollectedUSD / totalAllUSD * 100)}%` }}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {currencyRows.map(([currency, b]) => {
                  const outstanding = b.total - b.collected;
                  return (
                    <div key={currency} className="bg-surface-inset rounded-lg px-3 py-2.5">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{currency}</p>
                      <p className="text-sm font-bold text-gray-900 tabular-nums">
                        {currency === "USD" ? "$" : ""}{Math.round(b.total).toLocaleString()} {currency !== "USD" ? currency : ""}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="flex items-center gap-1 text-[10px] text-emerald-600 tabular-nums">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          {Math.round(b.collected).toLocaleString()}
                        </span>
                        {outstanding > 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-amber-600 tabular-nums">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                            {Math.round(outstanding).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {currency !== "USD" && (
                        <p className="text-[9px] text-gray-300 mt-1 tabular-nums">≈ {fmtUsd(toUSD(b.total, currency, usdRates))}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="mb-4 flex flex-col gap-2">
            <RecordFilters
              q={q} party={party} year={year} status={status}
              partyOptions={partyOptions} yearOptions={yearOptions} statusOptions={INVOICE_STATUS_OPTIONS}
              searchPlaceholder="Search invoices…"
            />
            {untaggedCount > 0 && (
              <div className="flex items-center gap-2">
                <Link
                  href={entity === "untagged" ? "/records/invoices" : "/records/invoices?entity=untagged"}
                  className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded-full border transition-colors ${
                    entity === "untagged"
                      ? "bg-amber-100 border-amber-300 text-amber-800"
                      : "bg-white border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-700"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  {entity === "untagged" ? "Showing untagged" : `${untaggedCount} untagged`}
                </Link>
                {entity === "untagged" && (
                  <span className="text-[11px] text-gray-400">— invoices with no entity assigned</span>
                )}
              </div>
            )}
          </div>

          {/* Table */}
          {invoices.length === 0 ? (
            <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M4 4h10l6 6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                  <path d="M8 10h8M8 14h5" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">No invoices yet</p>
              <p className="text-sm text-gray-400">Upload invoices to track payment due dates here.</p>
              {canWrite && <Link href="/" className="mt-1 text-sm font-medium text-gray-700 hover:text-gray-900">Upload an invoice →</Link>}
            </div>
          ) : (
            <InvoicesTable
              initialInvoices={filteredInvoices.map(d => ({ ...d, legalEntityId: d.legalEntityId ?? null, legalEntityName: d.legalEntity?.name ?? null }))}
              canWrite={canWrite}
            />
          )}
          </div>
        </main>
      </div>
    </div>
  );
}
