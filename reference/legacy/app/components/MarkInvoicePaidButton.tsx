"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function MarkInvoicePaidButton({
  documentId,
  isPaid,
  variant = "detail",
}: {
  documentId: string;
  isPaid: boolean;
  variant?: "detail" | "row";
}) {
  const [loading, setLoading] = useState(false);
  const [optimistic, setOptimistic] = useState(isPaid);
  const router = useRouter();

  async function toggle() {
    setLoading(true);
    setOptimistic(!optimistic);
    const res = await fetch(`/api/documents/${documentId}/paid`, { method: "PATCH" });
    if (res.ok) {
      const data = await res.json();
      setOptimistic(data.isPaid);
      if (data.isPaid && data.closedPOs?.length > 0) {
        for (const po of data.closedPOs as { id: string; filename: string }[]) {
          toast.success(`Purchase Order closed: ${po.filename}`, {
            description: "All linked invoices are paid — PO automatically closed.",
            duration: 6000,
          });
        }
      }
      router.refresh();
    } else {
      setOptimistic(optimistic); // revert on error
    }
    setLoading(false);
  }

  if (variant === "row") {
    return (
      <button
        onClick={e => { e.preventDefault(); toggle(); }}
        disabled={loading}
        title={optimistic ? "Mark as unpaid" : "Mark as paid"}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          optimistic
            ? "bg-green-500 border-green-500"
            : "border-gray-300 hover:border-green-400 bg-white"
        } ${loading ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
      >
        {optimistic && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    );
  }

  // detail variant — full button
  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        loading ? "opacity-50 cursor-wait" :
        optimistic
          ? "bg-green-50 hover:bg-green-100 text-green-700 border border-green-200"
          : "bg-gray-900 hover:bg-gray-800 text-white"
      }`}
    >
      {optimistic ? (
        <>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M3 7l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Paid
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path d="M7 4.5v1.5m0 2.5V10m-1.5-2.5h2.5a.75.75 0 0 0 0-1.5H5.75a.75.75 0 0 1 0-1.5H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Mark as paid
        </>
      )}
    </button>
  );
}
