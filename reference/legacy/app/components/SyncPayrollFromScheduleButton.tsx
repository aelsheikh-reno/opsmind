"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncPayrollFromScheduleButton({ personId }: { personId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/people/${personId}/sync-payroll-from-schedule`, { method: "POST" });
      const data = await res.json() as { synced?: number; error?: string };
      if (res.ok) {
        setResult(data.synced === 0 ? "Already in sync" : `${data.synced} month${data.synced === 1 ? "" : "s"} updated`);
        router.refresh();
      } else {
        setResult(data.error ?? "Sync failed");
      }
    } catch {
      setResult("Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span className="text-xs text-gray-400">{result}</span>
      )}
      <button
        onClick={handleSync}
        disabled={loading}
        title="Update payroll entries to match the contract payment schedule"
        className="flex items-center gap-1 text-xs font-medium text-indigo-500 hover:text-indigo-700 disabled:opacity-40 transition-colors"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          className={loading ? "animate-spin" : ""}
        >
          <path d="M2 6a4 4 0 1 1 .8 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M2 9V6.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {loading ? "Syncing…" : "Sync from schedule"}
      </button>
    </div>
  );
}
