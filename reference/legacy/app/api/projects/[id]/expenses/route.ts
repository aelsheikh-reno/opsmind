import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id: projectId } = await params;
  const { description, amount, currency, date, category, notes } = await req.json();

  if (!description?.trim() || !amount || !date) {
    return NextResponse.json({ error: "description, amount and date are required" }, { status: 400 });
  }

  const expense = await prisma.projectExpense.create({
    data: {
      projectId,
      description: description.trim(),
      amount: parseFloat(amount),
      currency: currency || "AED",
      date: new Date(date),
      category: category?.trim() || null,
      notes: notes?.trim() || null,
    },
  });

  return NextResponse.json(expense, { status: 201 });
}
