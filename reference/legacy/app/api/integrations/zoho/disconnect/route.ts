import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";

export async function DELETE() {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  await prisma.zohoConnection.deleteMany();
  return NextResponse.json({ ok: true });
}
