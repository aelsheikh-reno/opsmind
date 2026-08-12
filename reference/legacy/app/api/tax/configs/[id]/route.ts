import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const {
    country, taxType, currency, rate, frequencyMonths,
    filingDeadlineDays, anchorMonth, startDate,
    companyName, taxId, notes, active,
    revenueBase, thresholdActive, profitThreshold, periodsAhead,
  } = body;

  const config = await prisma.taxConfig.update({
    where: { id },
    data: {
      ...(country !== undefined && { country }),
      ...(taxType !== undefined && { taxType }),
      ...(currency !== undefined && { currency }),
      ...(rate !== undefined && { rate }),
      ...(frequencyMonths !== undefined && { frequencyMonths }),
      ...(filingDeadlineDays !== undefined && { filingDeadlineDays }),
      ...(anchorMonth !== undefined && { anchorMonth }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(companyName !== undefined && { companyName: companyName || null }),
      ...(taxId !== undefined && { taxId: taxId || null }),
      ...(notes !== undefined && { notes: notes || null }),
      ...(active !== undefined && { active }),
      ...(revenueBase !== undefined && { revenueBase }),
      ...(thresholdActive !== undefined && { thresholdActive }),
      ...(profitThreshold !== undefined && { profitThreshold: profitThreshold ?? null }),
      ...(periodsAhead !== undefined && { periodsAhead: periodsAhead ?? 5 }),
    },
  });

  return NextResponse.json(config);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await prisma.taxConfig.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
