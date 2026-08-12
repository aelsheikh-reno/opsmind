"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

export default function PayslipCurrencyToggle({
  personId,
  currency,
  initialValue,
}: {
  personId: string;
  currency: string;
  initialValue: boolean;
}) {
  const [enabled, setEnabled] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const res = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payslipInContractCurrency: next }),
      });
      if (!res.ok) {
        setEnabled(!next);
        toast.error("Failed to save preference");
      }
    });
  }

  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-border">
      <span className="text-[11px] text-gray-400">
        Payslips in {currency}
      </span>
      <button
        onClick={toggle}
        disabled={pending}
        title={enabled ? `Payslips will show salary in ${currency}` : "Payslips show totals in USD (default)"}
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
          enabled ? "bg-indigo-500" : "bg-gray-200"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
