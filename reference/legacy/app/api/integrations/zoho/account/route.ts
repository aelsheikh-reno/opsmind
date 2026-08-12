import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function POST(req: NextRequest) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { accountId, accountName } = await req.json() as { accountId: string; accountName: string };
  const conn = await prisma.zohoConnection.findFirst();
  if (!conn) return NextResponse.json({ error: "Not connected" }, { status: 400 });

  await prisma.zohoConnection.update({ where: { id: conn.id }, data: { accountId, accountName } });
  return NextResponse.json({ ok: true });
}
