import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const [tokenSetting, userGidSetting, workspaceGidSetting, syncFromSetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "asanaAccessToken" } }),
    prisma.setting.findUnique({ where: { key: "asanaUserGid" } }),
    prisma.setting.findUnique({ where: { key: "asanaWorkspaceGid" } }),
    prisma.setting.findUnique({ where: { key: "asanaSyncFrom" } }),
  ]);

  const token = tokenSetting?.value || process.env.ASANA_ACCESS_TOKEN || null;
  const userGid = userGidSetting?.value || process.env.ASANA_USER_GID || null;
  const workspaceGid = workspaceGidSetting?.value || process.env.ASANA_WORKSPACE_GID || null;
  const syncFrom = syncFromSetting?.value ?? null;

  return NextResponse.json({
    hasToken: !!token,
    tokenPreview: token ? `${token.slice(0, 6)}${"•".repeat(8)}${token.slice(-4)}` : null,
    userGid,
    workspaceGid,
    syncFrom,
  });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const { accessToken, userGid, workspaceGid } = await req.json();

  await Promise.all([
    accessToken !== undefined && prisma.setting.upsert({
      where: { key: "asanaAccessToken" },
      create: { key: "asanaAccessToken", value: String(accessToken).trim() },
      update: { value: String(accessToken).trim() },
    }),
    userGid !== undefined && prisma.setting.upsert({
      where: { key: "asanaUserGid" },
      create: { key: "asanaUserGid", value: String(userGid).trim() },
      update: { value: String(userGid).trim() },
    }),
    workspaceGid !== undefined && prisma.setting.upsert({
      where: { key: "asanaWorkspaceGid" },
      create: { key: "asanaWorkspaceGid", value: String(workspaceGid).trim() },
      update: { value: String(workspaceGid).trim() },
    }),
  ].filter(Boolean));

  return NextResponse.json({ ok: true });
}
