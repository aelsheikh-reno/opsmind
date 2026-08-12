import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireRead, requireWrite } from "@/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  try {
    const { id: projectId } = await params;
    const milestones = await prisma.projectMilestone.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
      include: { invoices: { orderBy: { createdAt: "desc" } } },
    });
    return NextResponse.json(milestones);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[milestones GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  try {
    const { id: projectId } = await params;
    const { name, description, startDate, dueDate, billingAmount, billingPercent, order, completionPercent, tasks, estimatedHours } = await req.json();

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const lastMilestone = await prisma.projectMilestone.findFirst({
      where: { projectId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const milestone = await prisma.projectMilestone.create({
      data: {
        projectId,
        name: name.trim(),
        description: description?.trim() || null,
        startDate: startDate ? new Date(startDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        billingAmount: billingAmount ? parseFloat(billingAmount) : null,
        billingPercent: billingPercent ? parseFloat(billingPercent) : null,
        completionPercent: completionPercent != null ? parseFloat(completionPercent) : 0,
        estimatedHours: estimatedHours != null ? parseFloat(estimatedHours) : null,
        tasks: tasks ?? null,
        order: order ?? (lastMilestone ? lastMilestone.order + 1 : 0),
      },
    });

    return NextResponse.json(milestone, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[milestones POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
