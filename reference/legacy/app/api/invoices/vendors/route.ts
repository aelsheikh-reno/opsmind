import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const docType = req.nextUrl.searchParams.get("docType");
  const docs = await prisma.document.findMany({
    where: docType ? { docType } : { docType: { in: ["invoice", "purchase_order"] } },
    select: { parties: true },
  });

  const seen = new Set<string>();
  for (const doc of docs) {
    if (!doc.parties) continue;
    try {
      const parties: string[] = JSON.parse(doc.parties);
      for (const p of parties) {
        const trimmed = p?.trim();
        if (trimmed) seen.add(trimmed);
      }
    } catch { /* skip malformed rows */ }
  }

  const vendors = Array.from(seen).sort((a, b) => a.localeCompare(b));
  return NextResponse.json({ vendors });
}
