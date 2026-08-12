import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function maskKey(key: string): string {
  if (key.length <= 20) return "••••••••";
  return `${key.slice(0, 16)}${"•".repeat(6)}${key.slice(-4)}`;
}

export async function GET() {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const dbSetting = await prisma.setting.findUnique({ where: { key: "anthropicAdminKey" } });
  const adminKey = dbSetting?.value || process.env.ANTHROPIC_ADMIN_KEY || null;

  return NextResponse.json({
    configured: !!adminKey,
    keyPreview: adminKey ? maskKey(adminKey) : null,
  });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const body = await req.json() as { adminKey?: string };
  const key = body.adminKey?.trim() ?? "";

  if (!key) {
    return NextResponse.json({ error: "adminKey is required" }, { status: 400 });
  }
  if (!key.startsWith("sk-ant-admin-")) {
    return NextResponse.json({ error: "Admin keys must start with sk-ant-admin-" }, { status: 400 });
  }

  await prisma.setting.upsert({
    where: { key: "anthropicAdminKey" },
    update: { value: key },
    create: { key: "anthropicAdminKey", value: key },
  });

  return NextResponse.json({ ok: true, keyPreview: maskKey(key) });
}
