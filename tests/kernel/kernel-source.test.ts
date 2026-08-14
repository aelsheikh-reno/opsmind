// The reader that the kernel sweeps are built on, proven against fixtures.
//
// Every assertion in kernel-repositories.test.ts and kernel-regime-data.test.ts
// is of the form "no file under lib/kernel/ contains X". An assertion shaped
// like that passes trivially if the reader finds nothing — a broken lexer, a
// regex that never matches, a walk that returns an empty list — and it passes
// silently, which is worse. The sweeps guard their own input by asserting it is
// non-empty; this file guards the other half, that the detectors actually fire
// on the thing they claim to catch.
//
// The fixtures below are hand-written strings, not kernel source. Nothing here
// reads `lib/kernel/`.
import { describe, expect, it } from "vitest";
import {
  blankNonCode,
  dbUsages,
  exportedDeclarations,
  exportedTypeBlocks,
  importSpecifiers,
  numericLiterals,
  ownsDeclaration,
  publicSurfaceFiles,
  reExports,
  type KernelModule,
  type SourceFile,
} from "./kernel-source";

const file = (name: string, source: string): SourceFile => ({
  path: `/repo/lib/kernel/fixture/${name}`,
  relative: `lib/kernel/fixture/${name}`,
  module: "fixture",
  name,
  source,
});

describe("blankNonCode", () => {
  it("removes line and block comments but keeps the line count", () => {
    const source = ["const a = 1; // rate is 0.05", "/* 28 days */", "const b = 2;"].join("\n");
    const blanked = blankNonCode(source);
    expect(blanked.split("\n")).toHaveLength(3);
    expect(blanked).toContain("const a = 1;");
    expect(blanked).not.toContain("0.05");
    expect(blanked).not.toContain("28 days");
  });

  it("removes string contents, so a number in a message is not a constant", () => {
    expect(blankNonCode('const m = "due in 28 days";')).not.toContain("28");
    expect(blankNonCode("const m = 'VAT is 5%';")).not.toContain("5%");
  });

  it("keeps code inside a template expression, where a constant can hide", () => {
    // `${deadlineDays ?? 28}` is code: the 28 is a hardcoded deadline day and
    // must still be caught.
    const blanked = blankNonCode("const m = `due ${days ?? 28} days`;");
    expect(blanked).toContain("days ?? 28");
    expect(blanked).not.toContain("due ");
  });

  it("removes regular-expression contents, so \\d{2,4} is not two numbers", () => {
    const blanked = blankNonCode("const ok = /^[A-Z]{2}\\d{2,4}$/.test(trn);");
    expect(blanked).toContain("test(trn)");
    expect(blanked).not.toContain("2,4");
  });

  it("does not mistake division for a regular expression", () => {
    const blanked = blankNonCode("const half = total / 2; const other = count / 4;");
    expect(blanked).toContain("total / 2");
    expect(blanked).toContain("count / 4");
  });

  it("leaves string contents alone when asked to keep them", () => {
    expect(blankNonCode('const s = "keep me"; // drop me', { strings: false })).toContain("keep me");
    expect(blankNonCode('const s = "keep me"; // drop me', { strings: false })).not.toContain(
      "drop me",
    );
  });
});

describe("numericLiterals", () => {
  it("finds a decimal rate, a bracket threshold and a deadline day", () => {
    const found = numericLiterals("const rate = 0.05; const band = 15_000; const days = 28;");
    expect(found.map((literal) => literal.value)).toEqual([0.05, 15000, 28]);
  });

  it("does not find numbers in comments or strings", () => {
    const found = numericLiterals(['// 0.14 for Egypt', 'const label = "9%";'].join("\n"));
    expect(found).toEqual([]);
  });

  it("finds a number inside a template expression", () => {
    expect(numericLiterals("const m = `${x ?? 28}`;").map((l) => l.value)).toEqual([28]);
  });

  it("does not treat an identifier's digits as a literal", () => {
    expect(numericLiterals("const iso4217 = code; const x2 = y;")).toEqual([]);
  });

  it("reports the line and the surrounding code, so a finding can be located", () => {
    const found = numericLiterals("const a = 1;\nconst vatRate = 0.05;");
    expect(found[1].line).toBe(2);
    expect(found[1].context).toContain("vatRate");
  });
});

describe("ownsDeclaration", () => {
  it("reads the declaration when it is the first line", () => {
    const owns = ownsDeclaration("// owns: Person, PersonEnrolment\nimport { db } from '@/lib/db';");
    expect(owns.present).toBe(true);
    expect(owns.onFirstLine).toBe(true);
    expect(owns.tables).toEqual(["Person", "PersonEnrolment"]);
  });

  it("splits the middot the ownership table uses", () => {
    expect(ownsDeclaration("// owns: Jurisdiction · BusinessCalendar · BusinessHoliday").tables).toEqual([
      "Jurisdiction",
      "BusinessCalendar",
      "BusinessHoliday",
    ]);
  });

  it("reports a declaration that is present but not on line one", () => {
    const owns = ownsDeclaration("import { db } from '@/lib/db';\n// owns: Regime");
    expect(owns.present).toBe(true);
    expect(owns.onFirstLine).toBe(false);
    expect(owns.line).toBe(2);
  });

  it("reports absence rather than inventing a table list", () => {
    const owns = ownsDeclaration("// the person repository\nimport { db } from '@/lib/db';");
    expect(owns.present).toBe(false);
    expect(owns.tables).toEqual([]);
  });
});

describe("dbUsages", () => {
  it("finds every table touched through the client", () => {
    const source = [
      "await db.person.findMany();",
      "await db.personEnrolment.create({ data });",
      "await tx.regime.update({ where });",
    ].join("\n");
    expect(dbUsages(source).map((usage) => usage.delegate)).toEqual([
      "person",
      "personEnrolment",
      "regime",
    ]);
  });

  it("finds a table reached by bracket access as well as by a call", () => {
    expect(dbUsages("db.jurisdiction[method]();").map((u) => u.delegate)).toEqual(["jurisdiction"]);
  });

  it("does not count client methods as tables", () => {
    expect(dbUsages("await db.$transaction(async (tx) => {});")).toEqual([]);
  });

  it("does not count a table named only in a comment", () => {
    expect(dbUsages("// db.document.findMany()")).toEqual([]);
  });
});

describe("importSpecifiers", () => {
  it("finds imports, re-exports and dynamic imports", () => {
    const source = [
      'import { db } from "@/lib/db";',
      'import type { X } from "./x";',
      'export { y } from "./y";',
      'const z = await import("@/lib/kernel/person");',
    ].join("\n");
    expect(importSpecifiers(source)).toEqual(
      expect.arrayContaining(["@/lib/db", "./x", "./y", "@/lib/kernel/person"]),
    );
  });

  it("does not find an import that is only mentioned in a comment", () => {
    expect(importSpecifiers('// import { db } from "@/lib/db";')).toEqual([]);
  });
});

describe("exportedTypeBlocks", () => {
  const source = [
    "export interface BusinessCalendar {",
    "  jurisdictionId: string;",
    "  /** 0 = Sunday. */",
    "  weekendMask: readonly number[];",
    "  holidays: readonly Date[];",
    "}",
    "interface Hidden { secret: string }",
    "export type Regime = {",
    "  rate: Decimal;",
    "  deadlineDays: number;",
    "  brackets?: unknown;",
    "};",
  ].join("\n");

  it("reads the members of an exported interface", () => {
    const blocks = exportedTypeBlocks(file("calendar.ts", source));
    const calendar = blocks.find((block) => block.name === "BusinessCalendar");
    expect(calendar?.members.map((member) => member.name)).toEqual([
      "jurisdictionId",
      "weekendMask",
      "holidays",
    ]);
    expect(calendar?.members.find((m) => m.name === "weekendMask")?.type).toContain("number[]");
  });

  it("reads an exported object type alias and its optional members", () => {
    const regime = exportedTypeBlocks(file("regime.ts", source)).find((b) => b.name === "Regime");
    expect(regime?.members.map((m) => m.name)).toEqual(["rate", "deadlineDays", "brackets"]);
    expect(regime?.members.find((m) => m.name === "brackets")?.optional).toBe(true);
  });

  it("ignores a declaration that is not exported", () => {
    expect(exportedTypeBlocks(file("calendar.ts", source)).map((b) => b.name)).not.toContain(
      "Hidden",
    );
  });

  it("does not read a nested object's members as the block's own", () => {
    const nested = exportedTypeBlocks(
      file("nested.ts", "export interface A {\n  outer: { inner: string };\n  after: number;\n}"),
    );
    expect(nested[0].members.map((m) => m.name)).toEqual(["outer", "after"]);
  });
});

describe("exportedDeclarations", () => {
  it("captures a function's signature and never its body", () => {
    const source = [
      "export function businessCalendarFor(jurisdictionId: string): Promise<BusinessCalendar | null> {",
      "  const rate = 0.05;",
      "  return read(jurisdictionId);",
      "}",
    ].join("\n");
    const [declaration] = exportedDeclarations(file("index.ts", source));
    expect(declaration.name).toBe("businessCalendarFor");
    expect(declaration.signature).toContain("Promise<BusinessCalendar | null>");
    expect(declaration.signature).not.toContain("0.05");
    expect(declaration.signature).not.toContain("return");
  });

  it("captures an exported const's declared type without its initialiser body", () => {
    const [declaration] = exportedDeclarations(
      file("index.ts", "export const gulf: CalendarSource = { forJurisdiction: read };"),
    );
    expect(declaration.name).toBe("gulf");
    expect(declaration.signature).toContain("CalendarSource");
    expect(declaration.signature).not.toContain("forJurisdiction");
  });
});

describe("reExports", () => {
  it("reads named and star re-exports", () => {
    const source = [
      'export { calendarFor } from "./calendar";',
      'export type { BusinessCalendar } from "./calendar";',
      'export * from "./person";',
    ].join("\n");
    const found = reExports(source);
    expect(found.filter((re) => !re.star).flatMap((re) => re.names)).toEqual([
      "calendarFor",
      "BusinessCalendar",
    ]);
    expect(found.find((re) => re.star)?.from).toBe("./person");
  });
});

describe("publicSurfaceFiles", () => {
  it("follows a re-export chain out of index.ts and stops inside the module", () => {
    const index = file("index.ts", 'export { calendarFor } from "./calendar";');
    const calendar = file("calendar.ts", 'export * from "./mask";\nexport interface C { a: string }');
    const mask = file("mask.ts", "export interface M { weekendMask: number[] }");
    const repository = file("repository.ts", "// owns: Jurisdiction");
    const fixture: KernelModule = {
      name: "fixture",
      dir: "/repo/lib/kernel/fixture",
      relative: "lib/kernel/fixture",
      files: [index, calendar, mask, repository],
      index,
      repository,
    };
    const surface = publicSurfaceFiles(fixture).map((f) => f.name);
    expect(surface).toEqual(["index.ts", "calendar.ts", "mask.ts"]);
    expect(surface, "repository.ts is not part of the public surface").not.toContain(
      "repository.ts",
    );
  });

  it("is empty for a module with no index.ts, rather than guessing one", () => {
    const repository = file("repository.ts", "// owns: Regime");
    expect(
      publicSurfaceFiles({
        name: "fixture",
        dir: "/repo/lib/kernel/fixture",
        relative: "lib/kernel/fixture",
        files: [repository],
        index: undefined,
        repository,
      }),
    ).toEqual([]);
  });
});
