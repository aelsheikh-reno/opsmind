import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ docs: [] });

  const since = req.nextUrl.searchParams.get("since");
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 60_000);

  const docs = await prisma.document.findMany({
    where: { source: "email", createdAt: { gt: sinceDate } },
    select: { id: true, filename: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ docs });
}
