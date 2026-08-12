"use client";

import { useState } from "react";

function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"].includes(ext);
}

function Lightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative max-w-[92vw] max-h-[92vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs text-white/60 truncate max-w-[70vw]">{name}</span>
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-white/60 hover:text-white text-xs transition-colors ml-4"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Close
          </button>
        </div>
        {!loaded && (
          <div className="flex items-center justify-center w-64 h-48">
            <svg className="animate-spin text-white/40" width="28" height="28" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.3"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          onLoad={() => setLoaded(true)}
          className={`max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0 absolute inset-0"}`}
        />
      </div>
    </div>
  );
}

export function AttachmentChips({
  attachments,
  className = "",
}: {
  attachments: { id: string; name: string }[];
  className?: string;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState<string>("");

  if (attachments.length === 0) return null;

  function open(att: { id: string; name: string }) {
    const url = `/api/expenses/attachments/${att.id}`;
    if (isImageFile(att.name)) {
      setLightboxName(att.name);
      setLightboxUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <>
      {lightboxUrl && (
        <Lightbox url={lightboxUrl} name={lightboxName} onClose={() => setLightboxUrl(null)} />
      )}
      <div className={`flex flex-wrap gap-1.5 ${className}`}>
        {attachments.map(att => {
          const isImage = isImageFile(att.name);
          return (
            <button
              key={att.id}
              onClick={() => open(att)}
              className={`flex items-center gap-1.5 text-[10px] font-medium rounded-md px-2 py-1 transition-colors ${
                isImage
                  ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100"
                  : "text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              {isImage ? (
                <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="2.5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M1 9.5l3-3.5 2.5 3 2-2.5 3.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="10" cy="5.5" r="1" fill="currentColor"/>
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                  <path d="M8 1H4a1 1 0 00-1 1v10a1 1 0 001 1h6a1 1 0 001-1V5L8 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                  <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                </svg>
              )}
              <span className="max-w-[140px] truncate">{att.name}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
