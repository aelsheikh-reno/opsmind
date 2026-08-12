import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { getAuthUrl } from "@/lib/zoho-books";

export async function GET() {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set in environment" },
      { status: 500 },
    );
  }

  return NextResponse.redirect(getAuthUrl());
}
