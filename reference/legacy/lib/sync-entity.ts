import { prisma } from "./prisma";

export async function syncLegalEntity(
  companyName: string | null | undefined,
  country: string,
  currency: string | null | undefined,
) {
  if (!companyName?.trim()) return;
  const existing = await prisma.legalEntity.findFirst({
    where: { name: companyName.trim(), country: country.trim() },
  });
  if (!existing) {
    await prisma.legalEntity.create({
      data: { name: companyName.trim(), country: country.trim(), currency: currency ?? null },
    });
  } else if (currency && existing.currency !== currency) {
    await prisma.legalEntity.update({
      where: { id: existing.id },
      data: { currency },
    });
  }
}
