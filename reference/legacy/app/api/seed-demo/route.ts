import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function d(year: number, month: number, day = 1): Date {
  return new Date(year, month - 1, day);
}

function addMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

async function wipe(): Promise<void> {
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
}

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await wipe();

    const entity = await prisma.legalEntity.create({
      data: { name: "Reno Holdings LLC", country: "UAE", currency: "AED" },
    });

    // People
    const peopleData = [
      { name: "Ahmed Al-Rashid",   jobTitle: "Chief Executive Officer", department: "Executive",       salary: 45000, salaryCurrency: "AED", contractStart: d(2022, 1), email: "ahmed@renogroup.ae" },
      { name: "Sara Johnson",      jobTitle: "Chief Financial Officer",  department: "Finance",         salary: 38000, salaryCurrency: "AED", contractStart: d(2022, 3), email: "sara@renogroup.ae" },
      { name: "Mohammed Al-Sayed", jobTitle: "Operations Director",      department: "Operations",      salary: 28000, salaryCurrency: "AED", contractStart: d(2022, 6), email: "mohammed@renogroup.ae" },
      { name: "Layla Hassan",      jobTitle: "Marketing Manager",        department: "Marketing",       salary: 22000, salaryCurrency: "AED", contractStart: d(2023, 1), email: "layla@renogroup.ae" },
      { name: "James Whitmore",    jobTitle: "Senior Engineer",          department: "Engineering",     salary: 20000, salaryCurrency: "AED", contractStart: d(2023, 4), email: "james@renogroup.ae" },
      { name: "Fatima Al-Khoury", jobTitle: "HR Manager",               department: "Human Resources", salary: 17000, salaryCurrency: "AED", contractStart: d(2023, 9), email: "fatima@renogroup.ae" },
      { name: "Omar Khalil",       jobTitle: "Business Analyst",         department: "Finance",         salary: 14000, salaryCurrency: "AED", contractStart: d(2024, 2), contractEnd: d(2026, 9), email: "omar@renogroup.ae" },
    ] as const;

    const people = await Promise.all(
      peopleData.map((p) => prisma.person.create({ data: p })),
    );

    const totalSalary = peopleData.reduce((s, p) => s + p.salary, 0);

    // Payroll runs Jan–May 2026 (paid)
    const paidMonths = [
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
    ];

    for (const { year, month } of paidMonths) {
      const run = await prisma.payrollRun.create({
        data: {
          period: `${year}-${String(month).padStart(2, "0")}`,
          month,
          year,
          currency: "AED",
          totalAmount: totalSalary,
          isProcessed: true,
          processedAt: new Date(year, month - 1, 28),
        },
      });
      await Promise.all(
        people.map((person, i) =>
          prisma.payrollEntry.create({
            data: {
              payrollRunId: run.id,
              personId: person.id,
              employeeName: person.name,
              salary: peopleData[i].salary,
              currency: "AED",
              isPaid: true,
            },
          }),
        ),
      );
    }

    // Payroll run Jun 2026 (unpaid)
    const juneRun = await prisma.payrollRun.create({
      data: {
        period: "2026-06",
        month: 6,
        year: 2026,
        currency: "AED",
        totalAmount: totalSalary,
        isProcessed: false,
      },
    });
    await Promise.all(
      people.map((person, i) =>
        prisma.payrollEntry.create({
          data: {
            payrollRunId: juneRun.id,
            personId: person.id,
            employeeName: person.name,
            salary: peopleData[i].salary,
            currency: "AED",
            isPaid: false,
          },
        }),
      ),
    );

    // Invoices — 4 paid
    const paidInvoices = [
      { parties: JSON.stringify(["Al-Futtaim Group"]),   amount: 440400, currency: "AED", issueDate: d(2026, 1, 15), expiryDate: d(2026, 2, 15),  isPaid: true, paidAt: d(2026, 2, 18), referenceNumber: "INV-2026-001", summary: "Strategic advisory services Q4 2025",             legalEntityId: entity.id },
      { parties: JSON.stringify(["Dubai Municipality"]), amount: 280000, currency: "AED", issueDate: d(2026, 2, 1),  expiryDate: d(2026, 3, 1),   isPaid: true, paidAt: d(2026, 3, 5),  referenceNumber: "INV-2026-002", summary: "Urban planning consultation services",           legalEntityId: entity.id },
      { parties: JSON.stringify(["Etihad Airways"]),     amount: 185000, currency: "AED", issueDate: d(2026, 3, 10), expiryDate: d(2026, 4, 10),  isPaid: true, paidAt: d(2026, 4, 12), referenceNumber: "INV-2026-003", summary: "Operations efficiency study — Phase 1",         legalEntityId: entity.id },
      { parties: JSON.stringify(["Majid Al Futtaim"]),   amount: 349000, currency: "AED", issueDate: d(2026, 4, 20), expiryDate: d(2026, 5, 20),  isPaid: true, paidAt: d(2026, 5, 22), referenceNumber: "INV-2026-004", summary: "Retail analytics and market expansion advisory", legalEntityId: entity.id },
    ];

    await Promise.all(
      paidInvoices.map((inv) =>
        prisma.document.create({
          data: {
            ...inv,
            docType: "invoice",
            filename: `${inv.referenceNumber}.pdf`,
            mimeType: "application/pdf",
            status: "extracted",
            source: "seed",
          },
        }),
      ),
    );

    // Invoice — upcoming simple (ADNOC)
    await prisma.document.create({
      data: {
        parties: JSON.stringify(["ADNOC Consulting"]),
        amount: 550000,
        currency: "AED",
        issueDate: d(2026, 6, 1),
        expiryDate: d(2026, 10, 1),
        isPaid: false,
        referenceNumber: "INV-2026-006",
        summary: "Energy sector advisory — Q3/Q4 2026",
        docType: "invoice",
        filename: "INV-2026-006.pdf",
        mimeType: "application/pdf",
        status: "extracted",
        source: "seed",
        legalEntityId: entity.id,
      },
    });

    // Invoice — Emaar with 3-installment payment schedule
    const emaarInvoice = await prisma.document.create({
      data: {
        parties: JSON.stringify(["Emaar Properties"]),
        amount: 735000,
        currency: "AED",
        issueDate: d(2026, 5, 1),
        expiryDate: d(2026, 12, 1),
        isPaid: false,
        referenceNumber: "INV-2026-005",
        summary: "Property development strategy — Phase 2",
        docType: "invoice",
        filename: "INV-2026-005.pdf",
        mimeType: "application/pdf",
        status: "extracted",
        source: "seed",
        legalEntityId: entity.id,
      },
    });

    await prisma.paymentSchedule.createMany({
      data: [
        { documentId: emaarInvoice.id, invoiceId: emaarInvoice.id, dueDate: d(2026, 7, 1),  amount: 245000, currency: "AED", description: "Installment 1 / 3", isPaid: false },
        { documentId: emaarInvoice.id, invoiceId: emaarInvoice.id, dueDate: d(2026, 9, 1),  amount: 245000, currency: "AED", description: "Installment 2 / 3", isPaid: false },
        { documentId: emaarInvoice.id, invoiceId: emaarInvoice.id, dueDate: d(2026, 12, 1), amount: 245000, currency: "AED", description: "Installment 3 / 3", isPaid: false },
      ],
    });

    // Lease contracts
    const officeLeaseDoc = await prisma.document.create({
      data: {
        parties: JSON.stringify(["Business Bay Tower"]),
        amount: 300000,
        currency: "AED",
        issueDate: d(2025, 1, 1),
        expiryDate: d(2027, 12, 31),
        isPaid: false,
        referenceNumber: "LEASE-2025-001",
        summary: "Office space — Floor 18, Business Bay Tower, Dubai",
        docType: "lease_contract",
        filename: "LEASE-2025-001.pdf",
        mimeType: "application/pdf",
        status: "extracted",
        source: "seed",
        legalEntityId: entity.id,
      },
    });

    const warehouseLeaseDoc = await prisma.document.create({
      data: {
        parties: JSON.stringify(["Jebel Ali Logistics Park"]),
        amount: 132000,
        currency: "AED",
        issueDate: d(2025, 3, 1),
        expiryDate: d(2027, 2, 28),
        isPaid: false,
        referenceNumber: "LEASE-2025-002",
        summary: "Warehouse unit B-14, Jebel Ali Logistics Park",
        docType: "lease_contract",
        filename: "LEASE-2025-002.pdf",
        mimeType: "application/pdf",
        status: "extracted",
        source: "seed",
        legalEntityId: entity.id,
      },
    });

    // 48 monthly payment schedule rows (Jan 2026–Dec 2027, 24 months × 2 leases)
    const now = new Date();
    const leaseSchedules: {
      documentId: string;
      dueDate: Date;
      amount: number;
      currency: string;
      description: string;
      isPaid: boolean;
      paidAt: Date | null;
    }[] = [];

    for (let i = 0; i < 24; i++) {
      const due = addMonths(d(2026, 1), i);
      const isPaid = due < now;
      const paidAt = isPaid ? new Date(due.getFullYear(), due.getMonth(), 3) : null;
      const label = due.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

      leaseSchedules.push(
        { documentId: officeLeaseDoc.id,    dueDate: due, amount: 25000, currency: "AED", description: `Office rent ${label}`,    isPaid, paidAt },
        { documentId: warehouseLeaseDoc.id, dueDate: due, amount: 11000, currency: "AED", description: `Warehouse rent ${label}`, isPaid, paidAt },
      );
    }
    await prisma.paymentSchedule.createMany({ data: leaseSchedules });

    // Expenses
    const expenseRows = [
      { name: "Office supplies — Q1 2026",                  amount: 2400,  currency: "AED", expenseType: "Supplies",                 paymentMethod: "Corporate card", completed: true,  claimStatus: "approved",  dueOn: d(2026, 1, 15),  personId: people[5].id },
      { name: "Team dinner — strategy offsite",             amount: 3800,  currency: "AED", expenseType: "Food & Beverage",          paymentMethod: "Corporate card", completed: true,  claimStatus: "approved",  dueOn: d(2026, 2, 22),  personId: people[0].id },
      { name: "Adobe Creative Cloud — annual",             amount: 1200,  currency: "AED", expenseType: "Software & Subscriptions", paymentMethod: "Corporate card", completed: true,  claimStatus: "approved",  dueOn: d(2026, 3, 1),   personId: people[3].id },
      { name: "Business travel — Riyadh client meeting",   amount: 12500, currency: "AED", expenseType: "Travel",                   paymentMethod: "Personal card",  completed: true,  claimStatus: "pending",   dueOn: d(2026, 4, 8),   personId: people[0].id },
      { name: "Client entertainment — ADIPEC event",       amount: 8200,  currency: "AED", expenseType: "Entertainment",            paymentMethod: "Corporate card", completed: true,  claimStatus: "approved",  dueOn: d(2026, 4, 20),  personId: people[2].id },
      { name: "MacBook Pro — engineering",                 amount: 15000, currency: "AED", expenseType: "Equipment",                paymentMethod: "Corporate card", completed: true,  claimStatus: "approved",  dueOn: d(2026, 5, 3),   personId: people[4].id },
      { name: "GITEX conference registration",             amount: 5000,  currency: "AED", expenseType: "Training & Education",     paymentMethod: "Corporate card", completed: false, claimStatus: null,        dueOn: d(2026, 10, 1),  personId: people[3].id },
      { name: "Legal consultation fees — contract review", amount: 6500,  currency: "AED", expenseType: "Professional Services",    paymentMethod: "Bank transfer",  completed: true,  claimStatus: "approved",  dueOn: d(2026, 5, 15),  personId: people[1].id },
      { name: "Staff training — PMP certification",        amount: 4200,  currency: "AED", expenseType: "Training & Education",     paymentMethod: "Corporate card", completed: true,  claimStatus: "rejected",  claimNote: "Exceeds approved training budget for this quarter", dueOn: d(2026, 3, 18), personId: people[2].id },
    ];
    await prisma.expense.createMany({ data: expenseRows });

    // VAT config (UAE 5% quarterly)
    const vatConfig = await prisma.vatConfig.create({
      data: {
        country: "UAE",
        currency: "AED",
        rate: 0.05,
        frequencyMonths: 3,
        filingDeadlineDays: 28,
        anchorMonth: 1,
        startDate: d(2025, 1),
        active: true,
        companyName: "Reno Holdings LLC",
        taxId: "100234567800003",
      },
    });

    // VAT payments — 5 paid, 1 unpaid
    const vatPeriods = [
      { start: d(2025, 1),  end: d(2025, 3, 31),  due: d(2025, 4, 28),  paid: 42000, paidAt: d(2025, 4, 20) },
      { start: d(2025, 4),  end: d(2025, 6, 30),  due: d(2025, 7, 28),  paid: 38500, paidAt: d(2025, 7, 25) },
      { start: d(2025, 7),  end: d(2025, 9, 30),  due: d(2025, 10, 28), paid: 51200, paidAt: d(2025, 10, 22) },
      { start: d(2025, 10), end: d(2025, 12, 31), due: d(2026, 1, 28),  paid: 63800, paidAt: d(2026, 1, 24) },
      { start: d(2026, 1),  end: d(2026, 3, 31),  due: d(2026, 4, 28),  paid: 58400, paidAt: d(2026, 4, 26) },
      { start: d(2026, 4),  end: d(2026, 6, 30),  due: d(2026, 7, 28),  paid: null,  paidAt: null },
    ] as const;

    await Promise.all(
      vatPeriods.map((p) =>
        prisma.vatPayment.create({
          data: {
            vatConfigId: vatConfig.id,
            periodStart: p.start,
            periodEnd: p.end,
            dueDate: p.due,
            paidAmount: p.paid,
            paidAt: p.paidAt,
          },
        }),
      ),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[seed-demo]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
