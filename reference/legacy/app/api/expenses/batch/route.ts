import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const body = await req.json();
  const expenses = body?.expenses;

  if (!Array.isArray(expenses) || expenses.length === 0) {
    return NextResponse.json({ error: "expenses array is required" }, { status: 400 });
  }
  if (expenses.length > 200) {
    return NextResponse.json({ error: "Maximum 200 expenses per batch" }, { status: 400 });
  }

  try {
    const created = await prisma.$transaction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expenses.map((e: any) =>
        prisma.expense.create({
          data: {
            name: String(e.name ?? "").trim() || "Untitled expense",
            currency: e.currency ?? "AED",
            amount: e.amount != null ? parseFloat(String(e.amount)) : null,
            amountConfirmed: e.amount != null,
            expenseType: e.expenseType || null,
            paymentMethod: e.paymentMethod || null,
            dueOn: e.dueOn ? new Date(e.dueOn) : null,
            notes: e.notes || null,
          },
        })
      )
    );
    return NextResponse.json({ ok: true, count: created.length });
  } catch (err) {
    console.error("[POST /api/expenses/batch]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
