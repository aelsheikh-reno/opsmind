import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const setting = await prisma.setting.findUnique({ where: { key: "wizardCompleted" } });
  return NextResponse.json({ completed: setting?.value === "true" });
}
