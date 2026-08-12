import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  const { name, amount, currency, color, category, startDate, endDate, notes, active } = await req.json();

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const budget = await prisma.budget.update({
    where: { id },
    data: {
      name: String(name).trim(),
      amount: amount != null ? parseFloat(String(amount)) : undefined,
      currency: currency ?? undefined,
      color: color ?? null,
      category: category || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      notes: notes || null,
      active: active != null ? Boolean(active) : undefined,
    },
    include: { expenses: { select: { id: true, name: true, amount: true, currency: true, expenseType: true, dueOn: true, completed: true, claimStatus: true, submitterEmail: true, personId: true, createdAt: true } } },
  });

  return NextResponse.json({ ok: true, budget });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;

  // Unlink all expenses before deleting
  await prisma.expense.updateMany({ where: { budgetId: id }, data: { budgetId: null } });
  await prisma.budget.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
