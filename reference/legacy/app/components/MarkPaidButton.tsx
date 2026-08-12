"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MarkPaidButton({
  scheduleId,
  isPaid,
}: {
  scheduleId: string;
  isPaid: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function toggle() {
    setLoading(true);
    await fetch(`/api/payment-schedule/${scheduleId}`, { method: "PATCH" });
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={isPaid ? "Mark as unpaid" : "Mark as paid"}
      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
        isPaid
          ? "bg-green-500 border-green-500"
          : "border-gray-300 hover:border-green-400 bg-white"
      } ${loading ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
    >
      {isPaid && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
