"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// UAE is UTC+4 — options shown in UAE time, stored as UTC hour
const DIGEST_TIME_OPTIONS = [
  { label: "6:00 AM UAE",  utcHour: 2  },
  { label: "7:00 AM UAE",  utcHour: 3  },
  { label: "8:00 AM UAE",  utcHour: 4  },
  { label: "9:00 AM UAE",  utcHour: 5  },
  { label: "10:00 AM UAE", utcHour: 6  },
  { label: "11:00 AM UAE", utcHour: 7  },
  { label: "12:00 PM UAE", utcHour: 8  },
];

type Props = {
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  currentFromEmail: string | null;
  currentDigestHourUtc: number;
  currentPayslipCc: string;
};

export default function EmailConfigSection({ hasApiKey, apiKeyPreview, currentFromEmail, currentDigestHourUtc, currentPayslipCc }: Props) {
  const router = useRouter();
  const [apiKey, setApiKey]         = useState("");
  const [fromEmail, setFromEmail]   = useState(currentFromEmail ?? "");
  const [digestHour, setDigestHour] = useState(currentDigestHourUtc);
  const [payslipCc, setPayslipCc]   = useState(currentPayslipCc);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [saved, setSaved]           = useState(false);

  async function save() {
    setError(null);
    setSaved(false);

    if (!fromEmail.trim()) { setError("From email address is required"); return; }
    if (!/^.+<[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(fromEmail.trim()) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail.trim())) {
      setError("Enter a valid email address, e.g. OpsMind <noreply@yourdomain.com>"); return;
    }

    setSaving(true);
    try {
      const ops: Promise<Response>[] = [
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "claimFromEmail", value: fromEmail.trim() }),
        }),
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "digestHourUtc", value: String(digestHour) }),
        }),
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "payslipCcEmails", value: payslipCc.trim() }),
        }),
      ];
      if (apiKey.trim()) {
        ops.push(fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "resendApiKey", value: apiKey.trim() }),
        }));
      }
      const results = await Promise.all(ops);
      const failed  = results.find(r => !r.ok);
      if (failed) { setError("Failed to save — please try again"); return; }
      setApiKey("");
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  const selectedOption = DIGEST_TIME_OPTIONS.find(o => o.utcHour === digestHour) ?? DIGEST_TIME_OPTIONS[2];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Email configuration</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Resend API key, sender address, and daily digest send time. Changes take effect immediately — no redeploy needed.
        </p>
      </div>

      {/* Status row */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-surface-inset rounded-xl border border-surface-border">
        <div className={`w-2 h-2 rounded-full shrink-0 ${hasApiKey ? "bg-emerald-500" : "bg-amber-400"}`} />
        <span className="text-sm text-gray-700 font-medium">
          {hasApiKey ? "API key configured" : "No API key — emails will fail"}
        </span>
        {hasApiKey && apiKeyPreview && (
          <span className="text-xs text-gray-400 ml-1 font-mono">{apiKeyPreview}</span>
        )}
        <span className="ml-auto text-xs text-gray-400">
          Daily digest sends at <span className="font-medium text-gray-600">{selectedOption.label}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {/* Resend API key */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Resend API key{" "}
            {hasApiKey && <span className="normal-case font-normal text-gray-400">(leave blank to keep current)</span>}
          </label>
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={hasApiKey ? (apiKeyPreview ?? "re_••••••••") : "re_xxxxxxxxxxxxxxxx"}
            className="w-full h-9 px-3 text-sm text-gray-900 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400 font-mono"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Get your key from{" "}
            <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-700">
              resend.com/api-keys
            </a>
            {" "}— the sending domain must be verified in your Resend account.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* From address */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              From address
            </label>
            <input
              type="text"
              value={fromEmail}
              onChange={e => setFromEmail(e.target.value)}
              placeholder="OpsMind <noreply@yourdomain.com>"
              className="w-full h-9 px-3 text-sm text-gray-900 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Domain must be verified in Resend.
            </p>
          </div>

          {/* Digest send time */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Daily digest time
            </label>
            <select
              value={digestHour}
              onChange={e => setDigestHour(parseInt(e.target.value))}
              className="w-full h-9 px-3 text-sm text-gray-900 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors"
            >
              {DIGEST_TIME_OPTIONS.map(o => (
                <option key={o.utcHour} value={o.utcHour}>{o.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              All times are UAE (UTC+4).
            </p>
          </div>
        </div>

        {/* Payslip CC */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Payslip CC
          </label>
          <input
            type="text"
            value={payslipCc}
            onChange={e => setPayslipCc(e.target.value)}
            placeholder="hr@company.com, finance@company.com"
            className="w-full h-9 px-3 text-sm text-gray-900 bg-white border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Comma-separated. These addresses will be CC'd on every payslip email.
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
      {saved && <p className="text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">Email settings saved.</p>}

      <button
        onClick={save}
        disabled={saving}
        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 rounded-lg transition-colors"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
