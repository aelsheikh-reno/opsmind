"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SECTIONS = [
  { key: "people",          label: "People & Employees" },
  { key: "contracts",       label: "Contracts" },
  { key: "government",      label: "Government docs" },
  { key: "invoices",        label: "Invoices" },
  { key: "leases",          label: "Rentals & Leases" },
  { key: "purchase_orders", label: "Purchase Orders" },
  { key: "payroll",         label: "Payroll" },
  { key: "finances",        label: "Finances" },
  { key: "projects",        label: "Projects" },
  { key: "intel",           label: "Intel & AI" },
  { key: "settings",        label: "Settings" },
] as const;

type SectionKey = typeof SECTIONS[number]["key"];
type Level = "none" | "read" | "write";

const ROLE_DEFAULTS: Record<string, Record<SectionKey, Level>> = {
  admin:           { people: "write", contracts: "write", government: "write", invoices: "write", leases: "write", purchase_orders: "write", payroll: "write", finances: "write", projects: "write", intel: "write", settings: "write" },
  manager:         { people: "write", contracts: "write", government: "write", invoices: "write", leases: "write", purchase_orders: "write", payroll: "read",  finances: "read",  projects: "write", intel: "write", settings: "none"  },
  viewer:          { people: "read",  contracts: "read",  government: "none",  invoices: "read",  leases: "read",  purchase_orders: "none",  payroll: "none",  finances: "read",  projects: "read",  intel: "none",  settings: "none"  },
  hr:              { people: "write", contracts: "write", government: "write", invoices: "none",  leases: "none",  purchase_orders: "none",  payroll: "read",  finances: "none",  projects: "none",  intel: "none",  settings: "none"  },
  accountant:      { people: "none",  contracts: "none",  government: "none",  invoices: "write", leases: "write", purchase_orders: "write", payroll: "write", finances: "write", projects: "read",  intel: "read",  settings: "none"  },
  project_manager: { people: "read",  contracts: "read",  government: "none",  invoices: "read",  leases: "none",  purchase_orders: "none",  payroll: "none",  finances: "read",  projects: "write", intel: "read",  settings: "none"  },
  custom:          { people: "none",  contracts: "none",  government: "none",  invoices: "none",  leases: "none",  purchase_orders: "none",  payroll: "none",  finances: "none",  projects: "none",  intel: "none",  settings: "none"  },
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  manager:         "Full write on all operations and Intel. Payroll and finances are view-only. No settings.",
  viewer:          "Executive observer: read access to people, contracts, invoices, finances and projects. No payroll, gov docs, or AI tools.",
  hr:              "People, employment contracts and government docs (write). Payroll view only. No financial records or AI.",
  accountant:      "Full write on invoices, leases, POs, payroll and finances. Projects and intel read for cost visibility. No HR.",
  project_manager: "Full write on projects. Reads people, contracts, invoices and finances for delivery context. No payroll.",
};

type UserData = {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string | null;
  isActive: boolean;
};

type Props =
  | { mode: "create"; currentUserId: string; user?: undefined }
  | { mode: "edit"; currentUserId: string; user: UserData };

function parsePerms(role: string, json: string | null): Record<SectionKey, Level> {
  if (json) {
    try { return JSON.parse(json) as Record<SectionKey, Level>; } catch { /* ignore */ }
  }
  return ROLE_DEFAULTS[role] as Record<SectionKey, Level> ?? ROLE_DEFAULTS.custom;
}

export default function UserFormModal({ mode, currentUserId, user }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role ?? "viewer");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [perms, setPerms] = useState<Record<SectionKey, Level>>(
    () => parsePerms(user?.role ?? "viewer", user?.permissions ?? null)
  );

  function handleRoleChange(r: string) {
    setRole(r);
    setPerms(ROLE_DEFAULTS[r] as Record<SectionKey, Level> ?? ROLE_DEFAULTS.custom);
  }

  function toggleView(s: SectionKey) {
    setPerms(p => {
      const cur = p[s];
      if (cur === "none") return { ...p, [s]: "read" };
      if (cur === "write") return { ...p, [s]: "read" };
      return { ...p, [s]: "none" };
    });
  }

  function toggleEdit(s: SectionKey) {
    setPerms(p => {
      const cur = p[s];
      if (cur === "write") return { ...p, [s]: "read" };
      return { ...p, [s]: "write" };
    });
  }

  function openModal() {
    if (mode === "edit" && user) {
      setName(user.name);
      setEmail(user.email);
      setPassword("");
      setRole(user.role);
      setIsActive(user.isActive);
      setPerms(parsePerms(user.role, user.permissions));
    }
    setError("");
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const defaults = ROLE_DEFAULTS[role] as Record<SectionKey, Level> ?? ROLE_DEFAULTS.custom;
      const isModified = SECTIONS.some(({ key }) => perms[key] !== defaults[key]);
      const body: Record<string, unknown> = {
        name, email, role,
        permissions: isModified ? perms : null,
      };
      if (mode === "create") body.password = password;
      if (mode === "edit") {
        body.isActive = isActive;
        if (password) body.password = password;
      }

      const res = await fetch(
        mode === "create" ? "/api/users" : `/api/users/${user!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${user?.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/users/${user!.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to delete");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {mode === "create" ? (
        <button
          onClick={openModal}
          className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium px-3 h-8 rounded-lg transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add user
        </button>
      ) : (
        <button
          onClick={openModal}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-surface-hover transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900">
                {mode === "create" ? "Add user" : "Edit user"}
              </h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Full name</label>
                  <input
                    value={name} onChange={e => setName(e.target.value)}
                    required className="w-full h-8 px-3 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Jane Smith"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required className="w-full h-8 px-3 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="jane@company.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  {mode === "create" ? "Password" : "New password"}
                  {mode === "edit" && <span className="font-normal text-gray-400"> (leave blank to keep current)</span>}
                </label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required={mode === "create"}
                  className="w-full h-8 px-3 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="••••••••"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Role</label>
                  <select
                    value={role} onChange={e => handleRoleChange(e.target.value)}
                    className="w-full h-8 px-3 text-sm border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="viewer">Viewer</option>
                    <option value="hr">HR</option>
                    <option value="accountant">Accountant</option>
                    <option value="project_manager">Project Manager</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                {mode === "edit" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Status</label>
                    <button
                      type="button"
                      onClick={() => setIsActive(v => !v)}
                      disabled={user?.id === currentUserId}
                      className={`relative flex items-center w-full h-8 px-3 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed gap-2 ${
                        isActive
                          ? "bg-green-50 border-green-200 text-green-700"
                          : "bg-gray-50 border-surface-border text-gray-400"
                      }`}
                    >
                      {/* pill toggle */}
                      <span className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ${isActive ? "bg-green-500" : "bg-gray-300"}`}>
                        <span className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${isActive ? "translate-x-3" : "translate-x-0"}`} />
                      </span>
                      {isActive ? "Active" : "Inactive"}
                    </button>
                  </div>
                )}
              </div>

              {/* Permission matrix — shown for all roles */}
              {(() => {
                const defaults = ROLE_DEFAULTS[role] as Record<SectionKey, Level> ?? ROLE_DEFAULTS.custom;
                const isModified = SECTIONS.some(({ key }) => perms[key] !== defaults[key]);
                return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-gray-700">Section permissions</label>
                      <div className="flex items-center gap-3">
                        {isModified && (
                          <button
                            type="button"
                            onClick={() => setPerms(defaults)}
                            className="text-[10px] text-amber-600 hover:text-amber-800 underline transition-colors"
                          >
                            Reset to defaults
                          </button>
                        )}
                        <div className="flex gap-3 text-[10px] font-semibold text-gray-400 pr-0.5">
                          <span className="w-8 text-center">View</span>
                          <span className="w-8 text-center">Edit</span>
                        </div>
                      </div>
                    </div>
                    {ROLE_DESCRIPTIONS[role] && (
                      <p className="text-[11px] text-gray-400 mb-2">{ROLE_DESCRIPTIONS[role]}</p>
                    )}
                    <div className="space-y-1 border border-surface-border rounded-lg overflow-hidden">
                      {SECTIONS.map(({ key, label }, idx) => {
                        const lvl = perms[key];
                        const canView = lvl !== "none";
                        const canEdit = lvl === "write";
                        const isLast = idx === SECTIONS.length - 1;
                        const changed = lvl !== defaults[key];
                        return (
                          <div
                            key={key}
                            className={`flex items-center px-3 py-2 gap-3 ${!isLast ? "border-b border-surface-border" : ""} ${changed ? "bg-amber-50/60" : "bg-white"}`}
                          >
                            <span className={`flex-1 text-xs ${changed ? "text-amber-700 font-medium" : "text-gray-700"}`}>{label}</span>
                            {/* View checkbox */}
                            <div className="w-8 flex justify-center">
                              <button
                                type="button"
                                onClick={() => toggleView(key)}
                                className={`w-4 h-4 rounded border transition-colors flex items-center justify-center ${
                                  canView
                                    ? "bg-sky-500 border-sky-500"
                                    : "border-gray-300 hover:border-gray-400 bg-white"
                                }`}
                                aria-label={`${canView ? "Remove" : "Grant"} view access to ${label}`}
                              >
                                {canView && (
                                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                    <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </button>
                            </div>
                            {/* Edit checkbox */}
                            <div className="w-8 flex justify-center">
                              <button
                                type="button"
                                onClick={() => toggleEdit(key)}
                                className={`w-4 h-4 rounded border transition-colors flex items-center justify-center ${
                                  canEdit
                                    ? "bg-indigo-500 border-indigo-500"
                                    : "border-gray-300 hover:border-gray-400 bg-white"
                                }`}
                                aria-label={`${canEdit ? "Remove" : "Grant"} edit access to ${label}`}
                              >
                                {canEdit && (
                                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                    <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-gray-400">Edit access automatically grants View. Removing View also removes Edit.</p>
                  </div>
                );
              })()}

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="flex items-center justify-between pt-1">
                {mode === "edit" && user?.id !== currentUserId ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    {deleting ? "Deleting…" : "Delete user"}
                  </button>
                ) : <span />}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 h-8 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 h-8 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50 rounded-lg transition-colors"
                  >
                    {saving ? "Saving…" : mode === "create" ? "Create user" : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
