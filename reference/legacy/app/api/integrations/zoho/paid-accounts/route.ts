import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";
import { getValidToken } from "@/lib/zoho-books";

const PAID_THROUGH_TYPES = ["bank", "cash", "creditcard", "othercurrentasset"];

export async function GET() {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const conn = await prisma.zohoConnection.findFirst();
  if (!conn) return NextResponse.json({ error: "Not connected" }, { status: 400 });

  const { accessToken, updated } = await getValidToken(conn);
  if (updated) {
    await prisma.zohoConnection.update({ where: { id: conn.id }, data: updated });
  }

  const res = await fetch(
    `https://www.zohoapis.com/books/v3/chartofaccounts?organization_id=${conn.organizationId}`,
    { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
  );
  const data = await res.json();
  const all = (data.chartofaccounts ?? []) as Array<{ account_id: string; account_name: string; account_type: string }>;
  const accounts = all.filter(a => PAID_THROUGH_TYPES.includes(a.account_type));
  return NextResponse.json({ accounts });
}
