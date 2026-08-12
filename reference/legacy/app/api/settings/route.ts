import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function GET() {
  const settings = await prisma.setting.findMany();
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;
  return NextResponse.json(map);
}

export async function POST(req: Request) {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const { key, value } = await req.json();
  if (!key || value === undefined) {
    return NextResponse.json({ error: "key and value required" }, { status: 400 });
  }
  await prisma.setting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
  return NextResponse.json({ ok: true });
}
