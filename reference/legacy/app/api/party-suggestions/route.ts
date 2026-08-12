import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [docs, people] = await Promise.all([
    prisma.document.findMany({ select: { parties: true }, where: { parties: { not: null } } }),
    prisma.person.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
  ]);

  const names = new Set<string>();

  for (const doc of docs) {
    try {
      const parsed = JSON.parse(doc.parties!);
      if (Array.isArray(parsed)) parsed.forEach((p: string) => { if (p?.trim()) names.add(p.trim()); });
    } catch {}
  }

  for (const person of people) {
    if (person.name?.trim()) names.add(person.name.trim());
  }

  return NextResponse.json({ suggestions: Array.from(names).sort((a, b) => a.localeCompare(b)) });
}
