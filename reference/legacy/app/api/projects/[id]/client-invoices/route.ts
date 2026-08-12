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
  const project = await prisma.project.findUnique({
    where: { id },
    select: { clientName: true },
  });

  if (!project?.clientName) return NextResponse.json([]);

  const clientName = project.clientName.toLowerCase();

  // Fetch all invoice documents and filter by party name match
  const allDocs = await prisma.document.findMany({
    where: { docType: "invoice", parties: { not: null } },
    select: {
      id: true,
      filename: true,
      status: true,
      amount: true,
      vatAmount: true,
      currency: true,
      issueDate: true,
      expiryDate: true,
      isPaid: true,
      paidAt: true,
      referenceNumber: true,
      summary: true,
      parties: true,
    },
    orderBy: { issueDate: "desc" },
  });

  const filtered = allDocs.filter(doc => {
    try {
      const parties: string[] = JSON.parse(doc.parties!);
      return parties.some(p => p.trim().toLowerCase() === clientName);
    } catch { return false; }
  });

  // Fetch existing milestone assignments for this project
  const links = await prisma.projectDocumentLink.findMany({
    where: { projectId: id },
    select: {
      documentId: true,
      milestoneId: true,
      milestone: { select: { id: true, name: true } },
      serviceId: true,
      service: { select: { id: true, name: true } },
    },
  });
  const linkMap = new Map(links.map(l => [l.documentId, l]));

  const docs = filtered.map(doc => ({
    ...doc,
    milestoneId: linkMap.get(doc.id)?.milestoneId ?? null,
    milestoneName: linkMap.get(doc.id)?.milestone?.name ?? null,
    serviceId: linkMap.get(doc.id)?.serviceId ?? null,
    serviceName: linkMap.get(doc.id)?.service?.name ?? null,
  }));

  return NextResponse.json(docs);
}
