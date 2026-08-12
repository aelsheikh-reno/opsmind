import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const { id } = await params;

  const logs = await prisma.auditLog.findMany({
    where: { entityId: id, entityType: "project" },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json(logs);
}
