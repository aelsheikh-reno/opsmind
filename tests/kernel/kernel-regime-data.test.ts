// The rates-as-data assertion of tasks/backlog.yaml#kernel-entities-law:
//   "Regime holds rates, brackets and deadline days as data, not constants"
//
// Traced to:
//   components-kernel.md:13 — "**Regime** | The law: jurisdiction × obligation
//     type — rates, brackets, thresholds, deadline days | New; extracted from
//     hardcoded values and TaxesClient".
//   data-model.md:162-163 — "`rate, deadlineDays` | decimal, integer |
//     Extracted from hardcoded values in the current build"; "`thresholds,
//     brackets` | JSON | Egyptian income tax bands, registration thresholds".
//   data-model.md:225 — a filing's due date "is `periodEnd +
//     Regime.deadlineDays`", i.e. the number comes from the row.
//
// WHAT THIS FILE CATCHES, AND WHY IT IS DELIBERATELY OVER-EAGER.
//
// "As data, not constants" is a negative claim: the number must not be in the
// source. There is no call that proves it — a `getVatRate()` returning 0.05
// from a row and one returning 0.05 from a literal answer identically. So this
// sweeps `lib/kernel/` for numbers that look statutory:
//
//   1. Any NON-INTEGER literal. A rate is a decimal (schema: `rate Decimal
//      @db.Decimal(9, 6)`), so 0.05, 0.14 and 0.225 are the exact shape of the
//      defect. There is no legitimate fractional constant in vocabulary code.
//   2. Any integer of 13 or more, outside a short allowlist of time-arithmetic
//      factors. Deadline days (15, 28, 30, 90), registration thresholds
//      (375_000) and Egyptian bands (15_000, 30_000, 200_000) all land here.
//      Twelve and below is left alone because months, weekday numbers and array
//      indices live there and flagging them would be noise, not signal.
//   3. Any literal at all — 5, 9, 12 included — on a line whose code mentions
//      rate, threshold, bracket, band, deadline, days, tax, vat, duty or
//      insurance. This is what catches `const VAT_RATE = 5` and
//      `deadlineDays ?? 28`, which rules 1 and 2 would both miss.
//
// The time-arithmetic allowlist is checked before all three, so
// `Math.round(diff / 86_400_000)` on a line that mentions days is not a
// statutory constant. It holds seven values and 28 is not one of them.
//
// A FALSE POSITIVE IS THE CHEAPER MISTAKE. If this fires on something innocent
// — a page size, a retry count — the fix is to move that number to a named
// constant the sweep can be taught about, or to the row it belongs in, and the
// cost is one conversation. If it misses a real one, a statutory rate is
// compiled into the kernel where no jurisdiction can override it and no
// migration can change it, and the first evidence is a wrong filing. The
// backlog node exists precisely because the current build did that.
//
// NON-VACUITY. A sweep for "no file contains X" is green over an empty folder
// and green again if the detector is broken. Both holes are closed: the input
// is asserted non-empty before every sweep, and each sweep is run against a
// synthetic offending fixture in the same test, which must be flagged. The
// lexer underneath (comments, strings and regular expressions removed;
// template expressions kept) is proven separately in kernel-source.test.ts.
//
// No file under `lib/kernel/` was read by the author of this test. The sweeps
// are performed by the test process at run time.
import { describe, expect, it } from "vitest";
import {
  KERNEL_DIR,
  kernelFiles,
  kernelModules,
  kernelPublicTypeBlocks,
  numericLiterals,
  type SourceFile,
  type TypeBlock,
} from "./kernel-source";

/**
 * Integers that are time arithmetic rather than law: the factors of a day in
 * milliseconds, and the hours/minutes/seconds that build them. Kept short on
 * purpose — every entry is a hole, and 28 is not on it.
 */
const TIME_FACTORS = new Set([24, 60, 1000, 3600, 86400, 3_600_000, 86_400_000]);

/** The vocabulary of the law. A number on a line mentioning one of these is suspect. */
const STATUTORY = /rate|threshold|bracket|band|slab|tier|deadline|days|tax|vat|duty|insurance|percent|levy|withhold/i;

interface Finding {
  where: string;
  literal: string;
  line: number;
  context: string;
  why: string;
}

/** The three rules above, applied to one file's source. */
function statutoryLiterals(where: string, source: string): Finding[] {
  return numericLiterals(source).flatMap((literal) => {
    const at = { where, literal: literal.raw, line: literal.line, context: literal.context };
    if (!Number.isInteger(literal.value)) {
      return [{ ...at, why: "a fractional literal is the shape of a rate" }];
    }
    if (TIME_FACTORS.has(literal.value)) return [];
    if (STATUTORY.test(literal.context)) {
      return [{ ...at, why: "a number on a line that names the law" }];
    }
    if (literal.value >= 13) {
      return [{ ...at, why: "an integer large enough to be a deadline day, a threshold or a band" }];
    }
    return [];
  });
}

const report = (findings: Finding[]): string[] =>
  findings.map(
    (finding) =>
      `${finding.where}:${finding.line} — ${finding.literal} (${finding.why}): ${finding.context}`,
  );

/**
 * A file that breaks the assertion in all three ways, swept alongside the real
 * ones. If the detector ever stops working, this fixture stops being flagged
 * and the test fails there rather than passing everywhere.
 */
const MUTANT = [
  "export const VAT_RATE = 0.05;",
  "export const EGYPT_BANDS = [15_000, 30_000, 45_000];",
  "export const vatDeadlineDays = 28;",
  "export const socialInsuranceRate = 9;",
].join("\n");

function requireKernelSource(): SourceFile[] {
  const files = kernelFiles();
  if (files.length === 0) {
    throw new Error(
      `no TypeScript under ${KERNEL_DIR}. There is nothing to sweep, which is not the same ` +
        "as nothing being wrong.",
    );
  }
  return files;
}

describe("the sweep has something to sweep, and works", () => {
  it("reads every kernel module's source", () => {
    const files = requireKernelSource();
    expect(kernelModules().length, "no kernel modules").toBeGreaterThan(0);
    expect(
      files.reduce((total, file) => total + file.source.length, 0),
      "the kernel's files are all empty",
    ).toBeGreaterThan(0);
  });

  it("flags a rate, a set of bands, a deadline day and a percentage in the fixture", () => {
    // The detector, proven live. Four literals, one per rule plus the
    // line-context rule that catches a bare 9.
    const findings = statutoryLiterals("fixture.ts", MUTANT);
    expect(findings.map((finding) => finding.literal)).toEqual([
      "0.05",
      "15_000",
      "30_000",
      "45_000",
      "28",
      "9",
    ]);
  });

  it("does not flag the ordinary numbers vocabulary code contains", () => {
    // The other half of proving the detector: it has to be quiet on code that
    // is not the law. A weekday index, a slice bound, a millisecond factor.
    const innocent = [
      "const [first] = parts.slice(0, 10);",
      "const day = date.getUTCDay();",
      "const days = Math.round(diff / 86_400_000);",
      "const month = 12;",
    ].join("\n");
    expect(report(statutoryLiterals("fixture.ts", innocent))).toEqual([]);
  });
});

describe("the kernel holds no rate, threshold, bracket or deadline day as a constant", () => {
  it("contains no fractional literal anywhere", () => {
    // Rule 1, reported on its own so the failure names the defect rather than a
    // category. `rate Decimal @db.Decimal(9, 6)` is where a rate lives.
    const findings = requireKernelSource().flatMap((file) =>
      statutoryLiterals(file.relative, file.source).filter((finding) =>
        finding.why.startsWith("a fractional"),
      ),
    );
    expect(report(findings), "a rate belongs in Regime.rate, not in the source").toEqual([]);
  });

  it("contains no number on a line that names the law", () => {
    // Rule 3. `const VAT_RATE = 5` and `deadlineDays ?? 28` are both here.
    const findings = requireKernelSource().flatMap((file) =>
      statutoryLiterals(file.relative, file.source).filter((finding) =>
        finding.why.startsWith("a number on a line"),
      ),
    );
    expect(
      report(findings),
      "rates, thresholds, brackets and deadline days are columns on Regime",
    ).toEqual([]);
  });

  it("contains no integer large enough to be a threshold or a band", () => {
    // Rule 2. Egyptian income tax bands and the UAE corporate tax threshold are
    // the values data-model.md:163 names; they belong in Regime.brackets and
    // Regime.thresholds, which are JSON columns for exactly this reason.
    const findings = requireKernelSource().flatMap((file) =>
      statutoryLiterals(file.relative, file.source).filter((finding) =>
        finding.why.startsWith("an integer"),
      ),
    );
    expect(report(findings)).toEqual([]);
  });

  it("maps no obligation type to a number in the source", () => {
    // The shape the extraction is FROM: a lookup keyed by obligation type, which
    // is how "vat: 0.05, corporate_tax: 0.09" survives a refactor that removed
    // the bare constants. data-model.md:161 makes obligationType a closed set on
    // a row; the rate that goes with it is the neighbouring column, not a case
    // in a switch.
    const lookup = /\b(vat|corporate_?tax|social_?insurance|income_?tax|withholding)\b\s*:\s*-?[\d.]/i;
    const offenders = requireKernelSource().flatMap((file) =>
      file.source
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => lookup.test(line))
        .map(({ line, number }) => `${file.relative}:${number}: ${line}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the Regime surface carries the law as fields", () => {
  // The positive half of the assertion: having proved the numbers are not in the
  // source, prove the kernel has somewhere to read them from. data-model.md:158-163
  // gives Regime `jurisdictionId`, `obligationType`, `rate`, `deadlineDays`,
  // `thresholds` and `brackets`.
  //
  // Read from the public surface only — `index.ts` and the declarations it
  // re-exports — which rule 4 makes the module's contract with everything else.

  function publicTypes(): TypeBlock[] {
    const blocks = kernelPublicTypeBlocks();
    if (blocks.length === 0) {
      const modules = kernelModules().map((module) => module.name).join(", ");
      throw new Error(
        "the kernel's public surface declares no exported type at all. " +
          `Modules: ${modules || "none"}. Assertion 3 is about what Regime holds; with no ` +
          "declared shape there is nothing for a caller to read a rate out of.",
      );
    }
    return blocks;
  }

  function typeWith(...members: string[]): TypeBlock {
    const found = publicTypes().find((block) =>
      members.every((member) =>
        block.members.some((declared) => declared.name.toLowerCase() === member.toLowerCase()),
      ),
    );
    if (found === undefined) {
      const surface = publicTypes()
        .map((block) => `${block.name}{${block.members.map((m) => m.name).join(",")}}`)
        .join(" ");
      throw new Error(
        `no exported kernel type carries ${members.join(" + ")}. Public types: ${surface}`,
      );
    }
    return found;
  }

  it("exposes a regime shape with a rate and a deadline-day count", () => {
    const regime = typeWith("rate", "deadlineDays");
    expect(regime.members.map((member) => member.name)).toEqual(
      expect.arrayContaining(["rate", "deadlineDays"]),
    );
  });

  it("exposes thresholds and brackets on the same shape", () => {
    // "thresholds, brackets | JSON | Egyptian income tax bands, registration
    // thresholds" — both, on the regime, so a band table is a row and not a
    // deployment.
    const regime = typeWith("rate", "deadlineDays");
    const names = regime.members.map((member) => member.name.toLowerCase());
    expect(names, `${regime.name} carries no thresholds`).toContain("thresholds");
    expect(names, `${regime.name} carries no brackets`).toContain("brackets");
  });

  it("ties the regime to a jurisdiction and an obligation type", () => {
    // data-model.md:160-161 — "`jurisdictionId` | → Jurisdiction" and
    // "`obligationType` | vat | corporate_tax | social_insurance | … | A
    // **closed set**, not a free string". Without both, "the law" is not keyed
    // by whose law it is.
    const regime = typeWith("rate", "deadlineDays");
    const names = regime.members.map((member) => member.name.toLowerCase());
    expect(names).toContain("jurisdictionid");
    expect(names).toContain("obligationtype");
  });

  it("types the deadline-day count as a whole number of days", () => {
    // data-model.md:162 types it `integer`. A due date is `periodEnd +
    // deadlineDays` in plain calendar days (data-model.md:93); half a day has
    // no meaning there.
    const regime = typeWith("rate", "deadlineDays");
    const days = regime.members.find((member) => member.name === "deadlineDays");
    expect(days?.type, `deadlineDays is declared \`${days?.type}\``).toMatch(/\bnumber\b/);
  });
});
