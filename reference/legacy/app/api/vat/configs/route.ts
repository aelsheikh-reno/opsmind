import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json();
  const { country, currency, rate, frequencyMonths, filingDeadlineDays, anchorMonth, startDate, companyName, taxId, periodsAhead } = body;

  if (!country || !currency || rate == null || !frequencyMonths || !filingDeadlineDays || !startDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const config = await prisma.vatConfig.create({
    data: {
      country,
      currency: currency.toUpperCase(),
      rate: parseFloat(rate),
      frequencyMonths: parseInt(frequencyMonths),
      filingDeadlineDays: parseInt(filingDeadlineDays),
      anchorMonth: parseInt(anchorMonth ?? 1),
      startDate: new Date(startDate),
      companyName: companyName || null,
      taxId: taxId || null,
      periodsAhead: periodsAhead ? parseInt(periodsAhead) : 5,
    },
  });

  return NextResponse.json(config);
}
