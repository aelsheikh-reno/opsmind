import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import GlobalSearch from "./GlobalSearch";
import LogoutButton from "./LogoutButton";
import MobileMenuButton from "./MobileMenuButton";

export type BreadcrumbItem = { label: string; href?: string };

export default async function TopBar({ breadcrumb }: { breadcrumb: BreadcrumbItem[] }) {
  const [entitySetting, session] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "entityName" } }),
    auth(),
  ]);
  const entityName = entitySetting?.value || "OpsMind";
  const initials = session?.user?.name
    ? session.user.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  const perms = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null);
  const canQuickAdd = Object.values(perms).some(v => v === "write");

  return (
    <header className="sticky top-0 z-20 bg-[#fafafa] border-b border-surface-border px-4 md:px-6 h-[52px] flex items-center gap-3 md:gap-4 shrink-0">
      <MobileMenuButton />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="text-[12px] text-gray-400 shrink-0 font-medium">{entityName}</span>
        {breadcrumb.map((item, i) => (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-gray-300 shrink-0">
              <path d="M2.5 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {item.href ? (
              <Link href={item.href} className="text-[12px] text-gray-400 hover:text-gray-700 transition-colors shrink-0">{item.label}</Link>
            ) : (
              <span className="text-[13px] font-semibold text-gray-900 truncate">{item.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Search */}
      <div className="hidden sm:block">
        <GlobalSearch />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {canQuickAdd && (
          <Link
            href="/"
            className="hidden sm:flex items-center gap-1.5 border border-surface-border rounded-lg px-3 h-7 text-[12px] font-medium text-gray-600 hover:bg-surface-hover hover:text-gray-900 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Quick add
          </Link>
        )}

        <Link
          href="/ai"
          className="hidden sm:flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 rounded-lg px-3 h-7 text-[12px] font-semibold text-white transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 1l.9 2.7L9 5l-3.1 1.3L5 9l-.9-2.7L1 5l3.1-1.3L5 1z" fill="white" />
          </svg>
          Ask AI
        </Link>

        <div className="w-px h-4 bg-surface-border" />
        <LogoutButton initials={initials} />
      </div>
    </header>
  );
}
