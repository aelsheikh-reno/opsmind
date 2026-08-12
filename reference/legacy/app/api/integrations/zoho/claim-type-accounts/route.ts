import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function GET() {
  const conn = await prisma.zohoConnection.findFirst({
    select: { claimTypeAccounts: true },
  });
  const mapping: Record<string, string> = (() => {
    try { return JSON.parse(conn?.claimTypeAccounts ?? "{}"); } catch { return {}; }
  })();
  return NextResponse.json({ mapping });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { mapping } = await req.json() as { mapping: Record<string, string> };
  const conn = await prisma.zohoConnection.findFirst();
  if (!conn) return NextResponse.json({ error: "Not connected" }, { status: 400 });

  await prisma.zohoConnection.update({
    where: { id: conn.id },
    data: { claimTypeAccounts: JSON.stringify(mapping) },
  });
  return NextResponse.json({ ok: true });
}
