// Task `harness-differential` — tests written from the task contract alone.
// `tests/differential/harness.ts` was deliberately NOT read while writing this
// file (PIPELINE.md:78-81): it is the only oracle for business correctness here,
// and a test retrofitted to it would describe what it does rather than what it
// must do. Assertion map (tasks/backlog.yaml#harness-differential): 1 -> "runs
// the same input", "diffing and matched", "the real legacy prorata module";
// 2 -> "one bad case never stops the run"; 3 -> "loadLegacyModule";
// 4 -> "golden dataset is anonymised".
//
// `harness-exact-minor-scaling` reaches the harness through the cause a case
// reports and through the strictness of `matched`: see "diffing and the
// strictness of `matched`", the three exact-scaling cases.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatReport, loadLegacyModule, runDifferential } from "@/tests/differential/harness";
import type { CaseResult, DifferentialReport, DifferentialSpec } from "@/tests/differential/harness";
import type { DiffOptions } from "@/tests/differential/diff-fields";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");

/** Invariants that must hold for EVERY report, whatever the spec did. */
function expectConsistent(report: DifferentialReport): void {
  expect(report.total).toBe(report.results.length);
  expect(report.matched).toBe(report.results.filter((r) => r.matched).length);
  expect(report.failed).toBe(report.results.filter((r) => !r.matched).length);
  expect(report.matched + report.failed).toBe(report.total);
  for (const result of report.results) {
    if (result.matched) expect(result.differences).toEqual([]);
    if (result.error !== undefined) {
      expect(result.error).not.toBe("");
      expect(result.matched).toBe(false);
      expect(result.differences).toEqual([]);
    }
  }
}

function byName(report: DifferentialReport, name: string): CaseResult {
  const found = report.results.find((r) => r.name === name);
  if (found === undefined) throw new Error(`no case result named ${name}`);
  return found;
}

/** A spec built from `[name, legacyOutput, candidateOutput]` triples. */
function pairSpec(pairs: [string, unknown, unknown][], options?: DiffOptions): DifferentialSpec<number, unknown> {
  return { legacy: (i) => pairs[i][1], candidate: (i) => pairs[i][2], options,
    cases: pairs.map(([name], i) => ({ name, input: i })) };
}

describe("runDifferential — runs the same input through legacy and candidate", () => {
  it("passes the identical input value to both sides, once per case", async () => {
    const seen: Record<string, unknown[]> = { legacy: [], candidate: [] };
    const first = { id: "first" };
    const second = { id: "second" };
    const report = await runDifferential<{ id: string }, string>({
      legacy: (input) => { seen.legacy.push(input); return input.id; },
      candidate: (input) => { seen.candidate.push(input); return input.id; },
      cases: [{ name: "first", input: first }, { name: "second", input: second }],
    });
    for (const side of ["legacy", "candidate"]) {
      expect(seen[side], side).toHaveLength(2);
      expect(seen[side][0], side).toBe(first);
      expect(seen[side][1], side).toBe(second);
    }
    expect(report.results.map((r) => r.name)).toEqual(["first", "second"]);
    expect(report.matched).toBe(2);
    expectConsistent(report);
  });

  it("awaits both sides — sync, async, and a mix of the two", async () => {
    type Payslip = { net: number; currency: string };
    const sync = (): Payslip => ({ net: 1000, currency: "AED" });
    const async = async (): Promise<Payslip> => ({ net: 1000, currency: "AED" });
    const sides: [string, () => Payslip | Promise<Payslip>, () => Payslip | Promise<Payslip>][] = [
      ["sync/sync", sync, sync], ["async/async", async, async],
      ["sync/async", sync, async], ["async/sync", async, sync],
    ];
    for (const [name, legacy, candidate] of sides) {
      // An unawaited promise reaches diffFields as an exotic object, so this pins that both are awaited.
      const report = await runDifferential({ legacy, candidate, cases: [{ name, input: 0 }] });
      expect(report.results[0].differences, name).toEqual([]);
      expect(report.results[0].matched, name).toBe(true);
      expectConsistent(report);
    }
  });
});

describe("runDifferential — diffing and the strictness of `matched`", () => {
  it("matches identical output and reports every differing leaf with path, cause and detail", async () => {
    const report = await runDifferential(pairSpec([
      ["zero", { amount: 0 }, { amount: 0 }],
      ["negative", { amount: -1500.5 }, { amount: -1500.5 }],
      ["null root", null, null],
      ["nested equal", { rows: [{ d: 1 }, { d: 2 }] }, { rows: [{ d: 1 }, { d: 2 }] }],
      ["payslip", { gross: 10000, allowances: { housing: 2000 }, note: "full" },
        { gross: 10000, allowances: { housing: 2500 }, note: "prorated" }],
    ]));
    expect(report.matched).toBe(4);
    expect(report.failed).toBe(1);
    const payslip = byName(report, "payslip");
    expect(payslip.differences.map((d) => d.path)).toEqual(["allowances.housing", "note"]);
    expect(payslip.error).toBeUndefined();
    for (const difference of payslip.differences) {
      expect(difference.cause).toBe("value-mismatch");
      expect(difference.detail).not.toBe("");
    }
    expectConsistent(report);
  });

  // The single most valuable test in this file. Kuwait and Bahrain price in
  // three-decimal currencies, so a real one-fils gap is finer than the default
  // minor-unit scale of 100: measured in minor units the gap is 0.1, below the
  // one minor unit that scale can express. It carries its own cause
  // `sub-minor-unit` rather than `rounding`, so no consumer can drop it as
  // tolerated noise — and
  // `matched` stays strict, because if it did not, two live jurisdictions would
  // be silently wrong on every payslip.
  it("does NOT match a sub-minor-unit KWD gap, nor a difference inside a tolerance", async () => {
    const subMinor = await runDifferential(pairSpec([
      ["KWD one fils", { amount: 1234.567, currency: "KWD" }, { amount: 1234.568, currency: "KWD" }],
    ]));
    expect(subMinor.results[0].differences).toHaveLength(1);
    expect(subMinor.results[0].differences[0].cause).toBe("sub-minor-unit");
    expect(subMinor.results[0].differences[0].cause).not.toBe("rounding");
    expect(subMinor.results[0].differences[0].path).toBe("amount");
    expect(subMinor.results[0].matched).toBe(false);
    expect(subMinor.matched).toBe(0);
    expect(subMinor.failed).toBe(1);
    expectConsistent(subMinor);

    const tolerated = await runDifferential(
      pairSpec([["one fils AED", { amount: 100 }, { amount: 100.01 }]], { toleranceMinorUnits: 1 }),
    );
    expect(tolerated.results[0].differences[0].cause).toBe("rounding");
    expect(tolerated.results[0].matched).toBe(false);
    expect(tolerated.failed).toBe(1);
    expectConsistent(tolerated);
  });

  // Assertion 2 at the harness level: a tolerance is the one lever a caller has,
  // and no setting of it may make the KWD case match or turn the difference into
  // something a rounding filter would swallow.
  it("keeps a sub-minor-unit KWD gap failing at every tolerance, generous ones included", async () => {
    for (const toleranceMinorUnits of [0, 1, 5, 1_000_000]) {
      const report = await runDifferential(
        pairSpec([["KWD one fils", { amount: 1234.567 }, { amount: 1234.568 }]], { toleranceMinorUnits }),
      );
      const label = `tolerance ${toleranceMinorUnits}`;
      expect(report.results[0].differences, label).toHaveLength(1);
      expect(report.results[0].differences[0].cause, label).toBe("sub-minor-unit");
      expect(report.results[0].matched, label).toBe(false);
      expect(report.matched, label).toBe(0);
      expect(report.failed, label).toBe(1);
      // A consumer discarding `rounding` as noise still has the real gap in hand.
      expect(report.results[0].differences.filter((d) => d.cause !== "rounding"), label).toHaveLength(1);
      expectConsistent(report);
    }
  });

  // The x.xx5 pairs a `Math.round(x * scale)` multiply bends in both
  // directions: 0.135 vs 0.145 collapses to a gap of zero and 0.145 vs 0.155
  // inflates to two. Both are one fils, and the harness must say so — a run
  // that reports the first as sub-minor-unit is telling a payroll reviewer the
  // two systems agree to the fils when they do not.
  it("reports an exactly-one-fils gap as rounding whichever way a float multiply used to bend it", async () => {
    for (const [legacy, candidate] of [[0.135, 0.145], [0.145, 0.155], [0.155, 0.145], [0.145, 0.135]]) {
      const label = `${legacy} vs ${candidate}`;
      const report = await runDifferential(
        pairSpec([["one fils", { amount: legacy }, { amount: candidate }]], { toleranceMinorUnits: 1 }),
      );
      expect(report.results[0].differences, label).toHaveLength(1);
      expect(report.results[0].differences[0].cause, label).toBe("rounding");
      expect(report.results[0].matched, label).toBe(false);
      expectConsistent(report);

      const strict = await runDifferential(pairSpec([["one fils", { amount: legacy }, { amount: candidate }]]));
      expect(strict.results[0].differences[0].cause, label).toBe("value-mismatch");
      expect(strict.matched, label).toBe(0);
      expectConsistent(strict);
    }
  });

  // The other direction: 1234.564 and 1234.566 are a fifth of a fils apart but
  // straddle the rounding boundary, so the old scaling reported a whole minor
  // unit — which a consumer filtering `rounding` away would have discarded.
  it("keeps a straddling sub-minor gap under its own cause, out of a rounding filter", async () => {
    const report = await runDifferential(pairSpec([
      ["KWD straddling the boundary", { amount: 1234.564 }, { amount: 1234.566 }],
      ["AED one fils", { amount: 0.135 }, { amount: 0.145 }],
    ], { toleranceMinorUnits: 1 }));
    const straddling = byName(report, "KWD straddling the boundary");
    expect(straddling.differences[0].cause).toBe("sub-minor-unit");
    expect(byName(report, "AED one fils").differences[0].cause).toBe("rounding");
    expect(straddling.differences.filter((d) => d.cause !== "rounding")).toHaveLength(1);
    expect(report.matched).toBe(0);
    expect(report.failed).toBe(2);
    const text = formatReport(report);
    for (const token of ["1234.564", "1234.566", "sub-minor-unit", "rounding"]) {
      expect(text, token).toContain(token);
    }
    expectConsistent(report);
  });

  it("does not lose a two-fils gap at a magnitude where doubles are further apart than a fils", async () => {
    const pair: [string, unknown, unknown][] = [
      ["ledger total", { amount: 100000000000000.03 }, { amount: 100000000000000.05 }],
    ];
    const strict = await runDifferential(pairSpec(pair, { toleranceMinorUnits: 1 }));
    expect(strict.results[0].differences[0].cause).toBe("value-mismatch");
    const tolerated = await runDifferential(pairSpec(pair, { toleranceMinorUnits: 2 }));
    expect(tolerated.results[0].differences[0].cause).toBe("rounding");
    // Either way it is a difference, and either way the run does not match.
    for (const report of [strict, tolerated]) {
      expect(report.matched).toBe(0);
      expect(report.results[0].differences[0].cause).not.toBe("sub-minor-unit");
      expectConsistent(report);
    }
  });

  it("forwards options to the diff — ignorePaths and minorUnitScale", async () => {
    const ignored = await runDifferential(pairSpec(
      [["timestamped", { net: 500, generatedAt: "a" }, { net: 500, generatedAt: "b" }]],
      { ignorePaths: ["generatedAt"] },
    ));
    expect(ignored.results[0].differences).toEqual([]);
    expect(ignored.results[0].matched).toBe(true);
    // At scale 1000 that same KWD pair is a whole minor unit apart, so it is a
    // value-mismatch rather than sub-minor-unit noise.
    const scaled = await runDifferential(
      pairSpec([["KWD at fils scale", { amount: 1234.567 }, { amount: 1234.568 }]], { minorUnitScale: 1000 }),
    );
    expect(scaled.results[0].differences[0].cause).toBe("value-mismatch");
    expect(scaled.results[0].matched).toBe(false);
    // ...and a one-minor-unit gap at that scale is an ordinary rounding once a
    // tolerance allows for it — still not a match.
    const rounded = await runDifferential(
      pairSpec([["KWD at fils scale", { amount: 1234.567 }, { amount: 1234.568 }]],
        { minorUnitScale: 1000, toleranceMinorUnits: 1 }),
    );
    expect(rounded.results[0].differences[0].cause).toBe("rounding");
    expect(rounded.results[0].matched).toBe(false);
    for (const report of [ignored, scaled, rounded]) expectConsistent(report);
  });
});

describe("runDifferential — one bad case never stops the run or hides the others", () => {
  const boom = (message: string) => (): never => { throw new Error(message); };
  it("records the error and keeps running the cases after it", async () => {
    const report = await runDifferential<string, { v: string }>({
      legacy: (input) => (input === "legacy-throws" ? boom("legacy-boom")() : { v: input }),
      candidate: (input) => (input === "candidate-throws" ? boom("candidate-boom")() : { v: input }),
      cases: [["before", "ok-1"], ["legacy throws", "legacy-throws"], ["candidate throws",
        "candidate-throws"], ["after", "ok-2"]].map(([name, input]) => ({ name, input })),
    });
    expect(report.results.map((r) => r.name))
      .toEqual(["before", "legacy throws", "candidate throws", "after"]);
    expect(byName(report, "before").matched).toBe(true);
    expect(byName(report, "after").matched).toBe(true);
    expect(byName(report, "legacy throws").error).toContain("legacy-boom");
    expect(byName(report, "candidate throws").error).toContain("candidate-boom");
    expect(report.matched).toBe(2);
    expect(report.failed).toBe(2);
    expectConsistent(report);
  });

  it("runs the candidate even when legacy throws, so 'both threw' is distinguishable", async () => {
    let candidateCalls = 0;
    const run = (legacyThrows: boolean, candidateThrows: boolean): Promise<DifferentialReport> =>
      runDifferential<null, { v: number }>({
        legacy: () => (legacyThrows ? boom("legacy-boom")() : { v: 1 }),
        candidate: () => { candidateCalls += 1; return candidateThrows ? boom("candidate-boom")() : { v: 1 }; },
        cases: [{ name: "case", input: null }],
      });
    const legacyOnly = await run(true, false);
    expect(candidateCalls).toBe(1); // the candidate ran despite legacy throwing first
    const candidateOnly = await run(false, true);
    const both = await run(true, true);
    expect(legacyOnly.results[0].error).toContain("legacy-boom");
    expect(candidateOnly.results[0].error).toContain("candidate-boom");
    expect(both.results[0].error).not.toBe(legacyOnly.results[0].error);
    expect(both.results[0].error).not.toBe(candidateOnly.results[0].error);
    for (const report of [legacyOnly, candidateOnly, both]) expectConsistent(report);
  });

  it("records a rejected promise like a synchronous throw", async () => {
    const report = await runDifferential<number, number>({
      legacy: (n) => (n === 1 ? Promise.reject(new Error("async-legacy-boom")) : Promise.resolve(n)),
      candidate: (n) => Promise.resolve(n),
      cases: [{ name: "ok", input: 0 }, { name: "rejects", input: 1 }, { name: "still runs", input: 2 }],
    });
    expect(byName(report, "rejects").error).toContain("async-legacy-boom");
    expect(byName(report, "still runs").matched).toBe(true);
    expect(report.matched).toBe(2);
    expectConsistent(report);

    // A thrown non-Error still has to become a string on the result.
    for (const thrown of ["a bare string", null, undefined, 42, { code: "E_ODD" }]) {
      const odd = await runDifferential<boolean, number>({
        legacy: (shouldThrow) => { if (shouldThrow) throw thrown; return 1; },
        candidate: () => 1,
        cases: [{ name: "odd throw", input: true }, { name: "next", input: false }],
      });
      expect(odd.total).toBe(2);
      expect(typeof odd.results[0].error).toBe("string");
      expect(odd.results[1].matched).toBe(true);
      expectConsistent(odd);
    }
  });

  // diffFields refuses a non-integer tolerance with a RangeError, which makes
  // the diff itself — not either side — the thing that throws.
  it("records an error when the diff itself throws, and still returns every case", async () => {
    const report = await runDifferential(pairSpec(
      [["one", { amount: 1 }, { amount: 2 }], ["two", { amount: 3 }, { amount: 4 }]],
      { toleranceMinorUnits: 1.5 },
    ));
    expect(report.total).toBe(2);
    expect(report.failed).toBe(2);
    expect(report.matched).toBe(0);
    for (const result of report.results) {
      expect(result.error).toBeTruthy();
      expect(result.differences).toEqual([]);
      expect(result.matched).toBe(false);
    }
    expectConsistent(report);
  });
});

describe("formatReport", () => {
  it("names every failing case with its values verbatim, paths, causes, details and error", async () => {
    const pairs: Record<string, [unknown, unknown]> = {
      "matching case": [{ days: 21 }, { days: 21 }],
      "KWD one fils": [{ amount: 1234.567 }, { amount: 1234.568 }],
      "egypt tax bracket": [{ tax: 4250, band: "third" }, { tax: 4300, band: "fourth" }],
      "throwing case": [null, null],
    };
    const report = await runDifferential<string, unknown>({
      legacy: (name) => pairs[name][0],
      candidate: (name) => {
        if (name === "throwing case") throw new Error("legacy-module-blew-up");
        return pairs[name][1];
      },
      cases: Object.keys(pairs).map((name) => ({ name, input: name })),
    });
    const text = formatReport(report);
    // Without the raw values a difference whose gap measures 0 minor units reads
    // as "no difference", and the sub-minor-unit KWD case stops being honest.
    for (const token of ["1234.567", "1234.568", "amount", "sub-minor-unit", "KWD one fils",
      "egypt tax bracket", "tax", "band", "value-mismatch", "throwing case", "legacy-module-blew-up"]) {
      expect(text, token).toContain(token);
    }
    for (const failed of report.results.filter((r) => !r.matched)) {
      for (const difference of failed.differences) expect(text).toContain(difference.detail);
    }
    expectConsistent(report);
  });

  it("prints a sub-minor-unit gap under its own cause, alongside a real rounding", async () => {
    const report = await runDifferential(pairSpec([
      ["KWD sub-minor", { amount: 1234.567 }, { amount: 1234.568 }],
      ["AED one fils", { amount: 8000.33 }, { amount: 8000.34 }],
    ], { toleranceMinorUnits: 1 }));
    expect(byName(report, "KWD sub-minor").differences[0].cause).toBe("sub-minor-unit");
    expect(byName(report, "AED one fils").differences[0].cause).toBe("rounding");
    const text = formatReport(report);
    for (const token of ["sub-minor-unit", "rounding", "KWD sub-minor", "AED one fils"]) {
      expect(text, token).toContain(token);
    }
    // `matched` is strict for both: neither is tolerated away.
    expect(report.matched).toBe(0);
    expect(report.failed).toBe(2);
    expectConsistent(report);
  });

  // A golden-file runner whose glob matched nothing would otherwise print a
  // green lie: zero cases is not zero differences.
  it("does not claim success for a report with no cases", async () => {
    const empty = await runDifferential<number, number>({ legacy: (n) => n, candidate: (n) => n, cases: [] });
    expect(empty).toEqual({ total: 0, matched: 0, failed: 0, results: [] });
    const text = formatReport(empty);
    expect(text).not.toMatch(/all\b[^.\n]{0,40}match/i);
    expect(text).not.toMatch(/everything matched|no differences|passed/i);
    expect(text).toMatch(/\b0\b|none|no cases|empty/i);
  });
});

describe("loadLegacyModule", () => {
  it("loads the dependency-free legacy oracles by path relative to reference/legacy/", async () => {
    const prorata = await loadLegacyModule("lib/prorata.ts");
    expect(typeof prorata.computeProRata).toBe("function");
    expect(typeof prorata.resolveMonthSalary).toBe("function");
    for (const path of ["lib/tax.ts", "lib/vat.ts"]) {
      expect(Object.keys(await loadLegacyModule(path)).length, path).toBeGreaterThan(0);
    }
  });

  // `lib/fx.ts` opens with `import { prisma } from "@/lib/prisma"`; the merged Vite plugin
  // resolves that inside reference/legacy/ rather than into this build, so it fails on the
  // legacy dependency chain. `types/next-auth.d.ts` is the other shape: it loads cleanly and
  // exports nothing, and an oracle exporting nothing agrees with every candidate — the exact
  // green-but-vacuous gate this harness exists to prevent. All three must throw, never stub.
  it("throws naming the module when it cannot load — never a stub, never an empty module", async () => {
    for (const path of ["lib/does-not-exist.ts", "lib/fx.ts", "types/next-auth.d.ts"]) {
      let loaded: Record<string, unknown> | undefined;
      let thrown: unknown;
      try { loaded = await loadLegacyModule(path); } catch (error) { thrown = error; }
      expect(loaded, `loadLegacyModule("${path}") resolved instead of throwing`).toBeUndefined();
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(path);
    }
    // ...and only a plain path naming something under reference/legacy/ loads at all. Every
    // path below is refused, but not all of them escape: `../legacy/lib/prorata.ts` resolves
    // back inside the tree and `..%2F..%2Fpackage.json` is a literal filename. What is pinned
    // is the rule, not traversal — an absolute path, or any `..` segment, fails closed.
    for (const path of ["../../lib/db.ts", "../../package.json", "lib/../../package.json",
      "/etc/passwd", "../legacy/lib/prorata.ts", "..%2F..%2Fpackage.json"]) {
      await expect(loadLegacyModule(path), `path "${path}" was not rejected`).rejects.toThrow();
    }
  });
});

type ProRataInput = {
  salary: number; runMonth: number; runYear: number;
  contractStart: Date | null; contractEnd: Date | null; exitDate: Date | null;
};
type ProRataOutput = { salary: number; components: string | null; note: string | null };
type ProRata = (
  salary: number, components: string | null, runMonth: number, runYear: number,
  contractStart: Date | null, contractEnd: Date | null, exitDate: Date | null,
) => ProRataOutput;

// Boundary and mid-period shapes for the UAE 30-day divisor: a full month, a mid-month
// joiner, a mid-month leaver, a joiner and leaver inside one month, and a February leaver
// where the month is shorter than the divisor. Expected values are never hand-written.
const PRORATA_CASES: { name: string; input: ProRataInput }[] = [
  { name: "full month", input: { salary: 10000, runMonth: 3, runYear: 2026, contractStart: new Date(2026, 0, 15), contractEnd: null, exitDate: null } },
  { name: "mid-month joiner", input: { salary: 10000, runMonth: 3, runYear: 2026, contractStart: new Date(2026, 2, 15), contractEnd: null, exitDate: null } },
  { name: "mid-month leaver", input: { salary: 10000, runMonth: 3, runYear: 2026, contractStart: new Date(2025, 0, 1), contractEnd: null, exitDate: new Date(2026, 2, 10) } },
  { name: "joiner and leaver in one month", input: { salary: 10000, runMonth: 3, runYear: 2026, contractStart: new Date(2026, 2, 5), contractEnd: null, exitDate: new Date(2026, 2, 20) } },
  { name: "february leaver on the 28th", input: { salary: 10000, runMonth: 2, runYear: 2026, contractStart: new Date(2025, 0, 1), contractEnd: null, exitDate: new Date(2026, 1, 28) } },
];

describe("runDifferential against the real legacy prorata module", () => {
  it("finds no difference against itself, and catches a candidate that rounds to whole units", async () => {
    const fn = (await loadLegacyModule("lib/prorata.ts")).computeProRata as ProRata;
    const legacy = (i: ProRataInput): ProRataOutput =>
      fn(i.salary, null, i.runMonth, i.runYear, i.contractStart, i.contractEnd, i.exitDate);
    const identical = await runDifferential({ legacy, candidate: legacy, cases: PRORATA_CASES });
    expect(identical.total).toBe(PRORATA_CASES.length);
    expect(identical.matched).toBe(PRORATA_CASES.length);
    expect(identical.failed).toBe(0);
    expectConsistent(identical);

    const report = await runDifferential<ProRataInput, ProRataOutput>({
      legacy,
      candidate: (i) => { const r = legacy(i); return { ...r, salary: Math.round(r.salary) }; },
      cases: PRORATA_CASES,
    });
    // Only the full-month case has an integer salary, so only it survives.
    expect(byName(report, "full month").matched).toBe(true);
    for (const { name } of PRORATA_CASES.filter((c) => c.name !== "full month")) {
      const result = byName(report, name);
      expect(result.matched, `${name} should have differed`).toBe(false);
      expect(result.error).toBeUndefined();
      expect(result.differences.map((d) => d.path)).toContain("salary");
    }
    expect(report.matched).toBe(1);
    expect(report.failed).toBe(PRORATA_CASES.length - 1);
    expect(formatReport(report)).toContain("mid-month joiner");
    expectConsistent(report);
  });
});

// Identifier shapes that must never appear in committed golden data. `prefix` is
// how many leading characters of the cleaned match are structural (country code,
// issuer, century digit); the rest is the body. A body of identical characters is
// a documented placeholder — the README documents formats, and a scan that flags
// its own examples is a false positive.
const ID_PATTERNS: { name: string; re: RegExp; prefix: number }[] = [
  { name: "Emirates ID", re: /\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g, prefix: 3 },
  { name: "Egyptian national ID", re: /\b[23]\d{13}\b/g, prefix: 1 },
  { name: "GCC IBAN", re: /\b(?:AE|BH|EG|KW|OM|QA|SA)\d{2}[A-Z0-9]{12,28}\b/g, prefix: 4 },
  { name: "passport MRZ", re: /\bP<[A-Z]{3}[A-Z<]{10,}/g, prefix: 5 },
];

/** Pattern names found in `text`. Never returns the matched value itself. */
function scanForIdentifiers(text: string): string[] {
  const found = new Set<string>();
  for (const { name, re, prefix } of ID_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const body = match[0].replace(/[-\s<]/g, "").slice(prefix);
      if (body.length > 0 && new Set(body).size === 1) continue; // documented placeholder
      found.add(name);
    }
  }
  return [...found];
}

function filesUnderGoldenDirs(dir: string, inGolden: boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if ([".git", ".next", "coverage", "node_modules", "reference"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesUnderGoldenDirs(full, inGolden || entry === "golden", out);
    else if (inGolden) out.push(full);
  }
  return out;
}

describe("golden dataset is anonymised", () => {
  it("documents the anonymisation policy in tests/golden/README.md", () => {
    const readme = readFileSync(join(REPO_ROOT, "tests/golden/README.md"), "utf8");
    for (const required of [/anonymi[sz]/i, /salar/i, /passport/i, /emirates\s*id/i]) {
      expect(readme).toMatch(required);
    }
  });

  it("the scanner catches real identifier shapes and exempts uniform placeholders", () => {
    expect(scanForIdentifiers("id 784-1987-3456789-1 here")).toEqual(["Emirates ID"]);
    expect(scanForIdentifiers("nid 29801011234567")).toEqual(["Egyptian national ID"]);
    expect(scanForIdentifiers("iban AE070331234567890123456")).toEqual(["GCC IBAN"]);
    expect(scanForIdentifiers("P<AREMANSOURI<<AHMED<<<<<<<<<")).toEqual(["passport MRZ"]);
    expect(scanForIdentifiers(["784-0000-0000000-0", "29999999999999",
      "AE00000000000000000000", "P<AREXXXXXXXXXX<<XXXXX"].join("\n"))).toEqual([]);
  });

  it("no committed golden file contains a real identifier shape", () => {
    const violations: string[] = [];
    for (const file of filesUnderGoldenDirs(REPO_ROOT, false)) {
      // File and pattern name only — a failing message goes into the CI log.
      for (const pattern of scanForIdentifiers(readFileSync(file, "utf8"))) {
        violations.push(`${file.slice(REPO_ROOT.length + 1)}: ${pattern}`);
      }
    }
    expect(violations, `identifier shapes in golden data:\n${violations.join("\n")}`).toEqual([]);
  });
});
