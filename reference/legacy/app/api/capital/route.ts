import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRead, requireWrite } from "@/lib/permissions";

export async function GET() {
  const denied = await requireRead("finances");
  if (denied) return denied;

  const injections = await prisma.capitalInjection.findMany({
    orderBy: { date: "desc" },
  });
  return NextResponse.json(injections);
}

export async function POST(request: NextRequest) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  let body: { amount: number; currency: string; date: string; source?: string; type?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { amount, currency, date, source, type, notes } = body;
  if (!amount || amount <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
  if (!currency)             return NextResponse.json({ error: "Currency is required" }, { status: 400 });
  if (!date)                 return NextResponse.json({ error: "Date is required" }, { status: 400 });

  const injection = await prisma.capitalInjection.create({
    data: {
      amount,
      currency,
      date:   new Date(date),
      source: source || null,
      type:   type   || "equity",
      notes:  notes  || null,
    },
  });

  return NextResponse.json(injection, { status: 201 });
}
