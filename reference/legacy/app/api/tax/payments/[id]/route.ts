import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  const { dueDate } = await req.json();
  if (!dueDate) return NextResponse.json({ error: "dueDate required" }, { status: 400 });

  const updated = await prisma.taxPayment.update({
    where: { id },
    data: { dueDate: new Date(dueDate) },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  await prisma.taxPayment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
