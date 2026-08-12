import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

// PUT { documentId, milestoneId?, serviceId? } — upsert assignment
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id } = await params;
  const { documentId, milestoneId, serviceId } = await req.json();

  if (!documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });

  const link = await prisma.projectDocumentLink.upsert({
    where: { projectId_documentId: { projectId: id, documentId } },
    create: {
      projectId: id,
      documentId,
      milestoneId: milestoneId || null,
      serviceId: serviceId || null,
    },
    update: {
      milestoneId: milestoneId || null,
      serviceId: serviceId || null,
    },
    include: {
      milestone: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(link);
}

// DELETE ?documentId=xxx — remove assignment
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id } = await params;
  const documentId = req.nextUrl.searchParams.get("documentId");

  if (!documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });

  await prisma.projectDocumentLink.deleteMany({
    where: { projectId: id, documentId },
  });

  return NextResponse.json({ success: true });
}
