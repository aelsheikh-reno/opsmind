"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function PayrollEntryPaidToggle({
  entryId,
  isPaid,
  currency,
  currencies,
  hidden,
}: {
  entryId: string;
  isPaid: boolean;
  currency?: string;
  currencies?: string[];
  hidden?: boolean;
}) {
  if (hidden) return null;

  const [paid, setPaid] = useState(isPaid);
  const [loading, setLoading] = useState(false);
  const [showFeeDialog, setShowFeeDialog] = useState(false);
  const [feeInput, setFeeInput] = useState("");
  const [feeCurrency, setFeeCurrency] = useState(currency ?? "AED");
  const feeInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const currencyList = currencies?.length ? currencies : [currency ?? "AED", "USD"].filter((v, i, a) => a.indexOf(v) === i);

  useEffect(() => { setPaid(isPaid); }, [isPaid]);
  useEffect(() => { setFeeCurrency(currency ?? "AED"); }, [currency]);

  useEffect(() => {
    if (showFeeDialog) feeInputRef.current?.focus();
  }, [showFeeDialog]);

  async function markPaid(bankingFee: number | null, bankingFeeCurrency: string | null) {
    setLoading(true);
    setShowFeeDialog(false);
    setPaid(true);
    const params = new URLSearchParams({ entryId, paid: "true" });
    if (bankingFee !== null) {
      params.set("bankingFee", String(bankingFee));
      if (bankingFeeCurrency) params.set("bankingFeeCurrency", bankingFeeCurrency);
    }
    const res = await fetch(`/api/payroll/entry?${params}`, { method: "PATCH" });
    if (!res.ok) setPaid(false);
    else router.refresh();
    setLoading(false);
  }

  async function markUnpaid() {
    if (loading) return;
    setLoading(true);
    setPaid(false);
    const res = await fetch(`/api/payroll/entry?entryId=${entryId}&paid=false`, { method: "PATCH" });
    if (!res.ok) setPaid(true);
    else router.refresh();
    setLoading(false);
  }

  function handleToggleClick() {
    if (loading) return;
    if (paid) {
      markUnpaid();
    } else {
      setFeeInput("");
      setFeeCurrency(currency ?? "AED");
      setShowFeeDialog(true);
    }
  }

  function handleFeeKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") confirmWithFee();
    if (e.key === "Escape") setShowFeeDialog(false);
  }

  function confirmWithFee() {
    const fee = parseFloat(feeInput);
    markPaid(
      isNaN(fee) || fee <= 0 ? null : fee,
      isNaN(fee) || fee <= 0 ? null : feeCurrency,
    );
  }

  return (
    <div className="relative flex items-center">
      <button
        onClick={handleToggleClick}
        disabled={loading}
        title={paid ? "Mark as unpaid" : "Mark as paid"}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          paid
            ? "bg-green-500 border-green-500"
            : "border-gray-300 hover:border-green-400 bg-white"
        } ${loading ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
      >
        {paid && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {showFeeDialog && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowFeeDialog(false)}
          />
          <div className="absolute left-7 top-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-60">
            <p className="text-xs font-medium text-gray-700 mb-1">Bank transfer fee</p>
            <p className="text-xs text-gray-400 mb-2">Optional — logged as transaction cost</p>
            <div className="flex items-center gap-1 mb-3">
              <select
                value={feeCurrency}
                onChange={e => setFeeCurrency(e.target.value)}
                className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-400 bg-white"
              >
                {currencyList.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                ref={feeInputRef}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={feeInput}
                onChange={e => setFeeInput(e.target.value)}
                onKeyDown={handleFeeKeyDown}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => markPaid(null, null)}
                className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded text-gray-600 hover:bg-gray-50"
              >
                Skip
              </button>
              <button
                onClick={confirmWithFee}
                className="flex-1 text-xs px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Confirm
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
