import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { audit } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; milestoneId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id: projectId, milestoneId } = await params;
  const body = await req.json();

  // Fetch current state once when we need it for auto-complete or change detection
  const needsCurrent = (body.completionPercent !== undefined && body.completedAt === undefined) || body.dueDate !== undefined;
  const current = needsCurrent
    ? await prisma.projectMilestone.findUnique({
        where: { id: milestoneId },
        select: { completedAt: true, dueDate: true, name: true },
      })
    : null;

  // Auto-complete: if completionPercent is being set to 100, mark done (preserve
  // existing completedAt so we don't overwrite it on repeat saves). If set below
  // 100, clear completedAt — unless the caller is explicitly toggling completedAt.
  let autoCompletedAt: Date | null | undefined;
  if (body.completionPercent !== undefined && body.completedAt === undefined) {
    const pct = body.completionPercent != null ? parseFloat(body.completionPercent) : 0;
    if (pct >= 100) {
      autoCompletedAt = current?.completedAt ?? new Date();
    } else {
      autoCompletedAt = null;
    }
  }

  const milestone = await prisma.projectMilestone.update({
    where: { id: milestoneId },
    data: {
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.description !== undefined && { description: body.description?.trim() || null }),
      ...(body.startDate !== undefined && { startDate: body.startDate ? new Date(body.startDate) : null }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate ? new Date(body.dueDate) : null }),
      ...(body.billingAmount !== undefined && { billingAmount: body.billingAmount ? parseFloat(body.billingAmount) : null }),
      ...(body.billingPercent !== undefined && { billingPercent: body.billingPercent ? parseFloat(body.billingPercent) : null }),
      ...(body.completedAt !== undefined
        ? { completedAt: body.completedAt ? new Date(body.completedAt) : null }
        : autoCompletedAt !== undefined ? { completedAt: autoCompletedAt } : {}),
      ...(body.completionPercent !== undefined && { completionPercent: body.completionPercent != null ? parseFloat(body.completionPercent) : null }),
      ...(body.estimatedHours !== undefined && { estimatedHours: body.estimatedHours != null ? parseFloat(body.estimatedHours) : null }),
      ...(body.tasks !== undefined && { tasks: body.tasks }),
      ...(body.order !== undefined && { order: body.order }),
    },
    include: { invoices: true },
  });

  // Audit: log due date change
  if (body.dueDate !== undefined && current) {
    const oldDate = current.dueDate ? current.dueDate.toISOString().split("T")[0] : null;
    const newDate = body.dueDate || null;
    if (oldDate !== newDate) {
      await audit({
        action: "milestone.date_changed",
        entityType: "project",
        entityId: projectId,
        entityLabel: current.name,
        details: { milestoneName: current.name, from: oldDate, to: newDate },
      });
    }
  }

  // Audit: log completion state change
  if (body.completionPercent !== undefined && current) {
    const wasComplete = !!current.completedAt;
    const isNowComplete = !!milestone.completedAt;
    if (!wasComplete && isNowComplete) {
      await audit({
        action: "milestone.completed",
        entityType: "project",
        entityId: projectId,
        entityLabel: current.name,
        details: { milestoneName: current.name },
      });
    } else if (wasComplete && !isNowComplete) {
      await audit({
        action: "milestone.reopened",
        entityType: "project",
        entityId: projectId,
        entityLabel: current.name,
        details: { milestoneName: current.name },
      });
    }
  }

  return NextResponse.json(milestone);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; milestoneId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { milestoneId } = await params;
  await prisma.projectMilestone.delete({ where: { id: milestoneId } });
  return NextResponse.json({ success: true });
}
