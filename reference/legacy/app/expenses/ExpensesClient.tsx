"use client";

import { useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Expense, ExpenseAttachment, Person } from "@prisma/client";
import ExpensesChart from "./ExpensesChart";
import CreateExpenseModal from "./CreateExpenseModal";
import ClaimsAnalyzerModal from "./ClaimsAnalyzerModal";
import EditExpenseModal from "./EditExpenseModal";
import { AttachmentChips } from "@/app/components/AttachmentChips";
import { useActiveCurrencies } from "@/lib/useActiveCurrencies";

function SyncButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncFrom, setSyncFrom] = useState("");
  const [syncTo,   setSyncTo]   = useState("");

  async function handleSync() {
    setSyncing(true);
    const toastId = toast.loading("Syncing from Asana…");
    try {
      const body: Record<string, string> = {};
      if (syncFrom) body.from = syncFrom + "-01";
      if (syncTo)   body.to   = new Date(new Date(syncTo + "-01").getFullYear(), new Date(syncTo + "-01").getMonth() + 1, 0).toISOString().slice(0, 10);
      const res = await fetch("/api/settings/asana/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Sync failed", { id: toastId });
      } else {
        const synced: number = data.synced ?? 0;
        const extracted: number = data.extracted ?? 0;
        const deleted: number = data.deleted ?? 0;
        const parts: string[] = [];
        if (synced > 0) parts.push(`${synced} claim${synced !== 1 ? "s" : ""} synced`);
        if (extracted > 0) parts.push(`${extracted} amount${extracted !== 1 ? "s" : ""} extracted`);
        if (deleted > 0) parts.push(`${deleted} removed`);
        toast.success(parts.length > 0 ? parts.join(" · ") : "Nothing new to sync", { id: toastId });
        router.refresh();
        setOpen(false);
      }
    } catch {
      toast.error("Network error — sync failed", { id: toastId });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={syncing}
        className="flex items-center gap-2 text-sm font-semibold bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white px-3 py-2 rounded-lg transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={syncing ? "animate-spin" : ""}>
          <path d="M2 7a5 5 0 0 1 8.5-3.5L12 5M12 2v3H9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 7a5 5 0 0 1-8.5 3.5L2 9M2 12V9h3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Sync from Asana
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 3.5l3 3 3-3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-20 bg-white border border-surface-border rounded-xl shadow-lg p-4 space-y-3 min-w-[260px]">
          <p className="text-xs font-semibold text-gray-600">Date range</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-8 shrink-0">From</label>
              <input
                type="month"
                value={syncFrom}
                onChange={e => setSyncFrom(e.target.value)}
                className="flex-1 h-8 px-2 text-sm text-gray-700 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-8 shrink-0">To</label>
              <input
                type="month"
                value={syncTo}
                onChange={e => setSyncTo(e.target.value)}
                className="flex-1 h-8 px-2 text-sm text-gray-700 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">Leave blank to sync all claims.</p>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className={syncing ? "animate-spin" : ""}>
                <path d="M2 7a5 5 0 0 1 8.5-3.5L12 5M12 2v3H9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 7a5 5 0 0 1-8.5 3.5L2 9M2 12V9h3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 bg-surface-inset border border-surface-border rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ZohoSyncButton() {
  const router = useRouter();
  const [pulling, setPulling] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function handlePull() {
    setPulling(true);
    const toastId = toast.loading("Importing from Zoho Books…");
    try {
      const res = await fetch("/api/integrations/zoho/pull-expenses", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Import failed", { id: toastId });
      } else {
        const parts: string[] = [];
        if (data.imported > 0)              parts.push(`${data.imported} imported`);
        if (data.skippedAsanaDup > 0)       parts.push(`${data.skippedAsanaDup} duplicate`);
        if (data.skippedAlreadyTracked > 0) parts.push(`${data.skippedAlreadyTracked} already tracked`);
        if (data.skippedSalary > 0)         parts.push(`${data.skippedSalary} salary skipped`);
        toast.success(parts.length > 0 ? parts.join(" · ") : "Nothing new to import", { id: toastId });
        router.refresh();
      }
    } catch {
      toast.error("Network error — import failed", { id: toastId });
    } finally {
      setPulling(false);
    }
  }

  async function handleClear() {
    if (!confirm("Delete all Zoho-imported expenses? This cannot be undone.")) return;
    setClearing(true);
    const toastId = toast.loading("Clearing Zoho imports…");
    try {
      const res = await fetch("/api/integrations/zoho/pull-expenses", { method: "DELETE" });
      const data = await res.json();
      toast.success(`${data.deleted ?? 0} expenses removed`, { id: toastId });
      router.refresh();
    } catch {
      toast.error("Failed to clear", { id: toastId });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handlePull}
        disabled={pulling || clearing}
        className="flex items-center gap-2 text-sm font-semibold bg-[#E42527] hover:bg-red-700 disabled:bg-red-200 text-white px-3 py-2 rounded-lg transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
          <path d="M6 22L14 10h-7.5M12 10h13.5L17 22h8.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {pulling ? "Importing…" : "Sync from Zoho"}
      </button>
      <button
        onClick={handleClear}
        disabled={pulling || clearing}
        title="Clear Zoho-imported expenses"
        className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 rounded-lg border border-surface-border transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M2 3.5h10M5.5 3.5V2.5h3v1M5 3.5l.5 8M9 3.5l-.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}

type PersonStub = Pick<Person, "id" | "name" | "jobTitle">;
type ExpenseWithAttachments = Expense & {
  attachments: ExpenseAttachment[];
  person: PersonStub | null;
  budget: { name: string } | null;
};

type Totals = Record<string, { total: number; confirmed: number; count: number }>;

const KNOWN_TYPE_COLORS: Record<string, string> = {
  Supplies:          "#6366f1",
  Travel:            "#f59e0b",
  "Food & Beverage": "#f97316",
  SaaS:              "#14b8a6",
  Other:             "#9ca3af",
};

const TYPE_PALETTE = [
  "#a78bfa", "#ef4444", "#10b981", "#3b82f6", "#ec4899",
  "#06b6d4", "#84cc16", "#f43f5e", "#64748b", "#e879f9",
  "#fb923c", "#34d399", "#60a5fa", "#f472b6", "#22d3ee",
];

function typeColor(type: string): string {
  if (KNOWN_TYPE_COLORS[type]) return KNOWN_TYPE_COLORS[type];
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return TYPE_PALETTE[h % TYPE_PALETTE.length];
}

function typeBadgeStyle(type: string): React.CSSProperties {
  const c = typeColor(type);
  return { background: c + "18", color: c };
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-AE", { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount) + " " + currency;
}


function StatusToggle({ expense, onToggle }: { expense: ExpenseWithAttachments; onToggle: (id: string, val: boolean) => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [localCompleted, setLocalCompleted] = useState(expense.completed);

  // Sync when server sends fresh props after router.refresh()
  const prevCompleted = expense.completed;
  if (!loading && localCompleted !== prevCompleted) {
    setLocalCompleted(prevCompleted);
  }

  async function toggle() {
    const newValue = !localCompleted;
    setLocalCompleted(newValue);   // Optimistic — badge flips instantly
    onToggle(expense.id, newValue); // Notify parent so filters stay correct
    setLoading(true);
    await fetch(`/api/expenses/${expense.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: newValue }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={localCompleted ? "Mark as pending" : "Mark as completed"}
      className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full transition-all disabled:opacity-50 ${
        localCompleted
          ? "bg-green-100 text-green-700 hover:bg-green-200"
          : "bg-amber-50 text-amber-600 hover:bg-amber-100"
      }`}
    >
      {loading ? (
        <svg width="10" height="10" viewBox="0 0 10 10" className="animate-spin" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 5" />
        </svg>
      ) : localCompleted ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )}
      {localCompleted ? "Completed" : "Pending"}
    </button>
  );
}

function timeAgo(date: Date | string): string {
  const s = (Date.now() - new Date(date).getTime()) / 1000;
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function getInitials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map(n => n[0]).join("").toUpperCase();
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function payrollMonthOptions() {
  const now = new Date();
  const opts: { label: string; month: number; year: number }[] = [];
  for (let i = -3; i <= 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    opts.push({ label: `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`, month: d.getMonth() + 1, year: d.getFullYear() });
  }
  return opts;
}

type PaidMonth = { month: number; year: number };

function WebClaimCard({ expense, isAdmin, paidPayrollMonths }: { expense: ExpenseWithAttachments; isAdmin: boolean; paidPayrollMonths: PaidMonth[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");
  const [payrollSaving, setPayrollSaving] = useState(false);
  const payrollValue = expense.payrollMonth != null && expense.payrollYear != null
    ? `${expense.payrollYear}-${expense.payrollMonth}`
    : "";

  async function savePayrollMonth(val: string) {
    setPayrollSaving(true);
    const [year, month] = val ? val.split("-").map(Number) : [null, null];
    await fetch(`/api/expenses/${expense.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: expense.name, payrollMonth: month, payrollYear: year }),
    });
    setPayrollSaving(false);
    router.refresh();
  }

  async function act(status: "approved" | "rejected", noteText?: string) {
    setLoading(status === "approved" ? "approve" : "reject");
    await fetch(`/api/expenses/${expense.id}/claim-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note: noteText ?? undefined }),
    });
    setLoading(null);
    setRejectOpen(false);
    setNote("");
    router.refresh();
  }

  const claimStatus = (expense.claimStatus as string | null) ?? "pending";
  const displayName = expense.person?.name ?? expense.submitterEmail?.split("@")[0] ?? "Unknown";
  const initials = getInitials(displayName);
  const filename = expense.attachments[0]?.name ?? expense.name;
  const subtitle = expense.notes || filename;
  const amountStr = expense.amount != null && expense.currency
    ? `${expense.currency} ${expense.amount.toLocaleString("en-US")}`
    : null;
  const dateStr = expense.dueOn
    ? new Date(expense.dueOn).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const aiFilledBadge = expense.amount != null && expense.attachments.length > 0;

  return (
    <div className="px-4 py-4">
      {/* Row 1: avatar + name/file + amount */}
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-[10px] font-bold text-gray-600">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
            {amountStr && (
              <p className={`text-sm font-bold tabular-nums shrink-0 ${claimStatus === "approved" ? "text-gray-400" : "text-gray-900"}`}>
                {amountStr}
              </p>
            )}
          </div>
          <p className="text-xs text-gray-400 truncate">
            {subtitle} · {timeAgo(expense.createdAt)}
          </p>

          {/* Row 2: chips */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {expense.expenseType && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={typeBadgeStyle(expense.expenseType)}>
                {expense.expenseType}
              </span>
            )}
            {dateStr && (
              <span className="text-[10px] text-gray-400">{dateStr}</span>
            )}
            {aiFilledBadge && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1v3.5M5 5.5V9M1 5h3.5M5.5 5H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                AI filled
              </span>
            )}
            {expense.budget && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <path d="M1 3a.75.75 0 01.75-.75h2l.75 1H9a.75.75 0 01.75.75v4A.75.75 0 019 8.75H1.75A.75.75 0 011 8V3z" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
                {expense.budget.name}
              </span>
            )}
            {expense.completed && expense.payrollMonth != null && expense.payrollYear != null && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <rect x="1" y="2" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M3 1v2M7 1v2M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                {MONTH_SHORT[expense.payrollMonth - 1]} {expense.payrollYear}
              </span>
            )}
          </div>

          {/* Row 2b: attachments */}
          {expense.attachments.length > 0 && (
            <AttachmentChips attachments={expense.attachments} className="mt-2" />
          )}

          {/* Row 3: actions */}
          <div className="mt-3">
            {claimStatus === "approved" && (
              <div className="flex items-center justify-between gap-4 bg-green-50 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {expense.zohoExpenseId ? "Approved · synced to Zoho Books" : "Approved"}
                </div>
                {!expense.zohoExpenseId && <ZohoPushButton expense={expense} />}
              </div>
            )}

            {claimStatus === "rejected" && (
              <div className="flex items-center gap-1.5 text-xs font-medium bg-red-50 text-red-600 rounded-lg px-3 py-2" title={expense.claimNote ?? undefined}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Rejected{expense.claimNote ? ` — ${expense.claimNote}` : ""}
              </div>
            )}

            {claimStatus === "pending" && !rejectOpen && (
              <div className="flex gap-2">
                <button
                  onClick={() => setRejectOpen(true)}
                  disabled={!!loading}
                  className="text-xs font-medium border border-gray-200 text-gray-700 rounded-lg px-3.5 py-2 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Reject
                </button>
                <button
                  onClick={() => act("approved")}
                  disabled={!!loading}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg px-3.5 py-2 disabled:opacity-50 transition-colors"
                >
                  {loading === "approve" ? (
                    <svg width="11" height="11" viewBox="0 0 13 13" className="animate-spin" fill="none">
                      <circle cx="6.5" cy="6.5" r="5" stroke="white" strokeWidth="1.5" strokeDasharray="8 8" />
                    </svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {loading === "approve" ? "Approving…" : "Approve"}
                </button>
              </div>
            )}

            {claimStatus === "pending" && rejectOpen && (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Rejection note (optional)"
                  className="text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setRejectOpen(false)}
                    className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3.5 py-2 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => act("rejected", note || undefined)}
                    disabled={loading === "reject"}
                    className="text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg px-3.5 py-2 disabled:opacity-50 transition-colors"
                  >
                    {loading === "reject" ? "…" : "Confirm rejection"}
                  </button>
                </div>
              </div>
            )}

            {expense.personId && claimStatus !== "rejected" && !(expense.completed && expense.payrollMonth != null) && (
              <div className="flex items-center gap-2 px-1 mt-2">
                <span className="text-[10px] text-gray-400 shrink-0">Pay in payroll</span>
                {payrollSaving ? (
                  <div className="flex items-center gap-1.5 text-[10px] text-indigo-500">
                    <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
                    </svg>
                    Saving…
                  </div>
                ) : (
                  <select
                    value={payrollValue}
                    onChange={(e) => savePayrollMonth(e.target.value)}
                    className="flex-1 text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
                  >
                    <option value="">— Not assigned —</option>
                    {payrollMonthOptions().filter(o => !paidPayrollMonths.some(p => p.month === o.month && p.year === o.year)).map(o => (
                      <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {isAdmin && (
              <div className="mt-2 flex justify-end">
                <DeleteButton expense={expense} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WebClaimsPanel({ claims, isAdmin, paidPayrollMonths }: { claims: ExpenseWithAttachments[]; isAdmin: boolean; paidPayrollMonths: PaidMonth[] }) {
  const pendingCount = claims.filter(c => (c.claimStatus ?? "pending") === "pending").length;
  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-hidden mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Claims</h2>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded-full">
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <path d="M5 1.5 L7.5 8 L5 6.5 L2.5 8 Z" fill="currentColor" />
            </svg>
            AI
          </span>
        </div>
        {pendingCount > 0 && (
          <span className="text-xs text-gray-400">{pendingCount} to review</span>
        )}
      </div>
      {/* Cards */}
      <div className="divide-y divide-surface-border">
        {claims.map(claim => (
          <WebClaimCard key={claim.id} expense={claim} isAdmin={isAdmin} paidPayrollMonths={paidPayrollMonths} />
        ))}
      </div>
    </div>
  );
}

type PaidAccount = { account_id: string; account_name: string };

function ZohoPushButton({ expense }: { expense: ExpenseWithAttachments }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "selecting" | "pushing">("idle");
  const [accounts, setAccounts] = useState<PaidAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [error, setError] = useState("");

  if (expense.zohoExpenseId) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Synced to Zoho
      </span>
    );
  }

  async function openSelector() {
    setError("");
    setSelectedAccountId("");
    setLoadingAccounts(true);
    setStep("selecting");
    try {
      const res = await fetch("/api/integrations/zoho/paid-accounts");
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch {
      setError("Failed to load accounts");
      setStep("idle");
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function confirmPush() {
    setStep("pushing");
    setError("");
    try {
      const res = await fetch(`/api/integrations/zoho/push/${expense.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidThroughAccountId: selectedAccountId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Push failed");
        setStep("selecting");
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error");
      setStep("selecting");
    }
  }

  if (step === "selecting" || step === "pushing") {
    return (
      <div className="flex flex-col gap-1.5 min-w-[180px]">
        <p className="text-[9px] text-amber-500 uppercase tracking-wide font-semibold">Select paid-through account</p>
        {loadingAccounts ? (
          <p className="text-[10px] text-gray-400">Loading accounts…</p>
        ) : (
          <select
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
            className="text-[11px] border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
          >
            <option value="">— Choose account</option>
            {accounts.map(a => (
              <option key={a.account_id} value={a.account_id}>{a.account_name}</option>
            ))}
          </select>
        )}
        <div className="flex gap-1.5 items-center">
          <button
            onClick={confirmPush}
            disabled={!selectedAccountId || step === "pushing"}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#E42527] text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {step === "pushing" ? "Pushing…" : "Confirm Push"}
          </button>
          <button
            onClick={() => { setStep("idle"); setError(""); }}
            disabled={step === "pushing"}
            className="text-[10px] text-gray-400 hover:text-gray-600 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-[9px] text-red-500 leading-tight">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[9px] text-amber-500 uppercase tracking-wide font-semibold">Pending export</p>
      <button
        onClick={openSelector}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-[#E42527] text-white hover:bg-red-700 transition-colors shadow-sm"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path d="M3 11L7 5H3.5M6 5h7L9 11h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Push to Zoho Books
      </button>
      {error && <p className="text-[9px] text-red-500 leading-tight max-w-[140px]">{error}</p>}
    </div>
  );
}

function PayrollAssignRow({ expense, paidPayrollMonths }: { expense: ExpenseWithAttachments; paidPayrollMonths: PaidMonth[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const payrollValue = expense.payrollMonth != null && expense.payrollYear != null
    ? `${expense.payrollYear}-${expense.payrollMonth}`
    : "";

  async function save(val: string) {
    setSaving(true);
    const [year, month] = val ? val.split("-").map(Number) : [null, null];
    await fetch(`/api/expenses/${expense.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: expense.name, payrollMonth: month, payrollYear: year }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <tr>
      <td colSpan={9} className="px-4 pb-3 pt-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 shrink-0">Pay in payroll</span>
          {saving ? (
            <div className="flex items-center gap-1.5 text-[10px] text-indigo-500">
              <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
              </svg>
              Saving…
            </div>
          ) : (
            <select
              value={payrollValue}
              onChange={(e) => save(e.target.value)}
              className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
            >
              <option value="">— Not assigned —</option>
              {payrollMonthOptions()
                .filter(o => !paidPayrollMonths.some(p => p.month === o.month && p.year === o.year))
                .map(o => (
                  <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>
                ))}
            </select>
          )}
        </div>
      </td>
    </tr>
  );
}

function PersonSelector({ expense, persons }: { expense: ExpenseWithAttachments; persons: PersonStub[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function assign(personId: string | null) {
    setSaving(true);
    setOpen(false);
    await fetch(`/api/expenses/${expense.id}/person`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId }),
    });
    setSaving(false);
    router.refresh();
  }

  if (saving) {
    return <span className="text-[10px] text-gray-400">Saving…</span>;
  }

  if (!open) {
    return expense.person ? (
      <button
        onClick={() => setOpen(true)}
        className="flex flex-col items-start text-left group"
      >
        <span className="text-xs font-medium text-gray-800 group-hover:text-gray-700 transition-colors">{expense.person.name}</span>
        {expense.person.jobTitle && (
          <span className="text-[10px] text-gray-400">{expense.person.jobTitle}</span>
        )}
      </button>
    ) : (
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] text-gray-400 hover:text-gray-700 transition-colors"
      >
        — Assign claimant
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-[160px]">
      <div className="bg-white border border-surface-border rounded-lg shadow-sm overflow-hidden max-h-48 overflow-y-auto">
        {expense.person && (
          <button
            onClick={() => assign(null)}
            className="w-full text-left px-3 py-2 text-[10px] text-red-500 hover:bg-red-50 border-b border-gray-100 transition-colors"
          >
            Remove assignment
          </button>
        )}
        {persons.map(p => (
          <button
            key={p.id}
            onClick={() => assign(p.id)}
            className={`w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors ${p.id === expense.person?.id ? "bg-gray-100" : ""}`}
          >
            <p className={`text-[11px] font-medium ${p.id === expense.person?.id ? "text-gray-900 font-semibold" : "text-gray-800"}`}>{p.name}</p>
            {p.jobTitle && <p className="text-[10px] text-gray-400">{p.jobTitle}</p>}
          </button>
        ))}
      </div>
      <button onClick={() => setOpen(false)} className="text-[10px] text-gray-400 hover:text-gray-600 text-left">Cancel</button>
    </div>
  );
}

function AmountCell({ expense, rates, monthRates }: { expense: ExpenseWithAttachments; rates: Record<string, number>; monthRates: Record<string, Record<string, number>> }) {
  const router = useRouter();
  const activeCurrencies = useActiveCurrencies();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(expense.amount?.toString() ?? "");
  const [currency, setCurrency] = useState(expense.currency);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/expenses/${expense.id}/amount`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: value, currency }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          {activeCurrencies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0.00"
          className="w-24 text-xs border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-gray-400"
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        />
        <button onClick={save} disabled={saving} className="text-[10px] text-gray-700 font-medium hover:text-gray-900">
          {saving ? "…" : "Save"}
        </button>
        <button onClick={() => setEditing(false)} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
      </div>
    );
  }

  if (expense.amount == null) {
    return (
      <button onClick={() => setEditing(true)} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
        — Enter amount
      </button>
    );
  }

  const isNonUsd = expense.currency !== "USD";
  const monthKey = expenseMonthKey(expense);
  const effectiveRates = (monthKey && monthRates[monthKey]) ? monthRates[monthKey] : rates;
  const rate = isNonUsd ? effectiveRates[expense.currency] : null;
  const usdVal = isNonUsd && expense.amount != null && rate
    ? toUSD(expense.amount, expense.currency, effectiveRates)
    : null;

  const displayAmount = usdVal != null
    ? `$${usdVal.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : `$${expense.amount!.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-bold text-gray-900 tabular-nums">{displayAmount}</span>
        {expense.amountConfirmed ? (
          <span className="text-[9px] bg-green-100 text-green-700 px-1 py-0.5 rounded font-medium">confirmed</span>
        ) : (
          <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded font-medium">AI</span>
        )}
        <button onClick={() => setEditing(true)} className="text-[10px] text-gray-300 hover:text-gray-500 transition-colors">edit</button>
      </div>
      {usdVal != null && rate && (
        <div className="flex flex-col gap-px">
          <span className="text-[10px] text-gray-400 tabular-nums">{fmt(expense.amount!, expense.currency)}</span>
          <span className="text-[10px] text-gray-300 tabular-nums">1 USD = {rate.toFixed(2)} {expense.currency}</span>
        </div>
      )}
    </div>
  );
}

function DeleteButton({ expense }: { expense: ExpenseWithAttachments }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Claim deleted");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.error ?? "Delete failed");
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-500">Delete?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-[10px] font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
        >
          {deleting ? "…" : "Yes"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[10px] text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Delete claim"
      className="text-gray-300 hover:text-red-500 transition-colors p-0.5"
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
        <path d="M2 3.5h10M5.5 3.5V2.5h3v1M5 3.5l.5 8M9 3.5l-.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function toUSD(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  if (!rate) return amount;
  return amount / rate;
}

function expenseMonthKey(e: { dueOn: Date | null; asanaCreatedAt: Date | null }): string | null {
  const d = e.dueOn ?? e.asanaCreatedAt;
  if (!d) return null;
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function expenseToUsd(
  e: { amount: number | null; currency: string; dueOn: Date | null; asanaCreatedAt: Date | null },
  monthRates: Record<string, Record<string, number>>,
  liveRates: Record<string, number>,
): number {
  if (e.amount == null) return 0;
  if (e.currency === "USD") return e.amount;
  const key = expenseMonthKey(e);
  const rates = (key && monthRates[key]) ? monthRates[key] : liveRates;
  const rate = rates[e.currency];
  return rate ? e.amount / rate : 0;
}

type BudgetStub = { id: string; name: string; category: string | null };

export default function ExpensesClient({
  expenses,
  totals,
  rates,
  monthRates,
  persons,
  ratesSyncedAt,
  isAdmin = false,
  paidPayrollMonths = [],
  budgets = [],
}: {
  expenses: ExpenseWithAttachments[];
  totals: Totals;
  rates: Record<string, number>;
  monthRates: Record<string, Record<string, number>>;
  persons: PersonStub[];
  ratesSyncedAt: string | null;
  isAdmin?: boolean;
  paidPayrollMonths?: PaidMonth[];
  budgets?: BudgetStub[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "pending" | "completed" | "no-amount">("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"asana" | "manual" | "rejected">("asana");
  const [completedOverrides, setCompletedOverrides] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<"paid" | "unpaid" | "delete" | "budget" | "person" | "payroll" | null>(null);
  const [budgetPickerOpen, setBudgetPickerOpen] = useState(false);
  const [personPickerOpen, setPersonPickerOpen] = useState(false);
  const [payrollPickerOpen, setPayrollPickerOpen] = useState(false);
  const [textSearch, setTextSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");

  function handleToggle(id: string, val: boolean) {
    setCompletedOverrides(prev => ({ ...prev, [id]: val }));
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function selectGroup(ids: string[], on: boolean) {
    setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n; });
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (!confirm(`Delete ${ids.length} claim${ids.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkBusy("delete");
    try {
      const res = await fetch("/api/expenses/bulk-status", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        toast.success(`${ids.length} claim${ids.length !== 1 ? "s" : ""} deleted`);
        router.refresh();
      } else {
        toast.error("Bulk delete failed");
      }
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkSetPaid(completed: boolean) {
    const ids = Array.from(selectedIds);
    setBulkBusy(completed ? "paid" : "unpaid");
    try {
      const res = await fetch("/api/expenses/bulk-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, completed }),
      });
      if (res.ok) {
        const overrides: Record<string, boolean> = {};
        ids.forEach(id => { overrides[id] = completed; });
        setCompletedOverrides(prev => ({ ...prev, ...overrides }));
        setSelectedIds(new Set());
        toast.success(`${ids.length} claim${ids.length !== 1 ? "s" : ""} marked as ${completed ? "paid" : "unpaid"}`);
        router.refresh();
      } else {
        toast.error("Bulk update failed");
      }
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkAssignBudget(budgetId: string | null) {
    const ids = Array.from(selectedIds);
    setBulkBusy("budget");
    setBudgetPickerOpen(false);
    try {
      const res = await fetch("/api/expenses/bulk-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, budgetId }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        router.refresh();
      } else {
        toast.error("Budget assignment failed");
      }
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkAssignPerson(personId: string | null) {
    const ids = Array.from(selectedIds);
    setBulkBusy("person");
    setPersonPickerOpen(false);
    try {
      const res = await fetch("/api/expenses/bulk-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, personId }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        router.refresh();
      } else {
        toast.error("Claimant assignment failed");
      }
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkAssignPayroll(month: number | null, year: number | null) {
    const ids = Array.from(selectedIds);
    setBulkBusy("payroll");
    setPayrollPickerOpen(false);
    try {
      const res = await fetch("/api/expenses/bulk-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, payrollMonth: month, payrollYear: year }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        router.refresh();
      } else {
        toast.error("Payroll assignment failed");
      }
    } finally {
      setBulkBusy(null);
    }
  }

  const asanaExpenses    = expenses.filter(e => !!e.asanaTaskGid);
  const rejectedExpenses = expenses.filter(e => !e.asanaTaskGid && e.claimStatus === "rejected");
  const manualExpenses   = expenses.filter(e => !e.asanaTaskGid && e.claimStatus !== "rejected");

  const types = Array.from(new Set(expenses.map((e) => e.expenseType).filter(Boolean))) as string[];
  const availableYears = Array.from(new Set(expenses.map(e => {
    const d = e.dueOn ?? e.asanaCreatedAt;
    return d ? new Date(d).getFullYear() : null;
  }).filter(Boolean) as number[])).sort((a, b) => b - a);

  const MONTH_NAMES_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  function applyFilters(list: ExpenseWithAttachments[]) {
    const q = textSearch.trim().toLowerCase();
    return list.filter((e) => {
      const isCompleted = e.id in completedOverrides ? completedOverrides[e.id] : e.completed;
      if (filter === "pending"   && isCompleted)    return false;
      if (filter === "completed" && !isCompleted)   return false;
      if (filter === "no-amount" && e.amount != null) return false;
      if (typeFilter !== "all" && e.expenseType !== typeFilter) return false;
      if (q && !e.name.toLowerCase().includes(q) && !(e.notes ?? "").toLowerCase().includes(q)) return false;
      if (yearFilter !== "all" || monthFilter !== "all") {
        const d = e.dueOn ?? e.asanaCreatedAt;
        if (!d) return yearFilter === "all" && monthFilter === "all";
        const date = new Date(d);
        if (yearFilter !== "all" && String(date.getFullYear()) !== yearFilter) return false;
        if (monthFilter !== "all" && String(date.getMonth() + 1) !== monthFilter) return false;
      }
      return true;
    });
  }

  const filteredAsana    = applyFilters(asanaExpenses);
  const filteredManual   = applyFilters(manualExpenses);
  const filteredRejected = rejectedExpenses; // no status filter applies to rejected tab

  const needsAmount = expenses.filter((e) => e.amount == null && e.claimStatus !== "rejected").length;

  const activeExpenses  = expenses.filter(e => e.claimStatus !== "rejected");
  // Use Math.round per item so all totals match the sum of visible per-row amounts.
  const totalUsd        = activeExpenses.reduce((sum, e) => sum + Math.round(expenseToUsd(e, monthRates, rates)), 0);
  const asanaTotalUsd   = asanaExpenses.reduce((sum, e) => sum + Math.round(expenseToUsd(e, monthRates, rates)), 0);
  const manualTotalUsd  = manualExpenses.reduce((sum, e) => sum + Math.round(expenseToUsd(e, monthRates, rates)), 0);
  const rejectedTotalUsd = rejectedExpenses.reduce((sum, e) => sum + Math.round(expenseToUsd(e, monthRates, rates)), 0);

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Claims &amp; Expenses</h1>
          <p className="text-sm text-gray-400 mt-0.5">{expenses.length} total · Asana claims + company expenses</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {needsAmount > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2 rounded-lg">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3" />
                <path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              {needsAmount} missing amount
            </div>
          )}
          <ClaimsAnalyzerModal />
          <CreateExpenseModal />
          <ZohoSyncButton />
          <SyncButton />
        </div>
      </div>

      <ExpensesChart expenses={expenses} rates={rates} monthRates={monthRates} ratesSyncedAt={ratesSyncedAt} />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* Parent: Total in USD with currency breakdown inside */}
        <div className="bg-white border border-surface-border rounded-xl p-4 sm:col-span-2">
          <p className="text-xs text-gray-400 mb-1">Total expenses (USD)</p>
          <p className="text-2xl font-bold text-gray-900 mb-3">
            ${totalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(totals).map(([currency, data]) => {
              // Use historical-weighted USD: sum per-expense conversions
              const usd = currency === "USD"
                ? data.total
                : expenses
                    .filter(e => e.currency === currency && e.amount != null)
                    .reduce((s, e) => s + Math.round(expenseToUsd(e, monthRates, rates)), 0);
              return (
                <div key={currency} className="bg-surface-inset rounded-lg px-3 py-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{currency}</p>
                  <p className="text-sm font-semibold text-gray-900 tabular-nums mt-0.5">{fmt(data.total, currency)}</p>
                  {usd !== null && currency !== "USD" && (
                    <p className="text-[10px] text-gray-400 tabular-nums">≈ ${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-0.5">{data.count} item{data.count !== 1 ? "s" : ""}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: stat cards */}
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setFilter(filter === "pending" ? "all" : "pending")}
            className={`rounded-xl p-4 flex-1 text-left border transition-colors ${
              filter === "pending"
                ? "bg-gray-100 border-gray-300 ring-1 ring-gray-300"
                : "bg-white border-surface-border hover:bg-surface-hover"
            }`}
          >
            <p className="text-xs text-gray-400 mb-1">Pending review</p>
            <p className="text-lg font-semibold text-gray-900">{expenses.filter((e) => !e.completed).length}</p>
            <p className={`text-[11px] mt-1 ${filter === "pending" ? "text-gray-700 font-medium" : "text-gray-400"}`}>
              {filter === "pending" ? "filtered ↓" : "not yet completed"}
            </p>
          </button>
          <button
            onClick={() => setFilter(filter === "no-amount" ? "all" : "no-amount")}
            className={`rounded-xl p-4 flex-1 text-left border transition-colors ${
              filter === "no-amount"
                ? "bg-amber-50 border-amber-300 ring-1 ring-amber-300"
                : "bg-white border-surface-border hover:bg-surface-hover"
            }`}
          >
            <p className="text-xs text-gray-400 mb-1">No amount</p>
            <p className="text-lg font-semibold text-amber-600">{needsAmount}</p>
            <p className={`text-[11px] mt-1 ${filter === "no-amount" ? "text-amber-600 font-medium" : "text-gray-400"}`}>
              {filter === "no-amount" ? "filtered ↓" : "need manual entry"}
            </p>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="13" height="13" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M9.5 9.5l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          value={textSearch}
          onChange={e => setTextSearch(e.target.value)}
          placeholder="Search expenses and claims…"
          className="w-full h-9 pl-8 pr-3 text-sm text-gray-900 bg-white border border-surface-border rounded-xl outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
        />
        {textSearch && (
          <button onClick={() => setTextSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(["all", "pending", "completed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors capitalize ${
              filter === f
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-surface-border hover:bg-surface-hover"
            }`}
          >
            {f}
          </button>
        ))}
        <button
          onClick={() => setFilter(filter === "no-amount" ? "all" : "no-amount")}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            filter === "no-amount"
              ? "bg-amber-500 text-white border-amber-500"
              : "bg-white text-gray-600 border-surface-border hover:bg-surface-hover"
          }`}
        >
          No amount
        </button>
        <div className="w-px h-5 bg-surface-border mx-1" />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-xs border border-surface-border rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={yearFilter}
          onChange={e => { setYearFilter(e.target.value); setMonthFilter("all"); }}
          className="text-xs border border-surface-border rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          <option value="all">All years</option>
          {availableYears.map(y => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <select
          value={monthFilter}
          onChange={e => setMonthFilter(e.target.value)}
          className="text-xs border border-surface-border rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400"
        >
          <option value="all">All months</option>
          {MONTH_NAMES_FULL.map((m, i) => <option key={i + 1} value={String(i + 1)}>{m}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex items-stretch gap-0 mb-4 bg-white border border-surface-border rounded-xl overflow-hidden">
        {(
          [
            {
              key: "asana" as const,
              label: "Asana Claims",
              count: asanaExpenses.length,
              filteredCount: filteredAsana.length,
              totalUsd: asanaTotalUsd,
              icon: (
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <circle cx="7" cy="3.5" r="2" fill="currentColor" />
                  <circle cx="3" cy="10" r="2" fill="currentColor" />
                  <circle cx="11" cy="10" r="2" fill="currentColor" />
                </svg>
              ),
              activeClass: "bg-teal-50 text-teal-700 border-b-2 border-teal-500",
              inactiveClass: "text-gray-500 hover:bg-surface-hover",
            },
            {
              key: "manual" as const,
              label: "Company Expenses",
              count: manualExpenses.length,
              filteredCount: filteredManual.length,
              totalUsd: manualTotalUsd,
              icon: (
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
                  <path d="M4 5h6M4 7.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
              ),
              activeClass: "bg-gray-100 text-gray-900 border-b-2 border-gray-400",
              inactiveClass: "text-gray-500 hover:bg-surface-hover",
            },
            {
              key: "rejected" as const,
              label: "Rejected Claims",
              count: rejectedExpenses.length,
              filteredCount: filteredRejected.length,
              totalUsd: rejectedTotalUsd,
              icon: (
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              ),
              activeClass: "bg-red-50 text-red-700 border-b-2 border-red-400",
              inactiveClass: "text-gray-500 hover:bg-surface-hover",
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-between gap-3 px-5 py-3.5 transition-colors ${
              activeTab === tab.key ? tab.activeClass : tab.inactiveClass
            }`}
          >
            <div className="flex items-center gap-2">
              {tab.icon}
              <span className="text-sm font-semibold">{tab.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                activeTab === tab.key ? "bg-white/60" : "bg-surface-inset"
              }`}>
                {tab.count}
              </span>
            </div>
            <span className="text-sm font-bold tabular-nums text-gray-900">
              ${tab.totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
          </button>
        ))}
      </div>

      {/* Active tab content */}
      {(() => {
        const isAsana    = activeTab === "asana";
        const isRejected = activeTab === "rejected";
        const isManual   = !isAsana && !isRejected;

        // In the manual tab, web claims get their own card panel
        const webClaims       = isManual ? filteredManual.filter(e => !!e.submitterEmail) : [];
        const tableItems      = isAsana ? filteredAsana : isRejected ? filteredRejected : filteredManual.filter(e => !e.submitterEmail);
        const items           = isManual ? tableItems : (isAsana ? filteredAsana : filteredRejected);
        const emptyLabel = isAsana ? "No Asana claims match your filters" : isRejected ? "No rejected claims" : "No manual expenses match your filters";

        const monthKey = (e: ExpenseWithAttachments) => {
          const d = new Date((e.dueOn ?? e.asanaCreatedAt) as Date);
          if (isNaN(d.getTime())) return "unknown";
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        };
        const monthLabel = (k: string) => {
          if (k === "unknown") return "No date";
          const [y, m] = k.split("-");
          return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
        };
        const groups = new Map<string, ExpenseWithAttachments[]>();
        for (const e of items) {
          const k = monthKey(e);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(e);
        }
        // Stable sort within each group so toggling completed never shifts position
        for (const [k, g] of groups) {
          groups.set(k, [...g].sort((a, b) => {
            const ta = new Date(a.createdAt).getTime();
            const tb = new Date(b.createdAt).getTime();
            return tb !== ta ? tb - ta : a.id.localeCompare(b.id);
          }));
        }
        const sortedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

        if (items.length === 0 && webClaims.length === 0) {
          return (
            <div className="bg-white border border-surface-border rounded-xl px-4 py-10 text-center text-sm text-gray-400">
              {emptyLabel}
            </div>
          );
        }

        return (
          <div className="space-y-3">
            {webClaims.length > 0 && <WebClaimsPanel claims={webClaims} isAdmin={isAdmin} paidPayrollMonths={paidPayrollMonths} />}
            {sortedKeys.map((mk) => {
              const group = groups.get(mk)!;
              // Sum rounded integers so the total matches the visible per-row amounts.
              const monthTotalUsd = group.reduce((sum, e) => e.amount == null ? sum : sum + Math.round(expenseToUsd(e, monthRates, rates)), 0);
              const countWithAmount = group.filter(e => e.amount != null).length;
              return (
                <div key={mk} className="bg-white border border-surface-border rounded-xl [overflow:clip]">
                  <div className="sticky top-[52px] z-10 flex items-center justify-between px-4 py-2.5 bg-surface-inset border-b border-surface-border rounded-t-xl">
                    <div className="flex items-center gap-2.5">
                      {!isRejected && (() => {
                        const groupIds = group.map(e => e.id);
                        const allSelected = groupIds.every(id => selectedIds.has(id));
                        const someSelected = groupIds.some(id => selectedIds.has(id));
                        return (
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                            onChange={e => selectGroup(groupIds, e.target.checked)}
                            className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                          />
                        );
                      })()}
                      <p className="text-xs font-semibold text-gray-700">{monthLabel(mk)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-gray-400">{group.length} item{group.length !== 1 ? "s" : ""}</span>
                      <span className="text-sm font-bold text-gray-900 tabular-nums">
                        ${monthTotalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        {countWithAmount < group.length && <span className="text-[10px] text-amber-500 font-normal ml-1">partial</span>}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px]">
                      <thead>
                        <tr className="border-b border-surface-border">
                          {!isRejected && <th className="w-8 px-4 py-2.5" />}
                          <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5">Item</th>
                          <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5">Type</th>
                          <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5">Payment</th>
                          <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5">Amount</th>
                          <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5">Claimant</th>
                          <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5">Date</th>
                          <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5">Status</th>
                          <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5">Attachments</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-border">
                        {group.map((expense) => {
                          const showZohoBanner = (expense.completed || expense.claimStatus === "approved")
                            && expense.claimStatus !== "rejected"
                            && !expense.personId;
                          const zohoStatusLabel = expense.claimStatus === "approved" ? "Approved" : "Completed";
                          return (
                          <Fragment key={expense.id}>
                          <tr className="hover:bg-surface-inset/50 transition-colors">
                            {!isRejected && (
                              <td className="px-4 py-3 w-8">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(expense.id)}
                                  onChange={() => toggleSelect(expense.id)}
                                  className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                                />
                              </td>
                            )}
                            <td className="px-4 py-3">
                              <div className="flex items-start justify-between gap-1">
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-medium text-gray-800">{expense.name}</p>
                                    {expense.submitterEmail && !expense.asanaTaskGid && (
                                      <span className="text-[9px] font-medium text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0">Web Claim</span>
                                    )}
                                  </div>
                                  {expense.budget && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full mt-0.5">
                                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                        <path d="M1 3a.75.75 0 01.75-.75h2l.75 1H9a.75.75 0 01.75.75v4A.75.75 0 019 8.75H1.75A.75.75 0 011 8V3z" stroke="currentColor" strokeWidth="1.2"/>
                                      </svg>
                                      {expense.budget.name}
                                    </span>
                                  )}
                                  {expense.completed && expense.payrollMonth != null && expense.payrollYear != null && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full mt-0.5">
                                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                        <rect x="1" y="2" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                                        <path d="M3 1v2M7 1v2M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                                      </svg>
                                      {MONTH_SHORT[expense.payrollMonth - 1]} {expense.payrollYear}
                                    </span>
                                  )}
                                  {expense.submitterEmail && (
                                    <p className="text-[10px] text-gray-400">{expense.submitterEmail}</p>
                                  )}
                                </div>
                                {!isAsana && !isRejected && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <EditExpenseModal expense={expense} budgets={budgets} />
                                    {isAdmin && <DeleteButton expense={expense} />}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {expense.expenseType ? (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={typeBadgeStyle(expense.expenseType)}>
                                  {expense.expenseType}
                                </span>
                              ) : (
                                <span className="text-[10px] text-gray-300">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs text-gray-600">{expense.paymentMethod ?? "—"}</span>
                            </td>
                            <td className="px-4 py-3">
                              <AmountCell expense={expense} rates={rates} monthRates={monthRates} />
                            </td>
                            <td className="px-4 py-3">
                              <PersonSelector expense={expense} persons={persons} />
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs text-gray-500">
                                {expense.dueOn
                                  ? new Date(expense.dueOn).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                                  : expense.asanaCreatedAt
                                  ? new Date(expense.asanaCreatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                                  : "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1.5">
                                {!(expense.submitterEmail && !expense.asanaTaskGid && expense.claimStatus === "rejected") && (
                                  <StatusToggle expense={expense} onToggle={handleToggle} />
                                )}
                                {expense.submitterEmail && !expense.asanaTaskGid && expense.claimStatus === "rejected" && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600" title={expense.claimNote ?? undefined}>
                                    Rejected{expense.claimNote ? ` — ${expense.claimNote}` : ""}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {expense.attachments.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {expense.attachments.map((att) => (
                                    <a
                                      key={att.id}
                                      href={`/api/expenses/attachments/${att.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[10px] text-gray-600 hover:text-gray-900 underline truncate max-w-[120px]"
                                      title={att.name}
                                    >
                                      {att.name}
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10px] text-gray-300">None</span>
                              )}
                            </td>
                          </tr>
                          {showZohoBanner && (
                            <tr>
                              <td colSpan={9} className="px-4 pb-3 pt-0">
                                <div className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2.5">
                                  <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    {zohoStatusLabel}
                                  </div>
                                  <ZohoPushButton expense={expense} />
                                </div>
                              </td>
                            </tr>
                          )}
                          {expense.personId && !((expense.id in completedOverrides ? completedOverrides[expense.id] : expense.completed) && expense.payrollMonth != null) && (
                            <PayrollAssignRow expense={expense} paidPayrollMonths={paidPayrollMonths} />
                          )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-2xl">
          <span className="text-sm font-medium tabular-nums">{selectedIds.size} selected</span>
          <div className="w-px h-4 bg-white/20" />
          <button
            onClick={() => bulkSetPaid(true)}
            disabled={bulkBusy !== null}
            className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-50 transition-colors"
          >
            {bulkBusy === "paid" ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg> : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            {bulkBusy === "paid" ? "Saving…" : "Mark paid"}
          </button>
          <button
            onClick={() => bulkSetPaid(false)}
            disabled={bulkBusy !== null}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-300 hover:text-white disabled:opacity-50 transition-colors"
          >
            {bulkBusy === "unpaid" ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg> : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>}
            {bulkBusy === "unpaid" ? "Saving…" : "Mark unpaid"}
          </button>
          <button
            onClick={bulkDelete}
            disabled={bulkBusy !== null}
            className="flex items-center gap-1.5 text-sm font-semibold text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
          >
            {bulkBusy === "delete" ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg> : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 3h10M5.5 3V2h3v1M5 3l.5 8.5M9 3l-.5 8.5M3 3l.5 9h7l.5-9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            {bulkBusy === "delete" ? "Deleting…" : "Delete"}
          </button>
          {budgets.length > 0 && (
            <>
              <div className="w-px h-4 bg-white/20" />
              <div className="relative">
                <button
                  onClick={() => { setBudgetPickerOpen(v => !v); setPersonPickerOpen(false); setPayrollPickerOpen(false); }}
                  disabled={bulkBusy !== null}
                  className="flex items-center gap-1.5 text-sm font-semibold text-blue-300 hover:text-blue-200 disabled:opacity-50 transition-colors"
                >
                  {bulkBusy === "budget"
                    ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg>
                    : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M1 4a1 1 0 011-1h2.5l1 1.5H12a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>}
                  {bulkBusy === "budget" ? "Saving…" : "Assign budget"}
                  {bulkBusy !== "budget" && <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 4l3-3 3 3M2 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
                {budgetPickerOpen && (
                  <div className="absolute bottom-full mb-3 left-0 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 min-w-[200px] z-10">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-3 pb-1.5">Select budget</p>
                    <div className="max-h-52 overflow-y-auto">
                      {budgets.map(b => (
                        <button
                          key={b.id}
                          onClick={() => bulkAssignBudget(b.id)}
                          className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-baseline gap-2"
                        >
                          <span className="font-medium">{b.name}</span>
                          {b.category && <span className="text-[11px] text-gray-400 shrink-0">{b.category}</span>}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-gray-100 mt-1 pt-1">
                      <button
                        onClick={() => bulkAssignBudget(null)}
                        className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 transition-colors"
                      >
                        Remove from budget
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="w-px h-4 bg-white/20" />
          {/* Assign claimant */}
          {persons.length > 0 && (
            <div className="relative">
              <button
                onClick={() => { setPersonPickerOpen(v => !v); setPayrollPickerOpen(false); setBudgetPickerOpen(false); }}
                disabled={bulkBusy !== null}
                className="flex items-center gap-1.5 text-sm font-semibold text-violet-300 hover:text-violet-200 disabled:opacity-50 transition-colors"
              >
                {bulkBusy === "person"
                  ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M1 12c0-2.5 2-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>}
                {bulkBusy === "person" ? "Saving…" : "Assign claimant"}
                {bulkBusy !== "person" && <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 4l3-3 3 3M2 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </button>
              {personPickerOpen && (
                <div className="absolute bottom-full mb-3 left-0 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 min-w-[200px] z-10">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-3 pb-1.5">Select person</p>
                  <div className="max-h-52 overflow-y-auto">
                    {persons.map(p => (
                      <button
                        key={p.id}
                        onClick={() => bulkAssignPerson(p.id)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-violet-50 hover:text-violet-700 transition-colors flex flex-col"
                      >
                        <span className="font-medium">{p.name}</span>
                        {p.jobTitle && <span className="text-[11px] text-gray-400">{p.jobTitle}</span>}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <button
                      onClick={() => bulkAssignPerson(null)}
                      className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 transition-colors"
                    >
                      Remove claimant
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Assign payroll month */}
          <div className="relative">
            <button
              onClick={() => { setPayrollPickerOpen(v => !v); setPersonPickerOpen(false); setBudgetPickerOpen(false); }}
              disabled={bulkBusy !== null}
              className="flex items-center gap-1.5 text-sm font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-50 transition-colors"
            >
              {bulkBusy === "payroll"
                ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/></svg>
                : <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M1.5 6h11M5 1.5V4M9 1.5V4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>}
              {bulkBusy === "payroll" ? "Saving…" : "Payroll month"}
              {bulkBusy !== "payroll" && <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 4l3-3 3 3M2 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
            {payrollPickerOpen && (
              <div className="absolute bottom-full mb-3 left-0 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 min-w-[180px] z-10">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-3 pb-1.5">Pay in payroll</p>
                <div className="max-h-52 overflow-y-auto">
                  {payrollMonthOptions()
                    .filter(o => !paidPayrollMonths.some(p => p.month === o.month && p.year === o.year))
                    .map(o => (
                      <button
                        key={`${o.year}-${o.month}`}
                        onClick={() => bulkAssignPayroll(o.month, o.year)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-amber-50 hover:text-amber-700 transition-colors font-medium"
                      >
                        {o.label}
                      </button>
                    ))}
                </div>
                <div className="border-t border-gray-100 mt-1 pt-1">
                  <button
                    onClick={() => bulkAssignPayroll(null, null)}
                    className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 transition-colors"
                  >
                    Remove payroll assignment
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-white/20" />
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
