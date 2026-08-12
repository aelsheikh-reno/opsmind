import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;

  const expense = await prisma.expense.findUnique({ where: { id }, select: { asanaTaskGid: true } });
  if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (expense.asanaTaskGid) {
    return NextResponse.json({ error: "Asana-synced claims cannot be deleted here" }, { status: 400 });
  }

  await prisma.expense.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const { name, expenseType, currency, amount, dueOn, paymentMethod, notes, budgetId, payrollMonth, payrollYear } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }

  // Only overwrite fields that were explicitly included in the request body
  const data: Record<string, unknown> = { name: String(name).trim() };
  if ("expenseType"   in body) data.expenseType   = expenseType || null;
  if ("currency"      in body) data.currency      = currency ?? "AED";
  if ("amount"        in body) {
    data.amount          = amount != null && amount !== "" ? parseFloat(String(amount)) : null;
    data.amountConfirmed = amount != null && amount !== "";
  }
  if ("dueOn"         in body) data.dueOn         = dueOn ? new Date(dueOn) : null;
  if ("paymentMethod" in body) data.paymentMethod = paymentMethod || null;
  if ("notes"         in body) data.notes         = notes || null;
  if ("budgetId"      in body) data.budgetId      = budgetId || null;
  if ("payrollMonth" in body) data.payrollMonth = payrollMonth ? parseInt(String(payrollMonth), 10) : null;
  if ("payrollYear"  in body) data.payrollYear  = payrollYear  ? parseInt(String(payrollYear),  10) : null;

  try {
    const expense = await prisma.expense.update({ where: { id }, data });
    return NextResponse.json({ ok: true, expense });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
