"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PaidAccount = { account_id: string; account_name: string };
type Vendor = { contact_id: string; contact_name: string };

export default function PayrollZohoPushButton({
  entryId,
  zohoExpenseId,
  hidden,
  bankingFee,
  bankingFeeCurrency,
  currency = "USD",
  activeCurrencies = [],
}: {
  entryId: string;
  zohoExpenseId: string | null | undefined;
  hidden?: boolean;
  bankingFee?: number | null;
  bankingFeeCurrency?: string | null;
  currency?: string;
  activeCurrencies?: string[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "selecting" | "pushing">("idle");
  const [accounts, setAccounts] = useState<PaidAccount[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [feeAmount, setFeeAmount] = useState(bankingFee ? bankingFee.toString() : "");
  const [feeCurrency, setFeeCurrency] = useState(bankingFeeCurrency ?? currency);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [canForce, setCanForce] = useState(false);

  if (hidden) return null;

  async function handleDelete(force = false) {
    setDeleting(true);
    try {
      const url = `/api/payroll/push-zoho/${entryId}${force ? "?force=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        router.refresh();
      } else {
        setError(data.error ?? "Delete failed");
        setCanForce(!!data.canForce);
        if (force) setConfirmDelete(false);
      }
    } finally {
      setDeleting(false);
    }
  }

  if (zohoExpenseId) {
    if (confirmDelete) {
      return (
        <div className="flex flex-col gap-1 mt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500">Remove from Zoho?</span>
            <button
              onClick={() => handleDelete(false)}
              disabled={deleting}
              className="text-[10px] font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              {deleting ? "…" : "Yes, delete"}
            </button>
            <button
              onClick={() => { setConfirmDelete(false); setCanForce(false); setError(""); }}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
          {error && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-red-500 leading-snug">{error}</span>
              {canForce && (
                <button
                  onClick={() => handleDelete(true)}
                  disabled={deleting}
                  className="self-start text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 px-2 py-0.5 rounded-md disabled:opacity-50 transition-colors"
                  title="Unlink from OpsMind without deleting the record in Zoho Books"
                >
                  {deleting ? "Unlinking…" : "Force unlink (keep in Zoho)"}
                </button>
              )}
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 mt-0.5 group">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Synced to Zoho
        </span>
        <button
          onClick={() => { setConfirmDelete(true); setError(""); }}
          className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-300 hover:text-red-500 transition-all"
          title="Delete from Zoho"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M2 2.5h8M4.5 2.5V1.5h3v1M4 2.5l.5 7M8 2.5l-.5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    );
  }

  async function openSelector() {
    setError("");
    setSelectedAccountId("");
    setSelectedVendorId("");
    setFeeAmount(bankingFee ? bankingFee.toString() : "");
    setFeeCurrency(bankingFeeCurrency ?? currency);
    setLoadingAccounts(true);
    setStep("selecting");
    try {
      const [acctRes, vendorRes] = await Promise.all([
        fetch("/api/integrations/zoho/paid-accounts"),
        fetch("/api/integrations/zoho/vendors"),
      ]);
      const [acctData, vendorData] = await Promise.all([acctRes.json(), vendorRes.json()]);
      setAccounts(acctData.accounts ?? []);
      setVendors(vendorData.vendors ?? []);
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
      const parsedFee = feeAmount ? parseFloat(feeAmount) : 0;
      const res = await fetch(`/api/payroll/push-zoho/${entryId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paidThroughAccountId: selectedAccountId || undefined,
          vendorId:             selectedVendorId  || undefined,
          bankingFee:           parsedFee > 0 ? parsedFee : 0,
          bankingFeeCurrency:   feeCurrency || currency,
        }),
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
    const isPushing = step === "pushing" && !error;
    return (
      <div className="flex flex-col gap-1.5 mt-1">
        {loadingAccounts ? (
          <p className="text-[10px] text-gray-400">Loading…</p>
        ) : (
          <>
            <select
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              disabled={isPushing}
              className="text-[11px] border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 max-w-[180px] disabled:opacity-50"
            >
              <option value="">— Paid-through account</option>
              {accounts.map(a => (
                <option key={a.account_id} value={a.account_id}>{a.account_name}</option>
              ))}
            </select>
            <select
              value={selectedVendorId}
              onChange={e => setSelectedVendorId(e.target.value)}
              disabled={isPushing}
              className="text-[11px] border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 max-w-[180px] disabled:opacity-50"
            >
              <option value="">— Vendor (optional)</option>
              {vendors.map(v => (
                <option key={v.contact_id} value={v.contact_id}>{v.contact_name}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={feeAmount}
                onChange={e => setFeeAmount(e.target.value)}
                disabled={isPushing}
                placeholder="Bank fee (optional)"
                min="0"
                step="any"
                className="text-[11px] border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 w-[130px] disabled:opacity-50 placeholder:text-gray-300"
              />
              <select
                value={feeCurrency}
                onChange={e => setFeeCurrency(e.target.value)}
                disabled={isPushing}
                className="text-[11px] border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 disabled:opacity-50"
              >
                {(activeCurrencies.length > 0 ? activeCurrencies : [currency]).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="flex gap-1.5 items-center">
          <button
            onClick={confirmPush}
            disabled={!selectedAccountId || isPushing}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#E42527] text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPushing ? "Pushing…" : "Confirm"}
          </button>
          <button
            onClick={() => { setStep("idle"); setError(""); }}
            className="text-[10px] text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-[10px] text-red-500 leading-tight">{error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={openSelector}
      className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 hover:text-red-600 transition-colors px-1.5 py-1 rounded hover:bg-red-50"
      title="Push salary to Zoho Books"
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <path d="M3 11L7 5H3.5M6 5h7L9 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Push to Zoho
    </button>
  );
}
