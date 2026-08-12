import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;
  const record = await prisma.projectAiSuggestion.findUnique({ where: { projectId } });
  if (!record) return NextResponse.json(null);
  return NextResponse.json(record.data);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;
  const data = await req.json();

  const record = await prisma.projectAiSuggestion.upsert({
    where: { projectId },
    create: { projectId, data },
    update: { data },
  });

  return NextResponse.json(record.data);
}
