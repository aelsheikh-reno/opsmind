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
    const services = await prisma.projectService.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
      include: { activities: { orderBy: { order: "asc" } } },
    });
    return NextResponse.json({ services });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
    const { name, description, billingAmount, paymentTerms } = await req.json();

    if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const last = await prisma.projectService.findFirst({
      where: { projectId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const service = await prisma.projectService.create({
      data: {
        projectId,
        name: name.trim(),
        description: description?.trim() || null,
        billingAmount: billingAmount ? parseFloat(billingAmount) : null,
        paymentTerms: paymentTerms?.trim() || null,
        order: last ? last.order + 1 : 0,
      },
      include: { activities: true },
    });

    return NextResponse.json(service, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
