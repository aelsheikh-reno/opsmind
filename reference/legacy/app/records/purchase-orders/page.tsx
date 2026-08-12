import { prisma } from "@/lib/prisma";
import Sidebar from "../../components/SidebarWrapper";
import TopBar from "../../components/TopBar";
import Link from "next/link";
import RecordFilters from "../../components/RecordFilters";
import { getUsdRates, toUSD } from "@/lib/fx";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import PurchaseOrdersTable from "./PurchaseOrdersTable";

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.toLowerCase();
  return fields.some(f => f?.toLowerCase().includes(needle));
}

const PO_STATUS_OPTIONS = [
  { value: "open",     label: "Open" },
  { value: "closed",   label: "Closed" },
  { value: "archived", label: "Archived" },
];

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; party?: string; year?: string; status?: string }>;
}) {
  const { q = "", party = "", year = "", status = "" } = await searchParams;
  const session = await auth();
  const canWrite = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null).purchase_orders === "write";

  const [orders, usdRates] = await Promise.all([
    prisma.document.findMany({
      where: { docType: "purchase_order" },
      orderBy: [{ isPaid: "asc" }, { expiryDate: "asc" }],
    }),
    getUsdRates(),
  ]);

  const partySet = new Set<string>();
  const yearSet  = new Set<number>();
  for (const doc of orders) {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    for (const p of parties) if (p.trim()) partySet.add(p.trim());
    const y = doc.issueDate?.getFullYear() ?? doc.expiryDate?.getFullYear();
    if (y) yearSet.add(y);
  }
  const partyOptions = Array.from(partySet).sort().map(p => ({ value: p, label: p }));
  const yearOptions  = Array.from(yearSet).sort((a, b) => b - a).map(y => ({ value: String(y), label: String(y) }));

  const filteredOrders = orders.filter((doc) => {
    const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
    if (q && !matchesQuery(q, doc.filename, doc.referenceNumber, doc.notes, ...parties)) return false;
    if (party && !parties.some(p => p.trim().toLowerCase() === party.toLowerCase())) return false;
    if (year) {
      const docYear = doc.issueDate?.getFullYear() ?? doc.expiryDate?.getFullYear();
      if (String(docYear) !== year) return false;
    }
    const effectiveStatus = doc.poStatus ?? "open";
    if (status && effectiveStatus !== status) return false;
    return true;
  });

  const openDocs      = filteredOrders.filter(o => (o.poStatus ?? "open") === "open");
  const overdueCount  = openDocs.filter(o => o.expiryDate && daysUntil(o.expiryDate) < 0).length;
  const dueSoonCount  = openDocs.filter(o => o.expiryDate && daysUntil(o.expiryDate) >= 0 && daysUntil(o.expiryDate) <= 30).length;
  const closedCount   = filteredOrders.filter(o => o.poStatus === "closed").length;

  // Per-currency totals
  type CurBucket = { total: number; received: number };
  const byCurrency = new Map<string, CurBucket>();
  for (const po of filteredOrders) {
    if (po.amount == null || !po.currency) continue;
    const b = byCurrency.get(po.currency) ?? { total: 0, received: 0 };
    b.total += po.amount;
    if (po.poStatus === "closed") b.received += po.amount;
    byCurrency.set(po.currency, b);
  }
  const currencyRows = Array.from(byCurrency.entries()).sort(
    ([a, av], [b, bv]) => toUSD(bv.total, b, usdRates) - toUSD(av.total, a, usdRates)
  );
  const totalAllUSD      = currencyRows.reduce((s, [c, b]) => s + toUSD(b.total,    c, usdRates), 0);
  const totalReceivedUSD = currencyRows.reduce((s, [c, b]) => s + toUSD(b.received, c, usdRates), 0);
  const totalOpenUSD     = totalAllUSD - totalReceivedUSD;

  function fmtUsd(v: number) {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
    return `$${Math.round(v).toLocaleString()}`;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <Sidebar />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Records", href: "/records" }, { label: "Purchase Orders" }]} />

        <main className="p-4 sm:p-6 w-full">
          <div>

          {/* Page title */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Purchase Orders</h1>
              <p className="text-sm text-gray-400 mt-0.5">Captured purchase orders with delivery and payment tracking.</p>
            </div>
            {canWrite && (
              <Link href="/" className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium px-3.5 py-2 rounded-lg transition-colors self-start sm:self-auto">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v7M3 4l3-3 3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M1 10h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Upload PO
              </Link>
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
              <p className="text-2xl font-bold text-gray-900">{filteredOrders.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">{closedCount} closed · {openDocs.length} open</p>
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
              <p className="text-xs text-gray-400 mt-0.5">past delivery date</p>
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

            <div className="bg-white border border-surface-border border-l-[3px] border-l-blue-400 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center shrink-0">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="#2563eb" strokeWidth="1.3" fill="none" />
                    <path d="M8 5v2.5m0 0h-1.5m1.5 0h1.5M8 7.5V11m-2-2h4" stroke="#2563eb" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Open value</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {totalOpenUSD > 0 ? `≈ USD ${Math.round(totalOpenUSD).toLocaleString()}` : "—"}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">open PO value</p>
            </div>
          </div>

          {/* Financial summary */}
          {currencyRows.length > 0 && (
            <div className="bg-white border border-surface-border rounded-xl p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">PO totals</h2>
                <span className="text-[11px] text-gray-400">{filteredOrders.filter(o => o.amount != null).length} POs with amounts</span>
              </div>

              <div className="grid grid-cols-3 gap-6 mb-4">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Total ordered</p>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{fmtUsd(totalAllUSD)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">USD equivalent</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Received</p>
                  <p className="text-xl font-bold text-emerald-600 tabular-nums">{fmtUsd(totalReceivedUSD)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {totalAllUSD > 0 ? `${Math.round(totalReceivedUSD / totalAllUSD * 100)}% of total` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Open</p>
                  <p className={`text-xl font-bold tabular-nums ${totalOpenUSD > 0 ? "text-blue-600" : "text-gray-400"}`}>
                    {fmtUsd(totalOpenUSD)}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">pending delivery</p>
                </div>
              </div>

              {totalAllUSD > 0 && (
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, totalReceivedUSD / totalAllUSD * 100)}%` }}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {currencyRows.map(([currency, b]) => {
                  const openAmt = b.total - b.received;
                  return (
                    <div key={currency} className="bg-surface-inset rounded-lg px-3 py-2.5">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{currency}</p>
                      <p className="text-sm font-bold text-gray-900 tabular-nums">
                        {currency === "USD" ? "$" : ""}{Math.round(b.total).toLocaleString()} {currency !== "USD" ? currency : ""}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="flex items-center gap-1 text-[10px] text-emerald-600 tabular-nums">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          {Math.round(b.received).toLocaleString()}
                        </span>
                        {openAmt > 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-blue-600 tabular-nums">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                            {Math.round(openAmt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="mb-4">
            <RecordFilters
              q={q} party={party} year={year} status={status}
              partyOptions={partyOptions} yearOptions={yearOptions} statusOptions={PO_STATUS_OPTIONS}
              searchPlaceholder="Search purchase orders…"
            />
          </div>

          {/* Table */}
          {orders.length === 0 ? (
            <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M4 4h10l6 6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
                  <path d="M8 10h8M8 14h5" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-700">No purchase orders yet</p>
              <p className="text-sm text-gray-400">Upload a PO document to track it here.</p>
              {canWrite && <Link href="/" className="mt-1 text-sm font-medium text-gray-700 hover:text-gray-900">Upload a PO →</Link>}
            </div>
          ) : (
            <PurchaseOrdersTable
              initialOrders={filteredOrders.map(d => ({
                id: d.id,
                filename: d.filename,
                parties: d.parties,
                referenceNumber: d.referenceNumber,
                source: d.source,
                status: d.status,
                createdAt: d.createdAt,
                issueDate: d.issueDate,
                expiryDate: d.expiryDate,
                amount: d.amount,
                currency: d.currency,
                vatAmount: d.vatAmount,
                isPaid: d.isPaid,
                paidAt: d.paidAt,
                notes: d.notes,
                poStatus: d.poStatus ?? "open",
              }))}
              canWrite={canWrite}
            />
          )}
          </div>
        </main>
      </div>
    </div>
  );
}
