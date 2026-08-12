import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ documents: [], people: [], projects: [], expenses: [], clients: [] });

  const mode = "insensitive" as const;

  const [documents, people, projects, expenses, clients] = await Promise.all([
    prisma.document.findMany({
      where: {
        OR: [
          { filename:        { contains: q, mode } },
          { referenceNumber: { contains: q, mode } },
          { summary:         { contains: q, mode } },
          { parties:         { contains: q, mode } },
        ],
      },
      select: { id: true, filename: true, docType: true, parties: true, referenceNumber: true },
      take: 5,
      orderBy: { createdAt: "desc" },
    }),

    prisma.person.findMany({
      where: {
        OR: [
          { name:        { contains: q, mode } },
          { jobTitle:    { contains: q, mode } },
          { department:  { contains: q, mode } },
          { nationality: { contains: q, mode } },
          { email:       { contains: q, mode } },
        ],
      },
      select: { id: true, name: true, jobTitle: true, department: true },
      take: 4,
    }),

    prisma.project.findMany({
      where: {
        OR: [
          { name:        { contains: q, mode } },
          { clientName:  { contains: q, mode } },
          { description: { contains: q, mode } },
        ],
      },
      select: { id: true, name: true, clientName: true, status: true, billingType: true },
      take: 4,
      orderBy: { createdAt: "desc" },
    }),

    prisma.expense.findMany({
      where: {
        OR: [
          { name:        { contains: q, mode } },
          { notes:       { contains: q, mode } },
          { expenseType: { contains: q, mode } },
        ],
      },
      select: { id: true, name: true, expenseType: true, amount: true, currency: true, claimStatus: true },
      take: 4,
      orderBy: { asanaCreatedAt: "desc" },
    }),

    prisma.legalEntity.findMany({
      where: {
        OR: [
          { name:    { contains: q, mode } },
          { country: { contains: q, mode } },
        ],
      },
      select: { id: true, name: true, country: true },
      take: 3,
    }),
  ]);

  return NextResponse.json({ documents, people, projects, expenses, clients });
}
