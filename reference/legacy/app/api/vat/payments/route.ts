import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json();
  const { vatConfigId, periodStart, periodEnd, dueDate, paidAmount, paidAt, notes, documentId, customDueDate } = body;

  if (!vatConfigId || !periodStart || !periodEnd || !dueDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const payment = await prisma.vatPayment.upsert({
    where: { vatConfigId_periodStart: { vatConfigId, periodStart: new Date(periodStart) } },
    create: {
      vatConfigId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      dueDate: new Date(dueDate),
      customDueDate: customDueDate ? new Date(customDueDate) : null,
      paidAmount: paidAmount != null ? parseFloat(paidAmount) : null,
      paidAt: paidAt ? new Date(paidAt) : null,
      notes: notes ?? null,
      documentId: documentId ?? null,
    },
    update: {
      ...(customDueDate !== undefined && { customDueDate: customDueDate ? new Date(customDueDate) : null }),
      ...(paidAmount !== undefined && { paidAmount: paidAmount != null ? parseFloat(paidAmount) : null }),
      ...(paidAt !== undefined && { paidAt: paidAt ? new Date(paidAt) : null }),
      ...(notes !== undefined && { notes: notes ?? null }),
      ...(documentId !== undefined && { documentId: documentId ?? null }),
    },
  });

  return NextResponse.json(payment);
}
