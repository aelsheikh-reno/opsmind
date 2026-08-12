import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireWrite } from "@/lib/permissions";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({})) as { from?: string; to?: string };

  // Persist the sync-from date so the cron auto-sync uses the same start point.
  if (body.from) {
    const { prisma } = await import("@/lib/prisma");
    await prisma.setting.upsert({
      where:  { key: "asanaSyncFrom" },
      create: { key: "asanaSyncFrom", value: body.from },
      update: { value: body.from },
    });
  }

  // Derive base URL from the incoming request so self-calls work on any environment
  // without depending on NEXTAUTH_URL being set correctly.
  const proto   = req.headers.get("x-forwarded-proto") ?? (req.url.startsWith("https") ? "https" : "http");
  const host    = req.headers.get("host") ?? "localhost:3000";
  const baseUrl = `${proto}://${host}`;
  const secret  = process.env.CRON_SECRET;

  const url = new URL(`${baseUrl}/api/cron/asana-expenses`);
  if (body.from) url.searchParams.set("from", body.from);
  if (body.to)   url.searchParams.set("to",   body.to);

  const res = await fetch(url.toString(), {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ ok: false, error: data.error ?? "Sync failed" }, { status: 500 });
  return NextResponse.json({ ok: true, ...data });
}
