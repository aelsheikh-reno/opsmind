import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import OnboardingWizard from "./OnboardingWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const completed = await prisma.setting.findUnique({ where: { key: "wizardCompleted" } });
  if (completed?.value === "true") redirect("/dashboard");

  return <OnboardingWizard />;
}
