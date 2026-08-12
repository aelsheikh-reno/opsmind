import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { country, currency, rate, frequencyMonths, filingDeadlineDays, anchorMonth, startDate, active, companyName, taxId, periodsAhead } = body;

  const config = await prisma.vatConfig.update({
    where: { id },
    data: {
      ...(country != null && { country }),
      ...(currency != null && { currency: currency.toUpperCase() }),
      ...(rate != null && { rate: parseFloat(rate) }),
      ...(frequencyMonths != null && { frequencyMonths: parseInt(frequencyMonths) }),
      ...(filingDeadlineDays != null && { filingDeadlineDays: parseInt(filingDeadlineDays) }),
      ...(anchorMonth != null && { anchorMonth: parseInt(anchorMonth) }),
      ...(startDate != null && { startDate: new Date(startDate) }),
      ...(active != null && { active }),
      ...(companyName !== undefined && { companyName: companyName || null }),
      ...(taxId !== undefined && { taxId: taxId || null }),
      ...(periodsAhead != null && { periodsAhead: parseInt(periodsAhead) }),
    },
  });

  return NextResponse.json(config);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  await prisma.vatConfig.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
