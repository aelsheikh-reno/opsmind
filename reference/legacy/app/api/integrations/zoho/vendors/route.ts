import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";
import { getValidToken, getVendors } from "@/lib/zoho-books";

export async function GET() {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const conn = await prisma.zohoConnection.findFirst();
  if (!conn) return NextResponse.json({ error: "Not connected" }, { status: 400 });

  const { accessToken, updated } = await getValidToken(conn);
  if (updated) {
    await prisma.zohoConnection.update({ where: { id: conn.id }, data: updated });
  }

  const vendors = await getVendors(accessToken, conn.organizationId);
  return NextResponse.json({ vendors });
}
