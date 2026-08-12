import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireRead, requireWrite } from "@/lib/permissions";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRead("finances");
  if (denied) return denied;

  const { id } = await params;
  const float = await prisma.pettyCashFloat.findUnique({
    where: { id },
    include: {
      person: { select: { id: true, name: true } },
      expenses: {
        orderBy: { createdAt: "asc" },
        include: {
          attachments: { select: { id: true, name: true, downloadUrl: true } },
        },
      },
    },
  });

  if (!float) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(float);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  if ("status" in body) {
    if (body.status !== "open" && body.status !== "cleared")
      return NextResponse.json({ error: "status must be 'open' or 'cleared'" }, { status: 400 });
    data.status = body.status;
  }
  if ("amount"   in body) data.amount   = parseFloat(body.amount);
  if ("currency" in body) data.currency = body.currency;
  if ("handedAt" in body) data.handedAt = new Date(body.handedAt);
  if ("note"     in body) data.note     = body.note || null;
  if ("personId" in body) data.personId = body.personId || null;

  const float = await prisma.pettyCashFloat.update({
    where: { id },
    data,
    include: { person: { select: { id: true, name: true } } },
  });

  return NextResponse.json(float);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  await prisma.pettyCashFloat.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
