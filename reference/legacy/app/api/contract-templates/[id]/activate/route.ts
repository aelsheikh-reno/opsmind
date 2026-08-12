import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const template = await prisma.contractTemplate.findUnique({ where: { id }, select: { isActive: true } });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.contractTemplate.update({ where: { id }, data: { isActive: !template.isActive } });

  return NextResponse.json({ ok: true, isActive: !template.isActive });
}
