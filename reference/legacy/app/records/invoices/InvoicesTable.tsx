"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import PartyChips from "../../components/PartyChips";
import MarkInvoicePaidButton from "../../components/MarkInvoicePaidButton";
import DeleteButton from "../../components/DeleteButton";
import EditInvoiceButton, { InvoicePatch } from "../../components/EditInvoiceButton";
import AttachInvoiceFileButton from "../../components/AttachInvoiceFileButton";
import EditPaidDateButton from "../../components/EditPaidDateButton";
import EntityPicker from "../../components/EntityPicker";
import { formatDateTime } from "@/lib/format-date";

export type InvoiceRow = {
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
  filePath: string | null;
  legalEntityId: string | null;
  legalEntityName: string | null;
};

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function SourceChip({ source }: { source: string }) {
  if (source === "manual")
    return <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">Manual</span>;
  if (source === "extracted")
    return <span className="text-[10px] font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">From report</span>;
  return <span className="text-[10px] font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">Uploaded</span>;
}

function StatusChip({ doc }: { doc: { isPaid: boolean; expiryDate: Date | null } }) {
  if (doc.isPaid) {
    return <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Paid</span>;
  }
  if (!doc.expiryDate) {
    return <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Unpaid</span>;
  }
  const days = daysUntil(doc.expiryDate);
  if (days < 0)   return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Overdue</span>;
  if (days <= 7)  return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Due in {days}d</span>;
  if (days <= 30) return <span className="text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">Due in {days}d</span>;
  return <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Due in {days}d</span>;
}

export default function InvoicesTable({
  initialInvoices,
  canWrite,
}: {
  initialInvoices: InvoiceRow[];
  canWrite: boolean;
}) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const prevRef = useRef(initialInvoices);
  const [sortKey, setSortKey] = useState<"issueDate" | "expiryDate" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: "issueDate" | "expiryDate") {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = sortKey
    ? [...invoices].sort((a, b) => {
        const av = a[sortKey] ? new Date(a[sortKey]!).getTime() : (sortDir === "asc" ? Infinity : -Infinity);
        const bv = b[sortKey] ? new Date(b[sortKey]!).getTime() : (sortDir === "asc" ? Infinity : -Infinity);
        return sortDir === "asc" ? av - bv : bv - av;
      })
    : invoices;

  // Sync when the server re-renders (e.g. after delete or paid-toggle refresh)
  useEffect(() => {
    if (prevRef.current !== initialInvoices) {
      prevRef.current = initialInvoices;
      setInvoices(initialInvoices);
    }
  }, [initialInvoices]);

  function handleUpdate(id: string, patch: InvoicePatch) {
    setInvoices(prev =>
      prev.map(inv =>
        inv.id === id ? { ...inv, ...patch } : inv
      )
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-surface-inset border border-gray-200 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 4h10l6 6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="#9ca3af" strokeWidth="1.5" fill="none" />
            <path d="M8 10h8M8 14h5" stroke="#9ca3af" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-700">No invoices match your filters</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-border">
        <h2 className="text-sm font-semibold text-gray-900">All invoices</h2>
        <span className="text-xs text-gray-400">{invoices.length} shown</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-surface-border bg-surface-inset">
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3 w-8"></th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Vendor / Parties</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Entity</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Reference</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Source</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Uploaded</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">
                <button onClick={() => toggleSort("issueDate")} className="flex items-center gap-1 hover:text-gray-700 transition-colors uppercase tracking-wide">
                  Invoice date
                  <span className="text-gray-300">{sortKey === "issueDate" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                </button>
              </th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">
                <button onClick={() => toggleSort("expiryDate")} className="flex items-center gap-1 hover:text-gray-700 transition-colors uppercase tracking-wide">
                  Due date
                  <span className="text-gray-300">{sortKey === "expiryDate" ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                </button>
              </th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Amount</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">VAT</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Paid date</th>
              <th className="text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide px-5 py-3">Status</th>
              {canWrite && <th className="px-5 py-3 w-8"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {sorted.map((doc) => {
              const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
              const isOverdue = !doc.isPaid && doc.expiryDate && daysUntil(doc.expiryDate) < 0;
              const isDueSoon = !doc.isPaid && doc.expiryDate && daysUntil(doc.expiryDate) >= 0 && daysUntil(doc.expiryDate) <= 30;
              return (
                <tr key={doc.id} className={`hover:bg-surface-hover transition-colors ${
                  doc.isPaid ? "opacity-60" :
                  isOverdue  ? "bg-red-50/30" :
                  isDueSoon  ? "bg-orange-50/20" : ""
                }`}>
                  <td className="px-5 py-3">
                    {canWrite && <MarkInvoicePaidButton documentId={doc.id} isPaid={doc.isPaid} variant="row" />}
                  </td>
                  <td className="px-5 py-3">
                    {parties.length > 0
                      ? <PartyChips parties={parties} />
                      : <Link href={`/records/${doc.id}`} className="block text-gray-500 truncate max-w-44">{doc.filename}</Link>}
                  </td>
                  <td className="px-5 py-3">
                    {canWrite
                      ? <EntityPicker documentId={doc.id} currentEntityId={doc.legalEntityId} currentEntityName={doc.legalEntityName} />
                      : doc.legalEntityName
                        ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-600 bg-gray-100 border border-surface-border px-2 py-0.5 rounded-full whitespace-nowrap">{doc.legalEntityName}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/records/${doc.id}`} className="block font-mono text-xs text-gray-600">
                      {doc.referenceNumber ?? <span className="text-gray-300 font-sans">—</span>}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <SourceChip source={doc.source} />
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
                        ? <span className={`font-medium ${doc.isPaid ? "text-gray-400 line-through" : "text-gray-700"}`}>{doc.currency ?? ""} {doc.amount.toLocaleString("en-US")}</span>
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
                  <td className="px-5 py-3">
                    {doc.isPaid
                      ? canWrite
                        ? <EditPaidDateButton documentId={doc.id} paidAt={doc.paidAt ? new Date(doc.paidAt).toISOString().split("T")[0] : null} />
                        : <span className="text-xs text-gray-600">{doc.paidAt ? new Date(doc.paidAt).toISOString().split("T")[0] : "—"}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <StatusChip doc={doc} />
                  </td>
                  {canWrite && (
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-0.5">
                        {doc.source === "manual" && (
                          <>
                            <EditInvoiceButton
                              documentId={doc.id}
                              vendor={parties[0] ?? ""}
                              referenceNumber={doc.referenceNumber}
                              issueDate={doc.issueDate ? new Date(doc.issueDate).toISOString() : null}
                              expiryDate={doc.expiryDate ? new Date(doc.expiryDate).toISOString() : null}
                              amount={doc.amount}
                              currency={doc.currency}
                              notes={doc.notes}
                              onUpdate={(patch) => handleUpdate(doc.id, patch)}
                            />
                            {!doc.filePath && (
                              <AttachInvoiceFileButton documentId={doc.id} />
                            )}
                          </>
                        )}
                        <DeleteButton documentId={doc.id} variant="icon" />
                      </div>
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
