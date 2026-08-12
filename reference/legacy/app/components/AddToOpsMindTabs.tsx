"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import UploadZone from "./UploadZone";
import GoogleDriveSync from "../integrations/google-drive/GoogleDriveSync";
import BulkAnalyzeModal from "../records/invoices/BulkAnalyzeModal";
import { useUploadContext } from "@/app/contexts/UploadContext";
import { DocumentDetailsPanel } from "./ExtractionPreviewPanel";

// ── Tab definitions ────────────────────────────────────────────────────────────

type TabId = "upload" | "google-drive" | "manual" | "email" | "whatsapp" | "onedrive" | "dropbox";

const TABS: {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  soon?: boolean;
}[] = [
  {
    id: "upload",
    label: "Upload",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M7.5 10V2M4 5l3.5-3.5L11 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 11v1a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "google-drive",
    label: "Google Drive",
    icon: (
      <svg width="15" height="15" viewBox="0 0 87.3 78" fill="none">
        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
        <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47" />
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335" />
        <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
        <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
        <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
      </svg>
    ),
  },
  {
    id: "manual",
    label: "Manual entry",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="2" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M5 5.5h5M5 8h5M5 10.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "email",
    label: "Email",
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <rect x="1" y="3" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M1 5l6.5 4L14 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    soon: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <circle cx="7.5" cy="7.5" r="6.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="M7.5 3.5a4 4 0 013.5 6l.5 2-2-.5A4 4 0 117.5 3.5z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "onedrive",
    label: "OneDrive",
    soon: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M1.5 10a3 3 0 013-3 3 3 0 015.5-1.5A2.5 2.5 0 0113.5 8a2.5 2.5 0 000 5H3.5a2 2 0 01-2-3z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "dropbox",
    label: "Dropbox",
    soon: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M4 2L7.5 4.5 4 7 .5 4.5 4 2zM11 2L14.5 4.5 11 7 7.5 4.5 11 2z" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
        <path d="M.5 10L4 7.5 7.5 10 4 12.5.5 10zM7.5 10L11 7.5 14.5 10 11 12.5 7.5 10z" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
      </svg>
    ),
  },
];

// ── Coming-soon placeholder ────────────────────────────────────────────────────

const SOON_DETAILS: Record<string, { description: string; detail: string }> = {
  email: {
    description: "Forward any email with an attachment to a dedicated capture address.",
    detail: "OpsMind will parse the attachment, extract fields with AI, and add it to your records automatically.",
  },
  whatsapp: {
    description: "Send or forward documents to a dedicated WhatsApp number.",
    detail: "Works with PDFs, images, and voice notes. Ideal for documents received on mobile.",
  },
  onedrive: {
    description: "Watch a OneDrive or SharePoint folder and auto-import new files.",
    detail: "Connects via Microsoft OAuth. New files dropped in the folder are ingested on a schedule.",
  },
  dropbox: {
    description: "Watch a Dropbox folder and sync new documents automatically.",
    detail: "Connect your Dropbox account, select a folder, and OpsMind handles the rest.",
  },
};

function ComingSoon({ id, label }: { id: string; label: string }) {
  const info = SOON_DETAILS[id];
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="w-12 h-12 rounded-2xl bg-surface-inset border border-surface-border flex items-center justify-center mb-4">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="9" stroke="#d1d5db" strokeWidth="1.5" />
          <path d="M11 7v5M11 15v.5" stroke="#d1d5db" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-gray-500">{label} — coming soon</p>
      {info && (
        <>
          <p className="text-sm text-gray-400 mt-2 max-w-sm leading-relaxed">{info.description}</p>
          <p className="text-xs text-gray-300 mt-2 max-w-sm leading-relaxed">{info.detail}</p>
        </>
      )}
    </div>
  );
}

// ── Email inbound ─────────────────────────────────────────────────────────────

const INBOUND_ADDRESS = process.env.NEXT_PUBLIC_POSTMARK_INBOUND_ADDRESS ?? "";

function EmailInboundContent() {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!INBOUND_ADDRESS) return;
    navigator.clipboard.writeText(INBOUND_ADDRESS).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="py-8 px-8 flex flex-col items-center gap-6 max-w-xl mx-auto">
      {/* Icon */}
      <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="#6366f1" strokeWidth="1.5" fill="none" />
          <path d="M3 8l9 6 9-6" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      {/* Heading */}
      <div className="text-center">
        <p className="text-sm font-semibold text-gray-900">Forward emails to OpsMind</p>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Forward any email — an invoice, contract, renewal notice — to your dedicated address below.
          OpsMind will extract the details and create a draft record for you to review.
        </p>
      </div>

      {/* Address box */}
      {INBOUND_ADDRESS ? (
        <div className="w-full flex items-center gap-2 bg-surface-inset border border-surface-border rounded-xl px-4 py-3">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-gray-400 shrink-0">
            <rect x="1" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <path d="M1 5.5l6 4 6-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="flex-1 text-sm font-mono text-gray-700 truncate">{INBOUND_ADDRESS}</span>
          <button
            onClick={copy}
            className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors px-2 py-1 rounded-lg hover:bg-indigo-50"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      ) : (
        <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
          Set <code className="font-mono">NEXT_PUBLIC_POSTMARK_INBOUND_ADDRESS</code> in your <code className="font-mono">.env.local</code> to display your inbound address here.
        </div>
      )}

      {/* Steps */}
      <ol className="w-full space-y-3">
        {[
          { n: "1", text: "Copy your OpsMind inbound address above." },
          { n: "2", text: "Open any email you want to capture — an invoice, contract notice, renewal reminder." },
          { n: "3", text: "Forward it to that address. Attachments (PDFs, images) are included automatically." },
          { n: "4", text: "OpsMind analyses the email with AI and creates a draft record. Go to Records to review and confirm it." },
        ].map(step => (
          <li key={step.n} className="flex items-start gap-3">
            <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-[11px] font-bold flex items-center justify-center mt-0.5">
              {step.n}
            </span>
            <span className="text-sm text-gray-600 leading-relaxed">{step.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Manual entry card ──────────────────────────────────────────────────────────

function ManualEntryContent() {
  return (
    <div className="py-8 flex flex-col items-center gap-6">
      <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="3" width="16" height="19" rx="2.5" stroke="#6366f1" strokeWidth="1.5" fill="none" />
          <path d="M8 8h8M8 12h8M8 16h5" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-center max-w-sm">
        <p className="text-sm font-semibold text-gray-900">Create a record manually</p>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Fill in a form to add a contract, license, or document without uploading a file.
          All fields are optional — add what you have.
        </p>
      </div>
      <Link
        href="/records/new"
        className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M6.5 1.5v10M1.5 6.5h10" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        Create record
      </Link>
    </div>
  );
}

// ── Main tabs component ────────────────────────────────────────────────────────

export default function AddToOpsMindTabs({ canSettings = false }: { canSettings?: boolean }) {
  const [active, setActive] = useState<TabId>("upload");
  const { queue } = useUploadContext();

  const visibleTabs = TABS.filter(t => t.id !== "google-drive" || canSettings);
  const activeTab = visibleTabs.find(t => t.id === active) ?? visibleTabs[0];

  const previewItem = queue.find(
    (i): i is typeof i & { state: Extract<typeof i.state, { status: "preview" }> } =>
      i.state.status === "preview"
  ) ?? null;

  const tabsPanel = (
    <div className={previewItem ? "w-[480px] shrink-0" : "max-w-3xl"}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 flex-wrap border-b border-surface-border pb-0 mb-0">
        {visibleTabs.map(tab => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`
                relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors rounded-t-lg
                ${isActive
                  ? "text-gray-900 bg-white border border-b-white border-surface-border -mb-px z-10"
                  : tab.soon
                    ? "text-gray-300 hover:text-gray-400"
                    : "text-gray-500 hover:text-gray-700 hover:bg-surface-inset"
                }
              `}
            >
              <span className={isActive ? "text-indigo-600" : ""}>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.soon && (
                <span className="text-[9px] font-bold text-gray-300 bg-gray-100 px-1 py-0.5 rounded-full leading-none">
                  SOON
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="bg-white border border-t-0 border-surface-border rounded-b-xl min-h-[400px]">
        {active === "upload" && (
          <div className="p-5 space-y-4">
            <UploadZone />

            {/* Bulk invoice option */}
            {!previewItem && (
              <div className="flex items-start gap-4 border border-surface-border rounded-xl p-4 bg-surface-inset">
                <div className="w-9 h-9 rounded-lg bg-white border border-surface-border flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <rect x="3" y="5" width="13" height="11" rx="1.5" stroke="#9ca3af" strokeWidth="1.3" fill="none" />
                    <rect x="1" y="3" width="13" height="11" rx="1.5" stroke="#9ca3af" strokeWidth="1.3" fill="white" />
                    <path d="M4 7h7M4 9.5h7M4 12h4" stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">Bulk invoice upload</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                    Upload multiple invoice PDFs at once. AI extracts data from each, then you review and choose what to save.
                  </p>
                  <div className="mt-3">
                    <BulkAnalyzeModal />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {active === "google-drive" && (
          <div className="p-5">
            <Suspense fallback={
              <div className="flex items-center gap-2 text-sm text-gray-400 py-8">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Loading…
              </div>
            }>
              <GoogleDriveSync />
            </Suspense>
          </div>
        )}
        {active === "manual" && <ManualEntryContent />}
        {active === "email" && <EmailInboundContent />}
        {activeTab.soon && <ComingSoon id={active} label={activeTab.label} />}
      </div>
    </div>
  );

  return previewItem ? (
    <div className="flex gap-6 items-start">
      {tabsPanel}
      <div className="flex-1 min-w-0 sticky top-4">
        <DocumentDetailsPanel item={previewItem} />
      </div>
    </div>
  ) : tabsPanel;
}
