import { NextResponse } from "next/server";
import { requireRead, requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const denied = await requireRead("finances");
  if (denied) return denied;

  const budgets = await prisma.budget.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      expenses: {
        select: {
          id: true,
          name: true,
          amount: true,
          currency: true,
          expenseType: true,
          dueOn: true,
          completed: true,
          claimStatus: true,
          submitterEmail: true,
          personId: true,
        },
      },
    },
  });
  return NextResponse.json({ budgets });
}

export async function POST(req: Request) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { name, amount, currency, color, category, startDate, endDate, notes } = await req.json();

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!amount || isNaN(parseFloat(String(amount)))) return NextResponse.json({ error: "Amount is required" }, { status: 400 });

  const budget = await prisma.budget.create({
    data: {
      name: String(name).trim(),
      amount: parseFloat(String(amount)),
      currency: currency ?? "AED",
      color: color || null,
      category: category || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      notes: notes || null,
    },
    include: { expenses: { select: { id: true, name: true, amount: true, currency: true, expenseType: true, dueOn: true, completed: true, claimStatus: true, submitterEmail: true, personId: true, createdAt: true } } },
  });

  return NextResponse.json({ ok: true, budget });
}
