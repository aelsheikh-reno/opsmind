import { NextRequest, NextResponse } from "next/server";
import { requireRead } from "@/lib/permissions";
import { parseSheet, parseTimesheetRows, PROJECT_COL_CANDIDATES, PROJECT_COL_CONTAINS, norm } from "@/lib/timesheetParser";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let rows: Array<Record<string, unknown>>;
  try {
    rows = parseSheet(buffer);
  } catch {
    return NextResponse.json({ error: "Could not parse file — upload CSV or Excel" }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "File appears to be empty" }, { status: 400 });
  }

  // Detect project column key from header row
  const firstRow = rows[0];
  const keys = Object.keys(firstRow);
  let projectColKey: string | null = null;
  for (const c of PROJECT_COL_CANDIDATES) {
    const match = keys.find(k => norm(k) === norm(c));
    if (match) { projectColKey = match; break; }
  }
  if (!projectColKey) {
    for (const kw of PROJECT_COL_CONTAINS) {
      const match = keys.find(k => norm(k).includes(norm(kw)));
      if (match) { projectColKey = match; break; }
    }
  }

  if (!projectColKey) {
    return NextResponse.json(
      { error: "No project or client column found in the file. Expected a column named Project, Client, or Account." },
      { status: 422 },
    );
  }

  // Collect unique non-empty project names
  const nameSet = new Set<string>();
  for (const row of rows) {
    const val = row[projectColKey];
    const s = val != null ? String(val).trim() : "";
    if (s) nameSet.add(s);
  }

  const projectNames = Array.from(nameSet).sort();

  if (projectNames.length === 0) {
    return NextResponse.json({ error: "No project names found in the file" }, { status: 422 });
  }

  // Check which names already exist as projects
  const existingProjects = await prisma.project.findMany({
    select: { id: true, name: true, status: true },
  });

  function normName(n: string) {
    return n.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
  }

  // Word-overlap score for fuzzy matching (same approach as timesheet person matching)
  function wordScore(a: string, b: string): number {
    const na = a.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
    const nb = b.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
    if (na === nb) return 1;
    const wa = na.split(" ").filter(w => w.length >= 2);
    const wb = nb.split(" ").filter(w => w.length >= 2);
    if (!wa.length || !wb.length) return 0;
    const overlap = wa.filter(w => wb.includes(w)).length;
    return overlap / Math.max(wa.length, wb.length);
  }

  const results = projectNames.map(name => {
    // First try exact (normalised) match
    const exact = existingProjects.find(p => normName(p.name) === normName(name));
    if (exact) {
      return {
        name,
        exists: true,
        fuzzyMatch: false,
        fuzzyScore: 1,
        existingProjectId: exact.id,
        existingProjectName: exact.name,
        existingProjectStatus: exact.status,
      };
    }
    // Then try fuzzy match (word overlap >= 0.5)
    let best: typeof existingProjects[0] | null = null;
    let bestScore = 0;
    for (const p of existingProjects) {
      const s = wordScore(name, p.name);
      if (s > bestScore && s >= 0.5) { best = p; bestScore = s; }
    }
    if (best) {
      return {
        name,
        exists: false,
        fuzzyMatch: true,
        fuzzyScore: bestScore,
        existingProjectId: best.id,
        existingProjectName: best.name,
        existingProjectStatus: best.status,
      };
    }
    return {
      name,
      exists: false,
      fuzzyMatch: false,
      fuzzyScore: 0,
      existingProjectId: null,
      existingProjectName: null,
      existingProjectStatus: null,
    };
  });

  // Also parse all rows into typed entries so the modal can show a preview and
  // drive the bulk-import step without re-uploading the file.
  const { parsed: entries } = parseTimesheetRows(rows, projectNames, []);

  return NextResponse.json({ projects: results, columnUsed: projectColKey, entries });
}
