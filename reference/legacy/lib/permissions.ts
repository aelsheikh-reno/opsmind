import { auth } from "@/auth";
import { NextResponse } from "next/server";

export type Section =
  | "people"
  | "contracts"
  | "government"
  | "invoices"
  | "leases"
  | "purchase_orders"
  | "payroll"
  | "finances"
  | "projects"
  | "intel"
  | "settings";

export type Level = "none" | "read" | "write";

export const RECORD_SECTIONS: Section[] = ["contracts", "government", "invoices", "leases", "purchase_orders"];

const ROLE_DEFAULTS: Record<string, Record<Section, Level>> = {
  admin: {
    people: "write", contracts: "write", government: "write",
    invoices: "write", leases: "write", purchase_orders: "write", payroll: "write",
    finances: "write", projects: "write", intel: "write", settings: "write",
  },
  // Full operational write access. Intel is also write — managers need all AI insights.
  manager: {
    people: "write", contracts: "write", government: "write",
    invoices: "write", leases: "write", purchase_orders: "write", payroll: "read",
    finances: "read", projects: "write", intel: "write", settings: "none",
  },
  // Executive/observer: big-picture read. No payroll (salary sensitive), no gov docs, no POs, no AI tools.
  viewer: {
    people: "read", contracts: "read", government: "none",
    invoices: "read", leases: "read", purchase_orders: "none", payroll: "none",
    finances: "read", projects: "read", intel: "none", settings: "none",
  },
  // HR team: owns people, employment contracts, gov compliance. Payroll view only. No financial records or AI.
  hr: {
    people: "write", contracts: "write", government: "write",
    invoices: "none", leases: "none", purchase_orders: "none", payroll: "read",
    finances: "none", projects: "none", intel: "none", settings: "none",
  },
  // Finance/accounting: owns invoices, leases, POs, payroll, finances. Projects and intel read for cost visibility.
  accountant: {
    people: "none", contracts: "none", government: "none",
    invoices: "write", leases: "write", purchase_orders: "write", payroll: "write",
    finances: "write", projects: "read", intel: "read", settings: "none",
  },
  // Project lead: owns project delivery. Reads people, contracts, invoices, finances for context.
  project_manager: {
    people: "read", contracts: "read", government: "none",
    invoices: "read", leases: "none", purchase_orders: "none", payroll: "none",
    finances: "read", projects: "write", intel: "read", settings: "none",
  },
  custom: {
    people: "none", contracts: "none", government: "none",
    invoices: "none", leases: "none", purchase_orders: "none", payroll: "none",
    finances: "none", projects: "none", intel: "none", settings: "none",
  },
};

export function resolvePermissions(role: string, permissionsJson: string | null): Record<Section, Level> {
  // A stored permissions JSON always overrides role defaults — applies to any role, not just "custom".
  // This lets admins fine-tune predefined roles without losing the role label.
  if (permissionsJson) {
    try {
      const parsed = JSON.parse(permissionsJson) as Record<string, Level>;
      // backward compat: old JSON with a "records" key expands to sub-sections
      if ("records" in parsed) {
        const lvl = parsed["records"] as Level;
        return {
          people: parsed.people ?? "none",
          contracts: parsed.contracts ?? lvl,
          government: parsed.government ?? lvl,
          invoices: parsed.invoices ?? lvl,
          leases: parsed.leases ?? lvl,
          purchase_orders: parsed.purchase_orders ?? lvl,
          payroll: parsed.payroll ?? "none",
          finances: parsed.finances ?? "none",
          projects: parsed.projects ?? "none",
          intel: parsed.intel ?? "none",
          settings: parsed.settings ?? "none",
        };
      }
      return {
        people:          parsed.people          ?? "none",
        contracts:       parsed.contracts       ?? "none",
        government:      parsed.government      ?? "none",
        invoices:        parsed.invoices        ?? "none",
        leases:          parsed.leases          ?? "none",
        purchase_orders: parsed.purchase_orders ?? "none",
        payroll:         parsed.payroll         ?? "none",
        finances:        parsed.finances        ?? "none",
        projects:        parsed.projects        ?? "none",
        intel:           parsed.intel           ?? "none",
        settings:        parsed.settings        ?? "none",
      };
    } catch { /* fall through */ }
  }
  return ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.viewer;
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });
const UNAUTH    = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function requireWrite(section: Section): Promise<NextResponse | null> {
  const session = await auth();
  if (!session) return UNAUTH;
  const perms = resolvePermissions(session.user.role, session.user.permissions);
  if (perms[section] !== "write") return FORBIDDEN;
  return null;
}

export async function requireRead(section: Section): Promise<NextResponse | null> {
  const session = await auth();
  if (!session) return UNAUTH;
  const perms = resolvePermissions(session.user.role, session.user.permissions);
  if (perms[section] === "none") return FORBIDDEN;
  return null;
}

/** Used by generic document routes that may affect any record type. */
export async function requireAnyRecordsWrite(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session) return UNAUTH;
  const perms = resolvePermissions(session.user.role, session.user.permissions);
  const ok = RECORD_SECTIONS.some(s => perms[s] === "write");
  if (!ok) return FORBIDDEN;
  return null;
}

export { ROLE_DEFAULTS };
