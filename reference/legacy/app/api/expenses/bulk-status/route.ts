import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function DELETE(req: NextRequest) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as { ids?: string[] };
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: "Maximum 500 items per bulk delete" }, { status: 400 });
  }

  const { count } = await prisma.expense.deleteMany({ where: { id: { in: ids } } });
  return NextResponse.json({ ok: true, count });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as {
    ids?: string[];
    completed?: boolean;
    budgetId?: string | null;
    personId?: string | null;
    payrollMonth?: number | null;
    payrollYear?: number | null;
  };
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: "Maximum 500 items per bulk update" }, { status: 400 });
  }

  if ("budgetId" in body) {
    const { count } = await prisma.expense.updateMany({
      where: { id: { in: ids } },
      data: { budgetId: body.budgetId || null },
    });
    return NextResponse.json({ ok: true, count });
  }

  if ("personId" in body) {
    const { count } = await prisma.expense.updateMany({
      where: { id: { in: ids } },
      data: { personId: body.personId || null },
    });
    return NextResponse.json({ ok: true, count });
  }

  if ("payrollMonth" in body) {
    const { count } = await prisma.expense.updateMany({
      where: { id: { in: ids } },
      data: {
        payrollMonth: body.payrollMonth ?? null,
        payrollYear: body.payrollYear ?? null,
      },
    });
    return NextResponse.json({ ok: true, count });
  }

  if (typeof body.completed !== "boolean") {
    return NextResponse.json({ error: "completed boolean, budgetId, personId, or payrollMonth is required" }, { status: 400 });
  }

  const { count } = await prisma.expense.updateMany({
    where: { id: { in: ids } },
    data: { completed: body.completed },
  });

  return NextResponse.json({ ok: true, count });
}
