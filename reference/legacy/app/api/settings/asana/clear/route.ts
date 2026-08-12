import { NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const { count } = await prisma.expense.deleteMany({
    where: { asanaTaskGid: { not: null } },
  });

  return NextResponse.json({ deleted: count });
}
