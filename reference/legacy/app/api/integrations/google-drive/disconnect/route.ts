import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  await prisma.driveConnection.deleteMany();
  return NextResponse.json({ ok: true });
}
