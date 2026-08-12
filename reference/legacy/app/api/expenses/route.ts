import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { name, currency, amount, expenseType, paymentMethod, dueOn, notes, budgetId } = await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }

  try {
    const expense = await prisma.expense.create({
      data: {
        name: String(name).trim(),
        currency: currency ?? "AED",
        amount: amount != null && amount !== "" ? parseFloat(String(amount)) : null,
        amountConfirmed: amount != null && amount !== "",
        expenseType: expenseType || null,
        paymentMethod: paymentMethod || null,
        dueOn: dueOn ? new Date(dueOn) : null,
        notes: notes || null,
        budgetId: budgetId || null,
      },
    });
    return NextResponse.json({ ok: true, expense });
  } catch (err) {
    console.error("[POST /api/expenses]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
