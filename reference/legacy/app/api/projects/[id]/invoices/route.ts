import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id: projectId } = await params;
  const { milestoneId, serviceId, amount, currency, issuedAt, dueDate, status, notes, referenceNumber } =
    await req.json();

  if (!amount) {
    return NextResponse.json({ error: "amount is required" }, { status: 400 });
  }

  const invoice = await prisma.projectInvoice.create({
    data: {
      projectId,
      milestoneId: milestoneId || null,
      serviceId: serviceId || null,
      amount: parseFloat(amount),
      currency: currency || "AED",
      issuedAt: issuedAt ? new Date(issuedAt) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      status: status || "draft",
      notes: notes?.trim() || null,
      referenceNumber: referenceNumber?.trim() || null,
    },
    include: { milestone: true, service: { select: { id: true, name: true } } },
  });

  return NextResponse.json(invoice, { status: 201 });
}
