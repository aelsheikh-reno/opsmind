import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const data: Record<string, string | boolean | null> = {};
  if ("name" in body && body.name?.trim()) data.name = body.name.trim();
  if ("country" in body && body.country?.trim()) data.country = body.country.trim();
  if ("currency" in body) data.currency = body.currency?.trim() || null;
  if ("active" in body) data.active = body.active;

  const entity = await prisma.legalEntity.update({ where: { id }, data });
  return NextResponse.json(entity);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const { id } = await params;
  await prisma.document.updateMany({ where: { legalEntityId: id }, data: { legalEntityId: null } });
  await prisma.legalEntity.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
