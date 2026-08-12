import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  if (process.env.IS_DEMO !== "true") {
    return NextResponse.json({ error: "Not available in this environment" }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Wipe all data except User (so the session stays valid)
    await prisma.expenseAttachment.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.payrollEntry.deleteMany();
    await prisma.payrollRun.deleteMany();
    await prisma.alert.deleteMany();
    await prisma.taxPayment.deleteMany();
    await prisma.taxConfig.deleteMany();
    await prisma.vatPayment.deleteMany();
    await prisma.vatConfig.deleteMany();
    await prisma.paymentSchedule.deleteMany();
    await prisma.person.deleteMany();
    await prisma.document.deleteMany();
    await prisma.legalEntity.deleteMany();
    // Remove wizardCompleted so onboarding shows again
    await prisma.setting.deleteMany({ where: { key: "wizardCompleted" } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[demo/reset]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
