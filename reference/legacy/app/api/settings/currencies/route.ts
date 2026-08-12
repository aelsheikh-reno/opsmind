import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsdRates } from "@/lib/fx";
import { CURRENCIES } from "@/lib/currencies";
import { requireWrite } from "@/lib/permissions";

// GET is intentionally unauthenticated — the claim page (public) needs it.
export async function GET() {
  const setting = await prisma.setting.findUnique({ where: { key: "activeCurrencies" } });
  const currencies: string[] = setting
    ? (JSON.parse(setting.value) as string[])
    : ["USD", "AED"];

  // Ensure USD is always present
  const list = currencies.includes("USD") ? currencies : ["USD", ...currencies];

  const rates = await getUsdRates();
  const rateMap: Record<string, number> = { USD: 1 };
  for (const c of list) {
    if (c !== "USD" && rates[c]) rateMap[c] = rates[c];
  }

  return NextResponse.json({ currencies: list, rates: rateMap });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireWrite("settings");
  if (guard) return guard;

  const { currencies } = await req.json() as { currencies: string[] };

  // Validate — only allow known currencies
  const valid = currencies.filter(c => (CURRENCIES as readonly string[]).includes(c));
  const list = valid.includes("USD") ? valid : ["USD", ...valid];

  await prisma.setting.upsert({
    where: { key: "activeCurrencies" },
    update: { value: JSON.stringify(list) },
    create: { key: "activeCurrencies", value: JSON.stringify(list) },
  });

  return NextResponse.json({ currencies: list });
}
