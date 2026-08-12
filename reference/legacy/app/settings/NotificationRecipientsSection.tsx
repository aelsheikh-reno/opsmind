"use client";

import { useState, useEffect } from "react";

type Recipient = {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
};

function utcHourToUaeLabel(utcHour: number): string {
  const uaeHour = (utcHour + 4) % 24;
  const h12     = uaeHour % 12 || 12;
  const ampm    = uaeHour < 12 ? "AM" : "PM";
  return `${String(h12).padStart(2, "0")}:00 ${ampm}`;
}

export default function NotificationRecipientsSection({
  initial,
  digestHourUtc = 4,
}: {
  initial: Recipient[];
  digestHourUtc?: number;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>(initial);
  const [email, setEmail]   = useState("");
  const [name, setName]     = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError]   = useState("");
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [previewHtml, setPreviewHtml]       = useState<string | null>(null);
  const [previewCount, setPreviewCount]     = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  useEffect(() => { loadPreview(); }, []);

  async function loadPreview() {
    setPreviewLoading(true);
    try {
      const res  = await fetch("/api/cron/expiry-reminders/preview");
      const data = await res.json();
      setPreviewHtml(data.html ?? null);
      setPreviewCount(data.itemCount ?? 0);
    } catch {
      setPreviewHtml(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function add() {
    setError("");
    if (!email.trim()) { setError("Email is required"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError("Enter a valid email address"); return; }
    setAdding(true);
    try {
      const res = await fetch("/api/settings/notification-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      if (res.status === 409) { setError("This email is already added"); return; }
      if (!res.ok) { setError("Failed to add recipient"); return; }
      const r: Recipient = await res.json();
      setRecipients(prev => [...prev, r]);
      setEmail(""); setName("");
    } finally {
      setAdding(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/cron/expiry-reminders?days=90");
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ ok: false, message: data.error ?? "Request failed" });
      } else if (data.sent) {
        setTestResult({ ok: true, message: `Sent to ${data.recipients?.join(", ")} — ${data.itemCount} item${data.itemCount !== 1 ? "s" : ""} found` });
      } else {
        setTestResult({ ok: true, message: `No items found in the next 90 days — email not sent` });
      }
      loadPreview();
    } catch {
      setTestResult({ ok: false, message: "Network error" });
    } finally {
      setTesting(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    const res = await fetch(`/api/settings/notification-recipients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (res.ok) {
      setRecipients(prev => prev.map(r => r.id === id ? { ...r, active } : r));
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/settings/notification-recipients/${id}`, { method: "DELETE" });
    if (res.ok) setRecipients(prev => prev.filter(r => r.id !== id));
  }

  return (
    <div className="flex gap-6 items-start">
      {/* ── Left: controls ── */}
      <div className="flex-1 min-w-0 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Notification recipients</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Daily digest emails for expiring documents, due invoices, and upcoming liabilities are sent to all active recipients.
            </p>
          </div>
          <button
            onClick={sendTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-surface-border rounded-lg text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 shrink-0"
          >
            {testing ? (
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="7 7" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1l10 5-10 5V7.5l7-1.5-7-1.5V1z" fill="currentColor" />
              </svg>
            )}
            {testing ? "Sending…" : "Send test email"}
          </button>
        </div>

        {testResult && (
          <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs ${
            testResult.ok
              ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
              : "bg-red-50 border border-red-200 text-red-700"
          }`}>
            <span className="mt-0.5 shrink-0">{testResult.ok ? "✓" : "✗"}</span>
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Recipient list */}
        {recipients.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No recipients configured yet.</p>
        ) : (
          <div className="divide-y divide-surface-border border border-surface-border rounded-xl overflow-hidden">
            {recipients.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${r.active ? "bg-emerald-400" : "bg-gray-300"}`} />
                  <div className="min-w-0">
                    {r.name && <p className="text-sm font-medium text-gray-800 truncate">{r.name}</p>}
                    <p className="text-xs text-gray-500 truncate">{r.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggle(r.id, !r.active)}
                    className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                      r.active
                        ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {r.active ? "Active" : "Paused"}
                  </button>
                  <button
                    onClick={() => remove(r.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors p-1"
                    aria-label="Remove"
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        <div className="border border-surface-border rounded-xl p-4 bg-surface-inset space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add recipient</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email address *</label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && add()}
                placeholder="user@company.com"
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && add()}
                placeholder="Mohamed"
                className="w-full text-sm border border-surface-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={add}
            disabled={adding}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {adding ? "Adding…" : "Add recipient"}
          </button>
        </div>
      </div>

      {/* ── Right: email preview ── */}
      <div className="w-[480px] shrink-0">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Today&apos;s digest preview
          </p>
          {!previewLoading && previewCount !== null && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              previewCount === 0
                ? "bg-gray-100 text-gray-400"
                : "bg-amber-50 text-amber-700 border border-amber-200"
            }`}>
              {previewCount === 0 ? "Nothing due" : `${previewCount} item${previewCount !== 1 ? "s" : ""}`}
            </span>
          )}
        </div>

        <div className="border border-surface-border rounded-xl overflow-hidden bg-surface-inset" style={{ height: 560 }}>
          {previewLoading ? (
            <div className="flex items-center justify-center h-full gap-2 text-xs text-gray-400">
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 8" />
              </svg>
              Loading preview…
            </div>
          ) : previewHtml ? (
            <iframe
              srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#f3f4f6}</style></head><body>${previewHtml}</body></html>`}
              sandbox="allow-same-origin"
              className="w-full h-full border-0"
              title="Email digest preview"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="14" stroke="#d1d5db" strokeWidth="1.5" fill="none" />
                <path d="M16 10v7M16 20v2" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <p className="text-sm font-medium text-gray-400">No items due in the next 90 days</p>
              <p className="text-xs text-gray-300">When documents expire or payments are due, the digest will appear here.</p>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-2">
          This is exactly what gets sent every morning at {utcHourToUaeLabel(digestHourUtc)} UAE time.
        </p>
      </div>
    </div>
  );
}
