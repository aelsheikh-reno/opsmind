import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { tokenize } from "@/lib/name-match";
import { audit } from "@/lib/audit";
import { requireWrite } from "@/lib/permissions";

function moreCompleteTokens(a: string, b: string): string {
  return tokenize(a).length >= tokenize(b).length ? a : b;
}

export async function POST(request: NextRequest) {
  const denied = await requireWrite("people");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const { keepId, discardId, payrollOnlyName, updatePayrollSalary = false } = body ?? {};

  if (!keepId) {
    return NextResponse.json({ error: "keepId is required" }, { status: 400 });
  }

  // Payroll-only linking: link unattached PayrollEntry rows by name to this Person
  if (payrollOnlyName) {
    const keepPerson = await prisma.person.findUnique({ where: { id: keepId } });
    if (!keepPerson) return NextResponse.json({ error: "Person not found" }, { status: 404 });

    const entries = await prisma.payrollEntry.findMany({
      where: { personId: null, employeeName: payrollOnlyName },
      select: { payrollRunId: true },
    });

    const updateData: Parameters<typeof prisma.payrollEntry.updateMany>[0]["data"] = {
      personId: keepId,
      employeeName: keepPerson.name,
    };
    if (updatePayrollSalary && keepPerson.salary != null) {
      updateData.salary = keepPerson.salary;
      if (keepPerson.salaryCurrency != null) updateData.currency = keepPerson.salaryCurrency;
    }

    await prisma.payrollEntry.updateMany({
      where: { personId: null, employeeName: payrollOnlyName },
      data: updateData,
    });

    const runIds = new Set(entries.map((e) => e.payrollRunId));
    for (const runId of runIds) {
      const agg = await prisma.payrollEntry.aggregate({
        where: { payrollRunId: runId },
        _sum: { salary: true },
      });
      await prisma.payrollRun.update({
        where: { id: runId },
        data: { totalAmount: agg._sum.salary ?? 0 },
      });
    }

    await audit({ action: "employee.merged", entityType: "person", entityId: keepId, entityLabel: keepPerson.name, details: { linkedPayrollName: payrollOnlyName, updatePayrollSalary } });
    return NextResponse.json({ success: true, canonicalName: keepPerson.name });
  }

  if (!discardId || keepId === discardId) {
    return NextResponse.json({ error: "discardId required and must differ from keepId" }, { status: 400 });
  }

  const [keepPerson, discardPerson] = await Promise.all([
    prisma.person.findUnique({ where: { id: keepId } }),
    prisma.person.findUnique({ where: { id: discardId } }),
  ]);

  if (!keepPerson || !discardPerson) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  // Fetch discard entries to detect duplicates before reassigning
  const discardEntries = await prisma.payrollEntry.findMany({
    where: { personId: discardId },
    select: { id: true, payrollRunId: true, salary: true, currency: true },
  });

  const affectedRunIds = new Set<string>();

  for (const entry of discardEntries) {
    affectedRunIds.add(entry.payrollRunId);
    const conflict = await prisma.payrollEntry.findFirst({
      where: { payrollRunId: entry.payrollRunId, personId: keepId },
      select: { id: true },
    });
    if (conflict) {
      // Duplicate in same run — optionally update salary on the kept entry, then drop the discard one
      if (updatePayrollSalary && entry.salary != null) {
        await prisma.payrollEntry.update({
          where: { id: conflict.id },
          data: { salary: entry.salary, currency: entry.currency },
        });
      }
      await prisma.payrollEntry.delete({ where: { id: entry.id } });
    }
  }

  // Reassign remaining (non-conflicting) discard entries to keepPerson.
  // When not updating salary, normalize to keepPerson's salary so all entries are consistent.
  const reassignData: Parameters<typeof prisma.payrollEntry.updateMany>[0]["data"] = {
    personId: keepId,
    employeeName: keepPerson.name,
  };
  if (!updatePayrollSalary && keepPerson.salary != null) {
    reassignData.salary = keepPerson.salary;
    if (keepPerson.salaryCurrency != null) reassignData.currency = keepPerson.salaryCurrency;
  }
  await prisma.payrollEntry.updateMany({
    where: { personId: discardId },
    data: reassignData,
  });

  // Recompute totals for all affected runs
  for (const runId of affectedRunIds) {
    const agg = await prisma.payrollEntry.aggregate({
      where: { payrollRunId: runId },
      _sum: { salary: true },
    });
    await prisma.payrollRun.update({
      where: { id: runId },
      data: { totalAmount: agg._sum.salary ?? 0 },
    });
  }

  // Transfer documentId to keepPerson if they don't have one
  let newDocumentId = keepPerson.documentId;
  if (!newDocumentId && discardPerson.documentId) {
    await prisma.person.update({ where: { id: discardId }, data: { documentId: null } });
    newDocumentId = discardPerson.documentId;
  }

  const canonicalName = moreCompleteTokens(keepPerson.name, discardPerson.name);

  await prisma.person.update({
    where: { id: keepId },
    data: {
      name: canonicalName,
      documentId: newDocumentId,
      jobTitle:      keepPerson.jobTitle      ?? discardPerson.jobTitle,
      department:    keepPerson.department    ?? discardPerson.department,
      nationality:   keepPerson.nationality   ?? discardPerson.nationality,
      contractStart: keepPerson.contractStart ?? discardPerson.contractStart,
      contractEnd:   keepPerson.contractEnd   ?? discardPerson.contractEnd,
      salary:        updatePayrollSalary ? (discardPerson.salary ?? keepPerson.salary) : (keepPerson.salary ?? discardPerson.salary),
      salaryCurrency: updatePayrollSalary ? (discardPerson.salaryCurrency ?? keepPerson.salaryCurrency) : (keepPerson.salaryCurrency ?? discardPerson.salaryCurrency),
    },
  });

  await prisma.person.delete({ where: { id: discardId } });

  await audit({ action: "employee.merged", entityType: "person", entityId: keepId, entityLabel: canonicalName, details: { mergedFrom: discardPerson.name, updatePayrollSalary } });
  return NextResponse.json({ success: true, canonicalName });
}
