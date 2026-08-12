import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const configs = await prisma.taxConfig.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(configs);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    country, taxType, currency, rate, frequencyMonths,
    filingDeadlineDays, anchorMonth, startDate,
    companyName, taxId, notes,
    revenueBase, thresholdActive, profitThreshold, periodsAhead,
  } = body;

  if (!country || !currency || rate == null || !frequencyMonths || !filingDeadlineDays || !startDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const config = await prisma.taxConfig.create({
    data: {
      country,
      taxType: taxType ?? "corporate",
      currency,
      rate,
      frequencyMonths,
      filingDeadlineDays,
      anchorMonth: anchorMonth ?? 1,
      startDate: new Date(startDate),
      companyName: companyName || null,
      taxId: taxId || null,
      notes: notes || null,
      revenueBase: revenueBase ?? false,
      thresholdActive: revenueBase ? false : (thresholdActive ?? false),
      profitThreshold: profitThreshold ?? null,
      periodsAhead: periodsAhead ?? 5,
    },
  });

  return NextResponse.json(config, { status: 201 });
}
