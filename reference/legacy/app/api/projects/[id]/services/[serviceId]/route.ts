import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  try {
    const { serviceId } = await params;
    const { name, description, billingAmount, paymentTerms } = await req.json();

    const service = await prisma.projectService.update({
      where: { id: serviceId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(billingAmount !== undefined && { billingAmount: billingAmount ? parseFloat(billingAmount) : null }),
        ...(paymentTerms !== undefined && { paymentTerms: paymentTerms?.trim() || null }),
      },
      include: { activities: { orderBy: { order: "asc" } } },
    });

    return NextResponse.json(service);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  try {
    const { serviceId } = await params;
    await prisma.projectService.delete({ where: { id: serviceId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
