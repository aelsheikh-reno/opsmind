import { prisma } from "@/lib/prisma";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import Link from "next/link";

const TYPE_ICON_BG: Record<string, string> = {
  employee_contract: "bg-emerald-50",
  client_contract:   "bg-teal-50",
  lease_contract:    "bg-orange-50",
  invoice:           "bg-orange-50",
  visa:              "bg-blue-50",
  emirates_id:       "bg-violet-50",
  labor_card:        "bg-indigo-50",
  trade_license:     "bg-amber-50",
  payroll:           "bg-pink-50",
  insurance:         "bg-cyan-50",
  government_permit: "bg-red-50",
  other:             "bg-gray-100",
};

const TYPE_ICON_FG: Record<string, string> = {
  employee_contract: "#059669",
  client_contract:   "#0d9488",
  lease_contract:    "#ea580c",
  invoice:           "#ea580c",
  visa:              "#3b82f6",
  emirates_id:       "#7c3aed",
  labor_card:        "#4f46e5",
  trade_license:     "#d97706",
  payroll:           "#db2777",
  insurance:         "#0891b2",
  government_permit: "#dc2626",
  other:             "#6b7280",
};

function DocIcon({ docType }: { docType: string | null }) {
  const t = docType ?? "other";
  const bg = TYPE_ICON_BG[t] ?? TYPE_ICON_BG.other;
  const fg = TYPE_ICON_FG[t] ?? TYPE_ICON_FG.other;
  return (
    <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: fg }}>
        <path d="M3 2h7l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M10 2v4h4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M5 9h6M5 11.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default async function RecordsSidePanel() {
  const [recentDocs, allDocs, contractCount, peopleCount, unpaidInvoices, urgentDocs] = await Promise.all([
    prisma.document.findMany({
      where: { status: "extracted" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, filename: true, docType: true, parties: true, createdAt: true },
    }),
    prisma.document.count(),
    prisma.document.count({ where: { docType: { in: ["employee_contract", "client_contract"] } } }),
    prisma.person.count(),
    prisma.document.count({ where: { docType: "invoice", isPaid: false } }),
    prisma.document.count({
      where: {
        status: "extracted",
        expiryDate: { gt: new Date(), lte: new Date(Date.now() + 30 * 86400000) },
        docType: { notIn: ["invoice", "invoice_report"] },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">

      {/* Recent activity */}
      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
          <Link href="/records" className="text-xs text-gray-400 hover:text-gray-600">All</Link>
        </div>
        <div className="divide-y divide-[#EEEAE0]">
          {recentDocs.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-gray-400">No documents yet</p>
            </div>
          ) : recentDocs.map(doc => {
            const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
            const label = parties.length > 0 ? parties.join(", ") : doc.filename.replace(/\.[^.]+$/, "");
            const diff = Math.floor((Date.now() - doc.createdAt.getTime()) / 60000);
            const ago = diff < 60 ? `${diff}m ago` : diff < 1440 ? `${Math.floor(diff / 60)}h ago` : `${Math.floor(diff / 1440)}d ago`;
            return (
              <Link key={doc.id} href={`/records/${doc.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-hover transition-colors">
                <DocIcon docType={doc.docType} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{label}</p>
                  <p className="text-[10px] text-gray-400">{DOC_TYPE_LABELS[doc.docType ?? "other"] ?? doc.docType}</p>
                </div>
                <p className="text-[10px] text-gray-400 shrink-0 tabular-nums">{ago}</p>
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
            { label: "Total documents",  value: allDocs,         href: "/records" },
            { label: "Contracts",        value: contractCount,   href: "/records/contracts" },
            { label: "People tracked",   value: peopleCount,     href: "/people" },
            { label: "Unpaid invoices",  value: unpaidInvoices,  href: "/records/invoices" },
          ].map(({ label, value, href }) => (
            <Link key={label} href={href} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-hover transition-colors">
              <span className="text-xs text-gray-600">{label}</span>
              <span className="text-xs font-semibold text-gray-900">{value}</span>
            </Link>
          ))}
          {urgentDocs > 0 && (
            <Link href="/records" className="flex items-center justify-between px-4 py-2.5 bg-red-50/40 hover:bg-red-50/60 transition-colors">
              <span className="text-xs text-red-700 font-medium">Expiring in 30 days</span>
              <span className="text-xs font-semibold text-red-600">{urgentDocs}</span>
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

    </div>
  );
}
