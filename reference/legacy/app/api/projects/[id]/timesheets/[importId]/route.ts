import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; importId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { importId } = await params;
  await prisma.timesheetImport.delete({ where: { id: importId } });
  return NextResponse.json({ success: true });
}
