import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { invoiceId } = await params;
  const body = await req.json();

  const invoice = await prisma.projectInvoice.update({
    where: { id: invoiceId },
    data: {
      ...(body.milestoneId !== undefined && { milestoneId: body.milestoneId || null }),
      ...(body.serviceId !== undefined && { serviceId: body.serviceId || null }),
      ...(body.amount !== undefined && { amount: parseFloat(body.amount) }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.issuedAt !== undefined && { issuedAt: body.issuedAt ? new Date(body.issuedAt) : null }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate ? new Date(body.dueDate) : null }),
      ...(body.paidAt !== undefined && { paidAt: body.paidAt ? new Date(body.paidAt) : null }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.notes !== undefined && { notes: body.notes?.trim() || null }),
      ...(body.referenceNumber !== undefined && { referenceNumber: body.referenceNumber?.trim() || null }),
    },
    include: { milestone: true, service: { select: { id: true, name: true } } },
  });

  return NextResponse.json(invoice);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { invoiceId } = await params;
  await prisma.projectInvoice.delete({ where: { id: invoiceId } });
  return NextResponse.json({ success: true });
}
