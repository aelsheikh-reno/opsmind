import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST() {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const [tokenSetting, userGidSetting, workspaceGidSetting] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "asanaAccessToken" } }),
    prisma.setting.findUnique({ where: { key: "asanaUserGid" } }),
    prisma.setting.findUnique({ where: { key: "asanaWorkspaceGid" } }),
  ]);

  const token = tokenSetting?.value || process.env.ASANA_ACCESS_TOKEN;
  const userGid = userGidSetting?.value || process.env.ASANA_USER_GID;
  const workspaceGid = workspaceGidSetting?.value || process.env.ASANA_WORKSPACE_GID;

  if (!token || !userGid || !workspaceGid) {
    return NextResponse.json({ ok: false, error: "Credentials not configured" });
  }

  try {
    const res = await fetch("https://app.asana.com/api/1.0/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Asana returned ${res.status}` });
    }
    const data = await res.json() as { data?: { name?: string; email?: string } };
    return NextResponse.json({ ok: true, name: data.data?.name, email: data.data?.email });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) });
  }
}
