import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { uploadFile } from "@/lib/storage";
import {
  parseSheet,
  parseTimesheetRows,
  ParsedRow,
} from "@/lib/timesheetParser";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id: projectId } = await params;

  const contentType = req.headers.get("content-type") ?? "";

  // ── JSON path: save pre-reviewed rows from the preview step ──────────────
  if (contentType.includes("application/json")) {
    const body = await req.json() as { month: string; filename: string; rows: ParsedRow[]; aiPrompt?: string };
    const { month, filename, rows, aiPrompt } = body;

    if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 });
    if (!rows?.length) return NextResponse.json({ error: "No rows selected" }, { status: 400 });

    // Auto-assign service for PS projects
    const projectServices = await prisma.projectService.findMany({
      where: { projectId },
      select: { id: true, name: true },
      orderBy: { order: "asc" },
    });

    function autoMatchService(taskName: string | null): string | null {
      if (projectServices.length === 0) return null;
      if (projectServices.length === 1) return projectServices[0].id;
      if (!taskName) return null;
      const t = taskName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length >= 3);
      let bestId: string | null = null, bestScore = 0;
      for (const svc of projectServices) {
        const s = svc.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length >= 3);
        const common = t.filter(w => s.some(sw => sw.includes(w) || w.includes(sw))).length;
        if (common === 0) continue;
        const score = common / Math.max(t.length, s.length);
        if (score > bestScore) { bestScore = score; bestId = svc.id; }
      }
      return bestId;
    }

    const timesheetImport = await prisma.timesheetImport.create({
      data: {
        projectId,
        month,
        filename: filename ?? null,
        aiPrompt: aiPrompt || null,
        entries: {
          create: rows.map(r => ({
            employeeName: r.employeeName,
            taskName: r.taskName,
            date: r.date ?? null,
            milestoneId: r.milestoneId,
            serviceId: autoMatchService(r.taskName),
            hoursLogged: r.hoursLogged,
            hourlyRate: r.hourlyRate,
            role: r.role,
            currency: r.currency,
            notes: r.notes,
          })),
        },
      },
      include: {
        entries: {
          include: {
            milestone: { select: { id: true, name: true } },
            service: { select: { id: true, name: true } },
          },
        },
      },
    });

    return NextResponse.json(timesheetImport, { status: 201 });
  }

  // ── Form-data path: legacy direct upload ─────────────────────────────────
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const month = formData.get("month") as string | null;

  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let rows: Array<Record<string, unknown>>;
  try {
    rows = parseSheet(buffer);
  } catch {
    return NextResponse.json(
      { error: "Could not parse file — upload CSV or Excel" },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "File appears to be empty" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      clientName: true,
      milestones: { select: { id: true, name: true }, orderBy: { order: "asc" } },
    },
  });

  const projectNames = [project?.name, project?.clientName].filter(Boolean) as string[];
  const { parsed } = parseTimesheetRows(rows, projectNames, project?.milestones ?? []);

  if (parsed.length === 0) {
    return NextResponse.json(
      {
        error:
          "No valid rows found. File needs a column for the person (Employee, Name, User, Member…) and one for time (Hours, Duration, Time Spent, Hrs…).",
      },
      { status: 400 },
    );
  }

  const ext = file.name.split(".").pop() ?? "csv";
  const fileKey = `projects/${projectId}/timesheets/${month}-${Date.now()}.${ext}`;
  try {
    await uploadFile(fileKey, buffer, file.type || "application/octet-stream");
  } catch { /* non-fatal */ }

  const timesheetImport = await prisma.timesheetImport.create({
    data: {
      projectId,
      month,
      fileKey,
      filename: file.name,
      entries: { create: parsed.map(r => ({
        employeeName: r.employeeName,
        taskName: r.taskName,
        date: r.date ?? null,
        milestoneId: r.milestoneId,
        hoursLogged: r.hoursLogged,
        hourlyRate: r.hourlyRate,
        role: r.role,
        currency: r.currency,
        notes: r.notes,
      })) },
    },
    include: {
      entries: {
        include: {
          milestone: { select: { id: true, name: true } },
          service: { select: { id: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json({ ...timesheetImport, skippedRows: 0 }, { status: 201 });
}
