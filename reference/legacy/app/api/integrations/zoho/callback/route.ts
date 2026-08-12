import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getOrganizations } from "@/lib/zoho-books";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const code  = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/integrations/zoho?error=access_denied", request.url));
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.redirect(new URL("/integrations/zoho?error=no_tokens", request.url));
    }

    const orgs = await getOrganizations(tokens.access_token);
    if (!orgs.length) {
      return NextResponse.redirect(new URL("/integrations/zoho?error=no_org", request.url));
    }
    const org = orgs[0];
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

    const existing = await prisma.zohoConnection.findFirst();
    if (existing) {
      await prisma.zohoConnection.update({
        where: { id: existing.id },
        data: {
          organizationId: org.organization_id,
          organizationName: org.name,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt,
        },
      });
    } else {
      await prisma.zohoConnection.create({
        data: {
          organizationId: org.organization_id,
          organizationName: org.name,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt,
        },
      });
    }

    return NextResponse.redirect(new URL("/integrations/zoho?connected=1", request.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[zoho/callback]", msg);
    return NextResponse.redirect(new URL(`/integrations/zoho?error=callback_failed&detail=${encodeURIComponent(msg)}`, request.url));
  }
}
