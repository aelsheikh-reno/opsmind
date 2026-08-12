import { prisma } from "./prisma";
import { auth } from "@/auth";

export type AuditAction =
  | "employee.created"
  | "employee.deleted"
  | "employee.updated"
  | "employee.salary_updated"
  | "employee.rate_updated"
  | "employee.merged"
  | "document.uploaded"
  | "document.updated"
  | "document.parties_updated"
  | "document.paid"
  | "document.unpaid"
  | "document.paid_date_updated"
  | "document.status_changed"
  | "payroll.processed"
  | "payroll.unprocessed"
  | "payroll.paid"
  | "payroll.unpaid"
  | "rate.locked"
  | "rate.unlocked"
  | "setting.changed"
  | "contract.generated"
  | "project.created"
  | "project.updated"
  | "project.status_updated"
  | "project.deleted"
  | "milestone.date_changed"
  | "milestone.completed"
  | "milestone.reopened";

export async function audit(params: {
  action: AuditAction;
  entityType: "person" | "document" | "payrollRun" | "project";
  entityId?: string | null;
  entityLabel?: string | null;
  details?: Record<string, unknown>;
  userId?: string | null;
  userName?: string | null;
}): Promise<void> {
  try {
    let userId = params.userId ?? null;
    let userName = params.userName ?? null;

    // Only call auth() as fallback if caller did not supply user info
    if (userId === null && userName === null) {
      try {
        const session = await auth();
        userId = session?.user?.id ?? null;
        userName = session?.user?.name ?? null;
      } catch { /* ignore — auth may not be available in all contexts */ }
    }

    await prisma.auditLog.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        entityLabel: params.entityLabel ?? null,
        details: params.details ? JSON.stringify(params.details) : null,
        userId,
        userName,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write log:", err);
  }
}
