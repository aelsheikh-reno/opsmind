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
  const amount = parseFloat(body.amount);
  if (isNaN(amount) || amount < 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().toUpperCase() : undefined;

  const expense = await prisma.expense.update({
    where: { id },
    data: { amount, amountConfirmed: true, ...(currency ? { currency } : {}) },
  });

  return NextResponse.json({ ok: true, amount: expense.amount, currency: expense.currency });
}
