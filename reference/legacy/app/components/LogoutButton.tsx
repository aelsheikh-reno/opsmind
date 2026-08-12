"use client";

import { signOut } from "next-auth/react";

export default function LogoutButton({ initials }: { initials: string }) {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      title="Sign out"
      className="flex items-center gap-2 px-2 h-7 rounded-lg hover:bg-surface-hover transition-colors group"
    >
      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
        <span className="text-[9px] font-bold text-gray-700">{initials}</span>
      </div>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-gray-300 group-hover:text-gray-500 transition-colors">
        <path d="M5 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3M9 10l3-3-3-3M13 7H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
