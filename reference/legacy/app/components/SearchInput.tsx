"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

type Props = {
  value?: string;
  placeholder?: string;
};

export default function SearchInput({ value: serverValue = "", placeholder = "Search…" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(serverValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync internal state when the server re-renders with a new q (e.g. back/forward navigation)
  useEffect(() => {
    setValue(serverValue);
  }, [serverValue]);

  function handleChange(next: string) {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (next.trim()) params.set("q", next.trim());
      router.replace(`${pathname}${params.size ? `?${params}` : ""}`);
    }, 300);
  }

  function clear() {
    setValue("");
    router.replace(pathname);
  }

  return (
    <div className="relative flex items-center w-full">
      <svg
        className="absolute left-2.5 text-gray-400 pointer-events-none shrink-0"
        width="13" height="13" viewBox="0 0 14 14" fill="none"
      >
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M9.5 9.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full pl-8 pr-7 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50 transition-colors placeholder-gray-400"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2.5 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Clear search"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
