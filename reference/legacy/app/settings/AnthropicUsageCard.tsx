"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  hasKey: boolean;
  keyPreview: string | null;
};

export default function AnthropicUsageCard({ hasKey, keyPreview }: Props) {
  const router = useRouter();
  const [adminKey, setAdminKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await fetch("/api/settings/anthropic-usage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminKey }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) {
      setSaveError(data.error ?? "Failed to save");
    } else {
      setAdminKey("");
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-surface-inset rounded-xl border border-surface-border">
        <div className={`w-2 h-2 rounded-full shrink-0 ${hasKey ? "bg-emerald-500" : "bg-amber-400"}`} />
        <span className="text-sm text-gray-700 font-medium">
          {hasKey ? "Admin key configured" : "Not configured"}
        </span>
        {hasKey && keyPreview && (
          <span className="text-xs text-gray-400 ml-1 font-mono">{keyPreview}</span>
        )}
      </div>

      {/* Admin key input */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Admin Key{" "}
          {hasKey && <span className="normal-case font-normal text-gray-400">(leave blank to keep current)</span>}
        </label>
        <input
          type="password"
          value={adminKey}
          onChange={e => setAdminKey(e.target.value)}
          placeholder={hasKey ? (keyPreview ?? "••••••••") : "sk-ant-admin-…"}
          className="w-full h-9 px-3 text-sm text-gray-900 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400 font-mono"
        />
        <p className="text-[11px] text-gray-400 mt-1">
          Admin keys start with{" "}
          <span className="font-mono">sk-ant-admin-</span> and are created in the{" "}
          <a
            href="https://console.anthropic.com/settings/admin-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-500 hover:text-indigo-700"
          >
            Anthropic Console
          </a>
        </p>
      </div>

      {saveError && (
        <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{saveError}</p>
      )}

      <button
        onClick={save}
        disabled={saving || !adminKey.trim()}
        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 rounded-lg transition-colors"
      >
        {saving ? "Saving…" : "Save key"}
      </button>

      {/* Credit balance callout */}
      <a
        href="https://console.anthropic.com/settings/billing"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between rounded-lg border border-orange-100 bg-orange-50 px-3 py-2.5 hover:bg-orange-100 transition-colors group"
      >
        <div>
          <p className="text-[10px] font-semibold text-orange-700 uppercase tracking-wide mb-0.5">Credit balance</p>
          <p className="text-xs text-orange-600">
            Balance is only visible in the Anthropic Console — click to open
          </p>
        </div>
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className="text-orange-400 group-hover:text-orange-600 flex-shrink-0 ml-3 transition-colors">
          <path d="M3 9L9 3M9 3H5M9 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </div>
  );
}
