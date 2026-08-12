/**
 * One-time cleanup: delete duplicate ProjectMemberAllocation rows.
 * For each (projectId, memberName, startDate) group, keep the most
 * recently created record and delete all older ones.
 *
 * Run: DATABASE_URL="..." node scripts/dedup-allocations.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const all = await prisma.projectMemberAllocation.findMany({
    orderBy: [{ projectId: "asc" }, { memberName: "asc" }, { startDate: "asc" }, { createdAt: "asc" }],
  });

  // Group by composite key
  const groups = new Map();
  for (const a of all) {
    const key = `${a.projectId}||${a.memberName.toLowerCase()}||${a.startDate.toISOString().slice(0, 10)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }

  let totalDeleted = 0;
  for (const [key, records] of groups) {
    if (records.length <= 1) continue;
    // Keep the most recently created; delete the rest
    records.sort((a, b) => b.createdAt - a.createdAt);
    const toDelete = records.slice(1).map(r => r.id);
    console.log(`  [${key}] keeping ${records[0].id} (${records[0].allocationPercent}%), deleting ${toDelete.length} duplicates`);
    await prisma.projectMemberAllocation.deleteMany({ where: { id: { in: toDelete } } });
    totalDeleted += toDelete.length;
  }

  console.log(`\nDone. Deleted ${totalDeleted} duplicate allocation rows.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
