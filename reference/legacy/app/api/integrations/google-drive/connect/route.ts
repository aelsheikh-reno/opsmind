import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { getAuthUrl } from "@/lib/google-drive";

export async function GET(request: Request) {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local" },
      { status: 500 },
    );
  }

  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
