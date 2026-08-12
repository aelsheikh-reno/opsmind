import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  let body: { amount?: number; currency?: string; date?: string; source?: string; type?: string; notes?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const updated = await prisma.capitalInjection.update({
      where: { id },
      data: {
        ...(body.amount   != null  && { amount: body.amount }),
        ...(body.currency != null  && { currency: body.currency }),
        ...(body.date     != null  && { date: new Date(body.date) }),
        ...(body.type     != null  && { type: body.type }),
        source: body.source ?? null,
        notes:  body.notes  ?? null,
      },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  try {
    await prisma.capitalInjection.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
