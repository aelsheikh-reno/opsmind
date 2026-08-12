import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRead } from "@/lib/permissions";

export async function GET() {
  const denied = await requireRead("finances");
  if (denied) return denied;

  const conn = await prisma.zohoConnection.findFirst();
  if (!conn) return NextResponse.json({ connected: false });

  return NextResponse.json({
    connected: true,
    organizationId: conn.organizationId,
    organizationName: conn.organizationName,
    accountId: conn.accountId,
    accountName: conn.accountName,
  });
}
