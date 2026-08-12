import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { taxConfigId, periodStart, periodEnd, dueDate, paidAmount, paidAt, notes, documentId } = body;

  if (!taxConfigId || !periodStart || !periodEnd || !dueDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const payment = await prisma.taxPayment.upsert({
    where: { taxConfigId_periodStart: { taxConfigId, periodStart: new Date(periodStart) } },
    update: {
      periodEnd: new Date(periodEnd),
      dueDate: new Date(dueDate),
      paidAmount: paidAmount ?? null,
      paidAt: paidAt ? new Date(paidAt) : null,
      notes: notes ?? null,
      documentId: documentId ?? null,
    },
    create: {
      taxConfigId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      dueDate: new Date(dueDate),
      paidAmount: paidAmount ?? null,
      paidAt: paidAt ? new Date(paidAt) : null,
      notes: notes ?? null,
      documentId: documentId ?? null,
    },
  });

  return NextResponse.json(payment, { status: 201 });
}
