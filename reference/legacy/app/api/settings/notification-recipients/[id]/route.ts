import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const data: { active?: boolean; name?: string } = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.name  === "string")  data.name   = body.name.trim() || null as unknown as string;
  const updated = await prisma.notificationRecipient.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.notificationRecipient.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
