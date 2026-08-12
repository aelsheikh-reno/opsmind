import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type EntryInput = {
  employeeName: string;
  role: string | null;
  taskName: string | null;
  hoursLogged: number;
  hourlyRate: number | null;
  currency: string;
  notes: string | null;
  date: string | null; // "YYYY-MM-DD"
};

type MonthInput = {
  ym: string;           // "YYYY-MM"
  entries: EntryInput[];
};

type ProjectImport = {
  projectId: string;
  milestoneName: string | null; // non-null → create milestone and link all entries across all months
  months: MonthInput[];
};

export async function POST(req: NextRequest) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { projects } = await req.json() as { projects: ProjectImport[] };

  if (!Array.isArray(projects) || projects.length === 0) {
    return NextResponse.json({ error: "projects array is required" }, { status: 400 });
  }

  const results: { projectId: string; importId: string; milestoneId: string | null; entryCount: number; month: string }[] = [];

  for (const proj of projects) {
    if (!proj.projectId || !Array.isArray(proj.months) || proj.months.length === 0) continue;

    // Create the milestone once per project (covers all months) if requested
    let milestoneId: string | null = null;
    if (proj.milestoneName) {
      const milestone = await prisma.projectMilestone.create({
        data: {
          projectId: proj.projectId,
          name: proj.milestoneName,
          order: 0,
        },
      });
      milestoneId = milestone.id;
    }

    // One TimesheetImport record per (project, month), entries batched under each
    for (const mg of proj.months) {
      if (!mg.ym || !Array.isArray(mg.entries) || mg.entries.length === 0) continue;

      const importRecord = await prisma.timesheetImport.create({
        data: {
          projectId: proj.projectId,
          month: mg.ym,
          filename: `bulk-import-${mg.ym}.csv`,
        },
      });

      await prisma.timesheetEntry.createMany({
        data: mg.entries.map(e => ({
          importId: importRecord.id,
          milestoneId: milestoneId,
          employeeName: e.employeeName,
          role: e.role,
          taskName: e.taskName,
          hoursLogged: e.hoursLogged,
          hourlyRate: e.hourlyRate,
          currency: e.currency || "AED",
          notes: e.notes,
          date: e.date,
        })),
      });

      results.push({ projectId: proj.projectId, importId: importRecord.id, milestoneId, entryCount: mg.entries.length, month: mg.ym });
    }

    // Ensure each employee name appears as a team member on the project (once per project)
    const allEntries = proj.months.flatMap(m => m.entries);
    const existingMembers = await prisma.projectTeamMember.findMany({
      where: { projectId: proj.projectId },
      select: { name: true },
    });
    const existingNames = new Set(existingMembers.map(m => m.name.toLowerCase()));
    const newNames = [...new Set(allEntries.map(e => e.employeeName))]
      .filter(n => n && !existingNames.has(n.toLowerCase()));

    if (newNames.length > 0) {
      await prisma.projectTeamMember.createMany({
        data: newNames.map(name => ({ projectId: proj.projectId, name })),
        skipDuplicates: true,
      });
    }
  }

  return NextResponse.json({ imported: results });
}
