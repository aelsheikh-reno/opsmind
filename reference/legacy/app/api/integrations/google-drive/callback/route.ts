import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getUserEmail } from "@/lib/google-drive";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/integrations/google-drive?error=access_denied", request.url));
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.redirect(new URL("/integrations/google-drive?error=no_tokens", request.url));
    }

    const email = await getUserEmail(tokens.access_token);

    // Only one Drive connection per system
    const existing = await prisma.driveConnection.findFirst();
    if (existing) {
      await prisma.driveConnection.update({
        where: { id: existing.id },
        data: {
          email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
        },
      });
    } else {
      await prisma.driveConnection.create({
        data: {
          email,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
        },
      });
    }

    return NextResponse.redirect(new URL("/integrations/google-drive?connected=1", request.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Google Drive callback error:", msg);
    return NextResponse.redirect(new URL(`/integrations/google-drive?error=callback_failed&detail=${encodeURIComponent(msg)}`, request.url));
  }
}
