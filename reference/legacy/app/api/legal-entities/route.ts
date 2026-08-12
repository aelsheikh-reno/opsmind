import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [taxConfigs, vatConfigs] = await Promise.all([
    prisma.taxConfig.findMany({
      where: { active: true, companyName: { not: null } },
      select: { companyName: true, country: true, currency: true },
    }),
    prisma.vatConfig.findMany({
      where: { active: true, companyName: { not: null } },
      select: { companyName: true, country: true, currency: true },
    }),
  ]);

  // Deduplicate by (companyName, country)
  const unique = new Map<string, { name: string; country: string; currency: string | null }>();
  for (const c of [...taxConfigs, ...vatConfigs]) {
    if (!c.companyName) continue;
    const key = `${c.companyName.trim().toLowerCase()}|${c.country.trim().toLowerCase()}`;
    if (!unique.has(key)) {
      unique.set(key, { name: c.companyName.trim(), country: c.country.trim(), currency: c.currency ?? null });
    }
  }

  // Find or create a LegalEntity for each unique company
  const result = await Promise.all(
    Array.from(unique.values()).map(async (e) => {
      let entity = await prisma.legalEntity.findFirst({ where: { name: e.name, country: e.country } });
      if (!entity) {
        entity = await prisma.legalEntity.create({ data: e });
      } else if (e.currency && entity.currency !== e.currency) {
        entity = await prisma.legalEntity.update({ where: { id: entity.id }, data: { currency: e.currency } });
      }
      return { id: entity.id, name: entity.name, country: entity.country, currency: entity.currency };
    })
  );

  return NextResponse.json(result.sort((a, b) => a.name.localeCompare(b.name)));
}
