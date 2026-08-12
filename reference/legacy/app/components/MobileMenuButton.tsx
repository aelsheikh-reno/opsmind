"use client";
import { useMobileMenu } from "@/app/contexts/MobileMenuContext";

export default function MobileMenuButton() {
  const { open } = useMobileMenu();
  return (
    <button
      onClick={open}
      className="md:hidden -ml-1 mr-1 p-2 rounded-lg hover:bg-surface-hover text-gray-500 hover:text-gray-700 transition-colors shrink-0"
      aria-label="Open menu"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
