import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { entityName, currencies, payrollDay, horizonYear, lockOnProcessing } = await req.json();

  const entries: { key: string; value: string }[] = [
    { key: "wizardCompleted", value: "true" },
    { key: "entityName", value: String(entityName ?? "").trim() },
    { key: "activeCurrencies", value: JSON.stringify(Array.isArray(currencies) && currencies.length ? currencies : ["AED", "EGP"]) },
    { key: "lockRateOnProcessing", value: String(lockOnProcessing ?? true) },
  ];
  if (payrollDay) entries.push({ key: "payrollDay", value: String(parseInt(payrollDay)) });
  if (horizonYear) entries.push({ key: "payrollHorizonYear", value: String(parseInt(horizonYear)) });

  await prisma.$transaction(
    entries.map((e) =>
      prisma.setting.upsert({
        where: { key: e.key },
        update: { value: e.value },
        create: { key: e.key, value: e.value },
      })
    )
  );

  const res = NextResponse.json({ ok: true });
  res.cookies.set("opsmind_setup", "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
