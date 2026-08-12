import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { id } = await params;
  const { isArchived } = await req.json() as { isArchived: boolean };

  const budget = await prisma.budget.update({
    where: { id },
    data: { isArchived: Boolean(isArchived) },
  });

  return NextResponse.json({ ok: true, budget });
}
