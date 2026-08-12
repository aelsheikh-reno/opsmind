"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PartyChips from "../../components/PartyChips";
import DeleteButton from "../../components/DeleteButton";
import { formatDateTime } from "@/lib/format-date";

export type PurchaseOrderRow = {
  id: string;
  filename: string;
  parties: string | null;
  referenceNumber: string | null;
  source: string;
  status: string;
  createdAt: Date;
  issueDate: Date | null;
  expiryDate: Date | null;
  amount: number | null;
  currency: string | null;
  vatAmount: number | null;
  isPaid: boolean;
  paidAt: Date | null;
  notes: string | null;
  poStatus: string;
};

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open:     { bg: "bg-blue-50",   text: "text-blue-700",  label: "Open" },
  closed:   { bg: "bg-green-50",  text: "text-green-700", label: "Closed" },
  archived: { bg: "bg-gray-100",  text: "text-gray-500",  label: "Archived" },
};

function StatusBadge({ poStatus }: { poStatus: string }) {
  const s = STATUS_STYLES[poStatus] ?? STATUS_STYLES.open;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function InlineStatusSelect({
  id,
  poStatus,
  onChange,
  onSaved,
}: {
  id: string;
  poStatus: string;
  onChange: (newStatus: string) => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const s = STATUS_STYLES[poStatus] ?? STATUS_STYLES.open;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    const prevStatus = poStatus;
    setSaving(true);
    setSaveError(null);
    onChange(newStatus);
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poStatus: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error ?? "Failed to save");
        onChange(prevStatus);
      } else {
        onSaved();
      }
    } catch {
      setSaveError("Network error");
      onChange(prevStatus);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <select
        value={poStatus}
        onChange={handleChange}
        disabled={saving}
        className={`text-xs font-semibold px-2 py-0.5 rounded-full border-0 cursor-pointer focus:ring-1 focus:ring-gray-300 focus:outline-none appearance-none ${s.bg} ${s.text} disabled:opacity-60`}
      >
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="archived">Archived</option>
      </select>
      {saveError && <span className="text-[10px] text-red-500 leading-tight">{saveError}</span>}
    </div>
  );
}

export default function PurchaseOrdersTable({
  initialOrders,
  canWrite,
}: {
  initialOrders: PurchaseOrderRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const prevRef = useRef(initialOrders);

  useEffect(() => {
    if (prevRef.current !== initialOrders) {
      prevRef.current = initialOrders;
      setOrders(initialOrders);
    }
  }, [initialOrders]);

  function updateStatus(id: string, newStatus: string) {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, poStatus: newStatus } : o));
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 4h10l6 6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
            <path d="M8 10h8M8 14h5" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-700">No purchase orders match your filters</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
        <h2 className="text-sm font-semibold text-gray-900">All purchase orders</h2>
        <span className="text-xs text-gray-400">{orders.length} shown</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-surface-border bg-surface-inset">
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Vendor / Parties</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">PO Reference</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Uploaded</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Issue date</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Delivery date</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Amount</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">VAT</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Notes</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Status</th>
              {canWrite && <th className="px-5 py-3 w-8"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {orders.map((doc) => {
              const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
              const isOpen = doc.poStatus === "open";
              const isDone = doc.poStatus === "closed" || doc.poStatus === "archived";
              const isOverdue = isOpen && !!doc.expiryDate && daysUntil(doc.expiryDate) < 0;
              const isDueSoon = isOpen && !!doc.expiryDate && daysUntil(doc.expiryDate) >= 0 && daysUntil(doc.expiryDate) <= 30;
              return (
                <tr key={doc.id} className={`hover:bg-surface-hover transition-colors ${
                  isDone     ? "opacity-60" :
                  isOverdue  ? "bg-red-50/30" :
                  isDueSoon  ? "bg-orange-50/20" : ""
                }`}>
                  <td className="px-5 py-3">
                    {parties.length > 0
                      ? <PartyChips parties={parties} />
                      : <Link href={`/records/${doc.id}`} className="block text-gray-500 truncate max-w-44">{doc.filename}</Link>}
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/records/${doc.id}`} className="block font-mono text-xs text-gray-600">
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
                      {doc.issueDate ? new Date(doc.issueDate).toISOString().split("T")[0] : <span className="text-gray-300">—</span>}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/records/${doc.id}`} className="block">
                      {doc.expiryDate
                        ? <span className="text-xs text-gray-700">{new Date(doc.expiryDate).toISOString().split("T")[0]}</span>
                        : <span className="text-gray-300">—</span>}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    <Link href={`/records/${doc.id}`} className="block">
                      {doc.amount != null
                        ? <span className={`font-medium ${isDone ? "text-gray-400 line-through" : "text-gray-700"}`}>{doc.currency ?? ""} {doc.amount.toLocaleString("en-US")}</span>
                        : <span className="text-gray-300">—</span>}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    <Link href={`/records/${doc.id}`} className="block">
                      {doc.vatAmount != null
                        ? <span className="font-medium text-gray-600 tabular-nums">{doc.currency ?? ""} {doc.vatAmount.toLocaleString("en-US")}</span>
                        : <span className="text-gray-300">—</span>}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500 max-w-48">
                    <Link href={`/records/${doc.id}`} className="block truncate">
                      {doc.notes ?? <span className="text-gray-300">—</span>}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    {canWrite
                      ? <InlineStatusSelect id={doc.id} poStatus={doc.poStatus} onChange={s => updateStatus(doc.id, s)} onSaved={router.refresh} />
                      : <StatusBadge poStatus={doc.poStatus} />
                    }
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
  );
}
