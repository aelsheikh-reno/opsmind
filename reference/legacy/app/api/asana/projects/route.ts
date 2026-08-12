import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRead } from "@/lib/permissions";

async function getAsanaToken(): Promise<string> {
  const setting = await prisma.setting.findUnique({ where: { key: "asanaAccessToken" } });
  return setting?.value || process.env.ASANA_ACCESS_TOKEN || "";
}

export async function GET() {
  const denied = await requireRead("projects");
  if (denied) return denied;

  const token = await getAsanaToken();
  if (!token) return NextResponse.json({ error: "Asana not configured" }, { status: 400 });

  const workspaceSetting = await prisma.setting.findUnique({ where: { key: "asanaWorkspaceGid" } });
  const workspaceGid = workspaceSetting?.value || process.env.ASANA_WORKSPACE_GID || "";
  if (!workspaceGid) return NextResponse.json({ error: "Asana workspace not configured" }, { status: 400 });

  // 1. Fetch teams in the workspace
  const teamsRes = await fetch(
    `https://app.asana.com/api/1.0/workspaces/${workspaceGid}/teams?opt_fields=gid,name&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const teamsData = teamsRes.ok
    ? await teamsRes.json() as { data: { gid: string; name: string }[] }
    : { data: [] };
  const teamGids = (teamsData.data ?? []).map((t: { gid: string }) => t.gid);

  // 2. Fetch projects — by workspace first, then by each team to catch team-only projects
  const seen = new Set<string>();
  const projects: { gid: string; name: string }[] = [];

  async function fetchProjects(params: Record<string, string>) {
    let offset: string | undefined;
    do {
      const url = new URL("https://app.asana.com/api/1.0/projects");
      url.searchParams.set("opt_fields", "gid,name");
      url.searchParams.set("limit", "100");
      url.searchParams.set("archived", "false");
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) break;
      const data = await res.json() as { data: { gid: string; name: string }[]; next_page?: { offset: string } };
      for (const p of data.data ?? []) {
        if (!seen.has(p.gid)) { seen.add(p.gid); projects.push(p); }
      }
      offset = data.next_page?.offset;
    } while (offset);
  }

  await fetchProjects({ workspace: workspaceGid });
  for (const teamGid of teamGids) {
    await fetchProjects({ team: teamGid });
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ projects });
}
