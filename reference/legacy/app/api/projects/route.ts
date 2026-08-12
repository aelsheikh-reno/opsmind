import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireRead, requireWrite } from "@/lib/permissions";
import { audit } from "@/lib/audit";

export async function GET() {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      milestones: { orderBy: { order: "asc" } },
      invoices: { select: { amount: true, status: true } },
      documentLinks: {
        include: {
          document: { select: { amount: true, isPaid: true, currency: true } },
        },
      },
      timesheets: {
        include: { entries: { select: { hoursLogged: true, hourlyRate: true, currency: true } } },
      },
      expenses: { select: { amount: true, currency: true } },
    },
  });

  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { name, clientName, description, contractValue, currency, startDate, endDate, status, billingType, color } =
    await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      clientName: clientName?.trim() || null,
      description: description?.trim() || null,
      contractValue: contractValue ? parseFloat(contractValue) : null,
      currency: currency || "AED",
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      status: status || "active",
      billingType: billingType || "fixed",
      color: color || null,
    },
  });

  await audit({
    action: "project.created",
    entityType: "project",
    entityId: project.id,
    entityLabel: project.name,
    details: { billingType: project.billingType, clientName: project.clientName },
  });

  return NextResponse.json(project, { status: 201 });
}
