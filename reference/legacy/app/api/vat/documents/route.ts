import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const docs = await prisma.document.findMany({
    where: { status: "done", filePath: { not: null } },
    select: {
      id: true,
      filename: true,
      docType: true,
      issueDate: true,
      amount: true,
      currency: true,
      referenceNumber: true,
    },
    orderBy: { issueDate: "desc" },
    take: 200,
  });

  return NextResponse.json(docs.map((d) => ({
    id: d.id,
    filename: d.filename,
    docType: d.docType,
    issueDate: d.issueDate?.toISOString() ?? null,
    amount: d.amount,
    currency: d.currency,
    referenceNumber: d.referenceNumber,
  })));
}
