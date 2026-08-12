import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import UserFormModal from "../components/UserFormModal";

const ROLE_META: Record<string, { label: string; color: string }> = {
  admin:           { label: "Admin",           color: "bg-red-100 text-red-700" },
  manager:         { label: "Manager",         color: "bg-indigo-100 text-indigo-700" },
  viewer:          { label: "Viewer",          color: "bg-gray-100 text-gray-600" },
  hr:              { label: "HR",              color: "bg-teal-100 text-teal-700" },
  accountant:      { label: "Accountant",      color: "bg-violet-100 text-violet-700" },
  project_manager: { label: "Project Manager", color: "bg-emerald-100 text-emerald-700" },
  custom:          { label: "Custom",          color: "bg-amber-100 text-amber-700" },
};

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function fmtDate(d: Date | null): string {
  if (!d) return "Never";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function isOnline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

export default async function TeamPage() {
  const session = await auth();
  if (!session || session.user.role !== "admin") redirect("/");

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Team" }, { label: "Users" }]} />

        <main className="px-4 sm:px-8 py-4 sm:py-6 max-w-4xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Users</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                Manage who has access to OpsMind and what they can do.
              </p>
            </div>
            <UserFormModal mode="create" currentUserId={session.user.id} />
          </div>

          <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
            {users.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-gray-400">
                No users yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-inset">
                    <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">User</th>
                    <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Role</th>
                    <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</th>
                    <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Last login</th>
                    <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Created</th>
                    <th className="px-2 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {users.map((user) => {
                    const role = ROLE_META[user.role] ?? { label: user.role, color: "bg-gray-100 text-gray-600" };
                    const initials = user.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase();
                    const online = isOnline(user.lastSeenAt);
                    return (
                      <tr key={user.id} className="hover:bg-surface-hover transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative w-7 h-7 shrink-0">
                              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center">
                                <span className="text-[10px] font-bold text-indigo-600">{initials}</span>
                              </div>
                              {online && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full" title="Online now" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">
                                {user.name}
                                {user.id === session.user.id && (
                                  <span className="ml-1.5 text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full">You</span>
                                )}
                              </p>
                              <p className="text-xs text-gray-400">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${role.color}`}>
                              {role.label}
                            </span>
                            {user.permissions && user.role !== "custom" && (
                              <span className="text-[9px] font-bold bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                Modified
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {online ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
                              <span className="relative flex w-1.5 h-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-green-500" />
                              </span>
                              Online now
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${user.isActive ? "text-gray-500" : "text-gray-400"}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? "bg-gray-400" : "bg-gray-300"}`} />
                              {user.isActive ? "Active" : "Inactive"}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-400">{fmtDate(user.lastLoginAt)}</td>
                        <td className="px-5 py-3 text-xs text-gray-400">{fmtDate(user.createdAt)}</td>
                        <td className="px-2 py-3">
                          <UserFormModal
                            mode="edit"
                            currentUserId={session.user.id}
                            user={{
                              id: user.id,
                              email: user.email,
                              name: user.name,
                              role: user.role,
                              permissions: user.permissions,
                              isActive: user.isActive,
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>

          <div className="mt-6 bg-white border border-surface-border rounded-xl p-5">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Role permissions</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              {[
                { role: "Admin",           color: "text-red-700",     desc: "Full access to every section including user management and settings." },
                { role: "Manager",         color: "text-indigo-700",  desc: "Full write on all operations and Intel. Payroll and finances are view-only. No settings." },
                { role: "Viewer",          color: "text-gray-600",    desc: "Executive observer — read access to people, contracts, invoices, finances and projects. No payroll, gov docs, or AI tools." },
                { role: "HR",              color: "text-teal-700",    desc: "Owns people, employment contracts and government docs. Payroll view only. No financial records." },
                { role: "Accountant",      color: "text-violet-700",  desc: "Full write on invoices, leases, purchase orders, payroll and finances. Projects and Intel read for cost context." },
                { role: "Project Manager", color: "text-emerald-700", desc: "Full write on projects. Reads people, contracts, invoices and finances. No payroll." },
                { role: "Custom",          color: "text-amber-700",   desc: "Granular per-section access. Set View and/or Edit per area individually." },
              ].map(r => (
                <div key={r.role} className="bg-surface-inset rounded-lg p-3">
                  <p className={`font-bold mb-1 ${r.color}`}>{r.role}</p>
                  <p className="text-gray-500">{r.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
