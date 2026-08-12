import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; expenseId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { expenseId } = await params;
  const body = await req.json();

  const expense = await prisma.projectExpense.update({
    where: { id: expenseId },
    data: {
      ...(body.description !== undefined && { description: body.description.trim() }),
      ...(body.amount !== undefined && { amount: parseFloat(body.amount) }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.date !== undefined && { date: new Date(body.date) }),
      ...(body.category !== undefined && { category: body.category?.trim() || null }),
      ...(body.notes !== undefined && { notes: body.notes?.trim() || null }),
    },
  });

  return NextResponse.json(expense);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; expenseId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { expenseId } = await params;
  await prisma.projectExpense.delete({ where: { id: expenseId } });
  return NextResponse.json({ success: true });
}
