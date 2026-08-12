"use client";

import { useState, useRef, useEffect } from "react";

export default function DocxViewer({ src, filename }: { src: string; filename: string }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(src)
      .then(async res => {
        if (!res.ok) { setStatus("error"); return; }
        const text = await res.text();
        setHtmlContent(text);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [src]);

  useEffect(() => {
    function onChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen();
    }
  }

  return (
    <div
      ref={containerRef}
      className="rounded-lg overflow-hidden border border-gray-200 bg-white flex flex-col"
    >
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-xs text-gray-500 font-medium truncate max-w-[280px]">{filename}</span>
        {status === "ready" && (
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-white border border-transparent hover:border-gray-200 rounded-lg px-2 py-1 transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Full screen"}
          >
            {isFullscreen ? (
              <>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M5 1v4H1M8 5h4V1M8 12v-4h4M1 8h4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Exit fullscreen
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M1 5V1h4M8 1h4v4M12 8v4H8M5 12H1V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Full screen
              </>
            )}
          </button>
        )}
      </div>

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <svg width="16" height="16" viewBox="0 0 16 16" className="animate-spin" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="18" strokeDashoffset="6" />
          </svg>
          <span className="text-xs">Loading preview…</span>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3 py-12 px-6 text-center">
          <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-amber-500">
              <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">File unavailable</p>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              The stored file could not be retrieved.<br />Use <span className="font-medium text-gray-600">Replace file</span> below to re-upload it.
            </p>
          </div>
        </div>
      )}

      {status === "ready" && htmlContent && (
        <iframe
          srcDoc={htmlContent}
          title={filename}
          sandbox="allow-same-origin"
          style={{
            width: "100%",
            height: isFullscreen ? "calc(100vh - 41px)" : "650px",
            border: "none",
            display: "block",
          }}
        />
      )}
    </div>
  );
}
