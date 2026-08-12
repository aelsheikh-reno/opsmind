"use client";

import { useState } from "react";

export default function WhatsappSection({ initialPhone }: { initialPhone: string }) {
  const [phone, setPhone]     = useState(initialPhone);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError]     = useState<string | null>(null);

  async function save() {
    const val = phone.trim();
    if (!val) return;
    if (!/^\+\d{7,15}$/.test(val)) {
      setError("Enter a valid international number, e.g. +971501234567");
      return;
    }
    setError(null);
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "whatsappPhone", value: val }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function sendTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/settings/whatsapp/test", { method: "POST" });
      const data = await res.json();
      setTestMsg(res.ok ? { ok: true, text: "Test message sent!" } : { ok: false, text: data.error ?? "Failed to send" });
    } catch {
      setTestMsg({ ok: false, text: "Network error" });
    }
    setTesting(false);
    setTimeout(() => setTestMsg(null), 6000);
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-4">
        Renewal and payment reminders will be sent to this WhatsApp number 90, 30, 7, and 1 day before each deadline.
        Use international format including country code.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="tel"
          value={phone}
          onChange={e => { setPhone(e.target.value); setSaved(false); setError(null); }}
          onKeyDown={e => e.key === "Enter" && save()}
          placeholder="+971501234567"
          className="w-52 h-9 px-3 text-sm text-gray-900 bg-surface-inset border border-surface-border rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400 font-mono"
        />
        <button
          onClick={save}
          disabled={!phone.trim() || saving}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !phone.trim()
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : saving
              ? "bg-indigo-400 text-white cursor-wait"
              : "bg-indigo-600 hover:bg-indigo-700 text-white"
          }`}
        >
          {saving ? (
            <>
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
              </svg>
              Saving…
            </>
          ) : "Save"}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-700 font-medium">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7l2.5 2.5L11 4" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Saved
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {initialPhone && (
        <div className="mt-4 pt-4 border-t border-surface-border flex items-center gap-3">
          <button
            onClick={sendTest}
            disabled={testing}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              testing
                ? "border-gray-200 text-gray-400 bg-surface-inset cursor-wait"
                : "border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
            }`}
          >
            {testing ? (
              <>
                <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
                </svg>
                Sending…
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8l5 5L14 3" stroke="#15803d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Send test message
              </>
            )}
          </button>
          {testMsg && (
            <span className={`text-xs font-medium ${testMsg.ok ? "text-green-700" : "text-red-600"}`}>
              {testMsg.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
