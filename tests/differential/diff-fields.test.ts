// Task `harness-diff-fields` — tests written from the task contract alone.
// `tests/differential/diff-fields.ts` was deliberately NOT read while writing
// this file (PIPELINE.md:78-81): this diff is half of the only oracle for
// business correctness here, and a test retrofitted to the code would describe
// what the code does rather than what it must do.
//
// Assertion map (tasks/backlog.yaml#harness-diff-fields):
//   1. every differing leaf, dot/bracket path -> "structure and paths",
//      "scalars", "dates", "arrays", "missing keys"
//   2. specific cause + concrete detail       -> "cause and detail"
//   3. tolerance in whole minor units         -> "tolerance"
//   4. nothing silently equal                 -> "values it cannot compare",
//      "cycles"
//
// Assertion map (tasks/backlog.yaml#harness-sub-minor-cause):
//   1. a gap finer than minorUnitScale gets a cause distinct from rounding
//      -> "sub-minor-unit gaps"
//   2. no consumer can filter it away as tolerated noise
//      -> "sub-minor-unit gaps" / tolerance-cannot-mask cases
//
// Assertion map (tasks/backlog.yaml#harness-exact-minor-scaling):
//   1. under one minor unit is sub-minor-unit whether or not the two sides
//      round to the same integer -> "exact scaling · a distance under one
//      minor unit", "exact scaling · the x.xx5 sweep"
//   2. exactly one minor unit is never sub-minor, at any magnitude
//      -> "exact scaling · one minor unit exactly"
//   3. the gap is the true gap, neither inflated nor collapsed
//      -> "exact scaling · the gap it reports", and every tolerance boundary
//   4. no float arithmetic decides a classification
//      -> "exact scaling · exponential round-trip strings", the sweeps
import { describe, expect, it } from "vitest";
import { diffFields } from "@/tests/differential/diff-fields";
import type { DiffOptions, DifferenceCause, FieldDifference } from "@/tests/differential/diff-fields";

// Listing the union members here is itself a check: if the contract's cause
// vocabulary changes, this file stops compiling rather than drifting quietly.
const ALL_CAUSES: DifferenceCause[] = [
  "value-mismatch", "type-mismatch", "missing-in-candidate", "missing-in-legacy",
  "array-length", "rounding", "sub-minor-unit", "date-mismatch", "unsupported-type",
  "cycle",
];

// ------------------------------------------------------------------ helpers --

/** The single difference in `diffs`, or a failure naming what was found. */
function single(diffs: FieldDifference[]): FieldDifference {
  const [head, ...rest] = diffs;
  if (head === undefined || rest.length > 0) {
    throw new Error(`expected exactly one difference, got ${JSON.stringify(diffs)}`);
  }
  return head;
}

/** The single difference reported at `path`. */
function at(diffs: FieldDifference[], path: string): FieldDifference {
  return single(diffs.filter((d) => d.path === path));
}

function pathsOf(diffs: FieldDifference[]): string[] {
  return diffs.map((d) => d.path).sort();
}

function causesOf(diffs: FieldDifference[]): DifferenceCause[] {
  return diffs.map((d) => d.cause);
}

/** Cause of the one difference between two scalars. */
function causeOf(legacy: unknown, candidate: unknown, options?: DiffOptions): DifferenceCause {
  return single(diffFields(legacy, candidate, options)).cause;
}

/**
 * The number whose shortest round-trip string is exactly `text` — so a test can
 * state a decimal distance and know the two doubles really carry it. Written as
 * a literal, `100000000000000.04` is silently the same double as `...05`, and a
 * test claiming a one-minor-unit gap there would be claiming nothing.
 */
function decimal(text: string): number {
  const value = Number(text);
  if (String(value) !== text) {
    throw new Error(`${text} does not round-trip — String() gives ${String(value)}`);
  }
  return value;
}

/** A pair in both argument orders and with both signs: four orientations. */
function orientations(a: number, b: number): [number, number][] {
  return [[a, b], [b, a], [-a, -b], [-b, -a]];
}

/**
 * `x.xx5`-style pairs exactly one minor unit apart: `<whole>.<n>5` against
 * `<whole>.<n+1>5`, with `digits` digits before the trailing 5. This is the
 * population a `Math.round(x * scale)` float multiply gets wrong, in both
 * directions, because each side sits on a rounding boundary that binary cannot
 * represent.
 */
function halfMinorPairs(digits: number, wholes: number[], count: number): [number, number][] {
  const pairs: [number, number][] = [];
  const at = (whole: number, n: number): string => `${whole}.${String(n).padStart(digits, "0")}5`;
  for (const whole of wholes) {
    for (let n = 0; n < count; n += 1) pairs.push([decimal(at(whole, n)), decimal(at(whole, n + 1))]);
  }
  return pairs;
}

/**
 * Every cause a sweep produces, in all four orientations, mapped to the first
 * pair that produced it — so a failure names an offender rather than a set.
 */
function sweepCauses(pairs: [number, number][], options: DiffOptions): Record<string, string> {
  const seen: Record<string, string> = {};
  for (const [a, b] of pairs) {
    for (const [legacy, candidate] of orientations(a, b)) {
      const cause = causeOf(legacy, candidate, options);
      seen[cause] ??= `${legacy} vs ${candidate}`;
    }
  }
  return seen;
}

// ================================================== assertion 1 · structure ==

describe("structure and paths", () => {
  it("returns no differences for identical structures", () => {
    const payslip = {
      gross: 18500,
      allowances: { housing: 4000, transport: 750 },
      components: [{ code: "BASIC", amount: 13750 }],
      issuedOn: new Date("2026-08-13T00:00:00Z"),
    };
    expect(diffFields(payslip, structuredClone(payslip))).toEqual([]);
    expect(diffFields({}, {})).toEqual([]);
    expect(diffFields([], [])).toEqual([]);
  });

  it("reports every differing leaf, not only the first", () => {
    const legacy = {
      gross: 10000,
      allowances: { housing: 2000, transport: 500 },
      components: [
        { code: "BASIC", amount: 7500 },
        { code: "OT", amount: 250 },
      ],
    };
    const candidate = {
      gross: 10001,
      allowances: { housing: 2100, transport: 500 },
      components: [
        { code: "BASIC", amount: 7600 },
        { code: "OTX", amount: 250 },
      ],
    };
    expect(pathsOf(diffFields(legacy, candidate))).toEqual([
      "allowances.housing",
      "components[0].amount",
      "components[1].code",
      "gross",
    ]);
  });

  it("uses a dot for keys and a bracket for indices", () => {
    expect(at(diffFields({ a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 2 } } } }), "a.b.c.d")).toBeTruthy();
    expect(pathsOf(diffFields([[1, 2]], [[1, 3]]))).toEqual(["[0][1]"]);
    expect(pathsOf(diffFields([{ x: [1] }], [{ x: [2] }]))).toEqual(["[0].x[0]"]);
  });

  it("uses the empty path at a scalar root", () => {
    const diff = single(diffFields(1, 2));
    expect(diff.path).toBe("");
    expect(diff.legacy).toBe(1);
    expect(diff.candidate).toBe(2);
    expect(diff.cause).toBe("value-mismatch");
  });

  it("only ever reports a cause from the declared vocabulary", () => {
    const diffs = diffFields(
      { a: 1, b: "alpha", c: [1, 2], d: new Date(0), e: 1 },
      { a: "1", b: "beta", c: [1], d: new Date(1000), f: 2 },
    );
    expect(diffs.length).toBeGreaterThan(0);
    for (const cause of causesOf(diffs)) expect(ALL_CAUSES).toContain(cause);
  });
});

describe("scalars", () => {
  it("distinguishes a value mismatch from a type mismatch", () => {
    expect(causeOf("alpha", "beta")).toBe("value-mismatch");
    expect(causeOf(true, false)).toBe("value-mismatch");
    expect(causeOf(1, "1")).toBe("type-mismatch");
    expect(causeOf(0, false)).toBe("type-mismatch");
    expect(causeOf({ a: 1 }, 1)).toBe("type-mismatch");
    expect(causeOf([1], { 0: 1 })).toBe("type-mismatch");
  });

  it("treats null and undefined as a type mismatch, not a value mismatch", () => {
    expect(causeOf(null, undefined)).toBe("type-mismatch");
    expect(causeOf(undefined, null)).toBe("type-mismatch");
    expect(diffFields(null, null)).toEqual([]);
    expect(diffFields(undefined, undefined)).toEqual([]);
    expect(causeOf(null, 0)).toBe("type-mismatch");
  });

  it("treats NaN as equal to NaN, and 0 as equal to -0", () => {
    expect(diffFields(Number.NaN, Number.NaN)).toEqual([]);
    expect(diffFields({ net: Number.NaN }, { net: Number.NaN })).toEqual([]);
    expect(diffFields(0, -0)).toEqual([]);
    expect(diffFields({ balance: -0 }, { balance: 0 })).toEqual([]);
  });

  it("still reports NaN and infinities against real numbers, at any tolerance", () => {
    expect(causeOf(Number.NaN, 1)).toBe("value-mismatch");
    expect(causeOf(1, Number.NaN)).toBe("value-mismatch");
    expect(causeOf(Number.NaN, 1, { toleranceMinorUnits: 500 })).toBe("value-mismatch");
    expect(diffFields(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toEqual([]);
    const poles = causeOf(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, { toleranceMinorUnits: 9 });
    expect(poles).toBe("value-mismatch");
  });
});

describe("dates", () => {
  // A Gulf deadline landing on Friday against the same deadline landing on
  // Saturday — the pair most likely to differ between legacy and candidate.
  const friday = new Date("2026-08-14T00:00:00Z");
  const saturday = new Date("2026-08-15T00:00:00Z");

  it("compares dates by time value", () => {
    expect(diffFields(friday, new Date(friday.getTime()))).toEqual([]);
    const diff = single(diffFields(friday, saturday));
    expect(diff.cause).toBe("date-mismatch");
    expect(diff.path).toBe("");
  });

  it("reports a nested date mismatch at its own path", () => {
    const diffs = diffFields({ filing: { dueOn: friday } }, { filing: { dueOn: saturday } });
    expect(at(diffs, "filing.dueOn").cause).toBe("date-mismatch");
  });

  it("reports a date against a non-date, and treats two invalid dates as equal", () => {
    const diff = single(diffFields(friday, friday.toISOString()));
    expect(["type-mismatch", "date-mismatch"]).toContain(diff.cause);
    expect(diff.detail.trim().length).toBeGreaterThan(0);
    // A Date's time value is a number, so the contract's "NaN equals NaN" holds.
    expect(diffFields(new Date(Number.NaN), new Date(Number.NaN))).toEqual([]);
  });
});

describe("arrays", () => {
  it("reports one array-length difference at the array's path plus the overlap", () => {
    const diffs = diffFields({ items: [1, 2, 3] }, { items: [1, 9] });
    expect(at(diffs, "items").cause).toBe("array-length");
    expect(at(diffs, "items[1]").cause).toBe("value-mismatch");
    // Index 2 is outside the overlapping range: it is covered by array-length,
    // not by a per-index difference.
    expect(pathsOf(diffs)).toEqual(["items", "items[1]"]);
  });

  it("reports a length difference even when the whole overlap matches", () => {
    expect(at(diffFields({ items: [1, 2] }, { items: [1, 2, 3] }), "items").cause).toBe("array-length");
    expect(causesOf(diffFields({ items: [1] }, { items: [] }))).toEqual(["array-length"]);
    expect(causesOf(diffFields({ items: [] }, { items: [1] }))).toEqual(["array-length"]);
  });
});

describe("missing keys", () => {
  it("names the side a key is missing from", () => {
    const gone = single(diffFields({ a: 1, b: 2 }, { a: 1 }));
    expect(gone.cause).toBe("missing-in-candidate");
    expect(gone.path).toBe("b");
    expect(gone.legacy).toBe(2);
    expect(gone.candidate).toBeUndefined();

    const added = single(diffFields({ a: 1 }, { a: 1, b: 2 }));
    expect(added.cause).toBe("missing-in-legacy");
    expect(added.path).toBe("b");
    expect(added.legacy).toBeUndefined();
    expect(added.candidate).toBe(2);
  });

  it("reports a missing nested key at its full path", () => {
    expect(at(diffFields({ p: { q: 1 } }, { p: {} }), "p.q").cause).toBe("missing-in-candidate");
    expect(at(diffFields({ p: {} }, { p: { q: 1 } }), "p.q").cause).toBe("missing-in-legacy");
  });
});

// ============================================ assertion 3 · minor-unit tolerance ==

describe("tolerance", () => {
  // The four pairs from the task node. Every one is a one-fils difference, and
  // the previous float comparison (`Math.abs(b - a) <= 0.01`) classified them
  // two different ways because none of their deltas is exactly 0.01 in binary:
  //   1234.56 / 1234.57   delta 0.009999999999990905  -> rounding
  //   100.00  / 100.01    delta 0.010000000000005116  -> value-mismatch
  //   8000.33 / 8000.34   delta 0.010000000000218279  -> value-mismatch
  //   12500.50 / 12500.51 delta 0.010000000000218279  -> value-mismatch
  // The rest are chosen to be awkward in binary for the same reason; none of
  // the 14 has a float delta of exactly 0.01.
  const ONE_MINOR_UNIT: [number, number][] = [
    [1234.56, 1234.57], [100.0, 100.01], [8000.33, 8000.34], [12500.5, 12500.51],
    [0.07, 0.08], [0.1, 0.11], [1.1, 1.11], [9.99, 10.0], [33.33, 33.34],
    [4.2, 4.21], [70.07, 70.08], [999999.99, 1000000.0],
    [-1234.56, -1234.57], [-0.07, -0.08],
  ];

  it.each(ONE_MINOR_UNIT)("classifies %d vs %d as rounding at a tolerance of one minor unit", (legacy, candidate) => {
    expect(causeOf(legacy, candidate, { toleranceMinorUnits: 1 })).toBe("rounding");
    // Direction must not change the classification.
    expect(causeOf(candidate, legacy, { toleranceMinorUnits: 1 })).toBe("rounding");
  });

  it("classifies every one-minor-unit gap identically", () => {
    const causes = new Set(
      ONE_MINOR_UNIT.flatMap(([l, c]) => [
        causeOf(l, c, { toleranceMinorUnits: 1 }),
        causeOf(c, l, { toleranceMinorUnits: 1 }),
      ]),
    );
    expect([...causes]).toEqual(["rounding"]);
  });

  it("is a count of minor units, not a fraction of a major unit", () => {
    // 1 must mean one fils, not one dirham. A one-dirham gap is a real mismatch.
    expect(causeOf(10.0, 11.0, { toleranceMinorUnits: 1 })).toBe("value-mismatch");
    expect(causeOf(10.0, 11.0, { toleranceMinorUnits: 100 })).toBe("rounding");
  });

  it("defaults to zero tolerance, so a one-fils gap is a real mismatch", () => {
    expect(causeOf(1234.56, 1234.57)).toBe("value-mismatch");
    expect(causeOf(1234.56, 1234.57, {})).toBe("value-mismatch");
    expect(causeOf(1234.56, 1234.57, { toleranceMinorUnits: 0 })).toBe("value-mismatch");
  });

  it("reports nothing at all when the amounts are equal, whatever the tolerance", () => {
    expect(diffFields({ net: 8000.33 }, { net: 8000.33 }, { toleranceMinorUnits: 5 })).toEqual([]);
    expect(diffFields({ net: 8000.33 }, { net: 8000.33 })).toEqual([]);
  });

  // Bases deliberately not representable exactly in binary. The previous suite
  // only ever used binary-exact tolerances (0.5, 0.25) and so never caught the
  // defect this task exists to fix.
  const AWKWARD_BASES = [8000.33, 1234.56, 0.07, 12500.5, 70.07, 33.33];

  describe.each([1, 2, 3, 5, 17])("at toleranceMinorUnits %i", (tolerance) => {
    // A gap of exactly the tolerance is rounding; one minor unit more is not.
    it.each(AWKWARD_BASES)("puts the boundary exactly on the tolerance, at %d", (base) => {
      const within = Number((base + tolerance / 100).toFixed(2));
      const beyond = Number((base + (tolerance + 1) / 100).toFixed(2));
      expect(causeOf(base, within, { toleranceMinorUnits: tolerance })).toBe("rounding");
      expect(causeOf(base, beyond, { toleranceMinorUnits: tolerance })).toBe("value-mismatch");
    });
  });

  it("holds the boundary across a sweep of non-binary-exact amounts", () => {
    let awkward = 0;
    for (let i = 1; i <= 250; i += 1) {
      const legacy = Number((i * 137.77).toFixed(2));
      const within = Number((legacy + 0.01).toFixed(2));
      const beyond = Number((legacy + 0.02).toFixed(2));
      if (Math.abs(within - legacy) !== 0.01) awkward += 1;
      expect(causeOf(legacy, within, { toleranceMinorUnits: 1 })).toBe("rounding");
      expect(causeOf(legacy, beyond, { toleranceMinorUnits: 1 })).toBe("value-mismatch");
    }
    // Evidence that the sweep actually exercises the regime that broke the
    // previous implementation rather than a set of tidy binary-exact amounts.
    expect(awkward).toBe(250);
  });

  it("honours a three-decimal currency through minorUnitScale (KWD, BHD)", () => {
    const fils = { toleranceMinorUnits: 1, minorUnitScale: 1000 };
    expect(causeOf(1234.567, 1234.568, fils)).toBe("rounding");
    expect(causeOf(1234.567, 1234.569, fils)).toBe("value-mismatch");
    expect(diffFields(1234.567, 1234.567, fils)).toEqual([]);
  });

  it("honours a whole-unit scale through minorUnitScale", () => {
    const whole = { toleranceMinorUnits: 1, minorUnitScale: 1 };
    expect(causeOf(5, 6, whole)).toBe("rounding");
    expect(causeOf(5, 7, whole)).toBe("value-mismatch");
  });

  it("never lets tolerance swallow a materially different amount", () => {
    expect(causeOf(100, 200, { toleranceMinorUnits: 1 })).toBe("value-mismatch");
    expect(causeOf(0, 18500.75, { toleranceMinorUnits: 50 })).toBe("value-mismatch");
    expect(causeOf(-8000.33, 8000.33, { toleranceMinorUnits: 100 })).toBe("value-mismatch");
  });

  it("applies tolerance to numbers only, never to numeric strings", () => {
    expect(causeOf("1234.56", "1234.57", { toleranceMinorUnits: 1 })).toBe("value-mismatch");
    expect(causeOf("1234.56", 1234.56, { toleranceMinorUnits: 1 })).toBe("type-mismatch");
  });

  it("applies tolerance at every depth, not just at the root", () => {
    const nested = diffFields(
      { payslip: { net: 8000.33, components: [{ amount: 12500.5 }] } },
      { payslip: { net: 8000.34, components: [{ amount: 12500.51 }] } },
      { toleranceMinorUnits: 1 },
    );
    expect(at(nested, "payslip.net").cause).toBe("rounding");
    expect(at(nested, "payslip.components[0].amount").cause).toBe("rounding");
  });
});

// ========================= harness-sub-minor-cause · a gap finer than scale ==

describe("sub-minor-unit gaps", () => {
  // Kuwait and Bahrain price in three-decimal currencies. Run against the
  // default minorUnitScale of 100, a genuine one-fils KWD or BHD gap is finer
  // than a minor unit: both sides scale to the same integer, so the gap in
  // minor units is zero. Zero is inside every tolerance, which is exactly why
  // it must not be called `rounding` — a consumer that drops rounding as
  // tolerated noise would drop a real discrepancy on two live jurisdictions.
  const SUB_MINOR: [number, number][] = [
    [1234.567, 1234.568],   // the motivating KWD pair
    [8000.331, 8000.332],
    [12500.501, 12500.502],
    [70.071, 70.072],
    [0.001, 0.002],
    [999999.991, 999999.992],
    [-1234.567, -1234.568],
    [-0.001, -0.002],
  ];

  it.each(SUB_MINOR)("classifies %d vs %d as sub-minor-unit at the default scale", (legacy, candidate) => {
    expect(causeOf(legacy, candidate)).toBe("sub-minor-unit");
    // Direction must not change the classification.
    expect(causeOf(candidate, legacy)).toBe("sub-minor-unit");
  });

  // Assertion 2. A gap of zero minor units sits inside every tolerance, so a
  // tolerance-driven classifier would call all of these `rounding`. None of
  // these tolerances — including the default 0 — may reclassify or suppress it.
  describe.each([0, 1, 2, 100, 1_000_000])("at toleranceMinorUnits %i", (toleranceMinorUnits) => {
    it("still reports sub-minor-unit, never rounding and never nothing", () => {
      for (const [legacy, candidate] of SUB_MINOR) {
        const diffs = diffFields(legacy, candidate, { toleranceMinorUnits });
        expect(diffs, `${legacy} vs ${candidate}`).toHaveLength(1);
        expect(diffs[0].cause, `${legacy} vs ${candidate}`).toBe("sub-minor-unit");
        expect(diffs[0].cause).not.toBe("rounding");
      }
    });
  });

  it("survives a consumer that filters `rounding` away as tolerated noise", () => {
    const diffs = diffFields(
      { kwd: 1234.567, aed: 8000.33 },
      { kwd: 1234.568, aed: 8000.34 },
      { toleranceMinorUnits: 1 },
    );
    expect(at(diffs, "aed").cause).toBe("rounding");
    expect(at(diffs, "kwd").cause).toBe("sub-minor-unit");
    // The whole point of the new cause: this filter must not be able to reach it.
    expect(pathsOf(diffs.filter((d) => d.cause !== "rounding"))).toEqual(["kwd"]);
  });

  it("is a whole minor unit once the scale is right for a three-decimal currency", () => {
    const fils = { minorUnitScale: 1000 };
    expect(causeOf(1234.567, 1234.568, fils)).toBe("value-mismatch");
    expect(causeOf(1234.567, 1234.568, { ...fils, toleranceMinorUnits: 0 })).toBe("value-mismatch");
    expect(causeOf(1234.567, 1234.568, { ...fils, toleranceMinorUnits: 1 })).toBe("rounding");
    expect(causeOf(1234.567, 1234.568, { ...fils, toleranceMinorUnits: 9 })).toBe("rounding");
    expect(causeOf(1234.567, 1234.569, { ...fils, toleranceMinorUnits: 1 })).toBe("value-mismatch");
  });

  it("applies the new cause at whatever scale is configured, not only at 100", () => {
    // A fourth decimal is sub-minor even for a correctly configured KWD run.
    expect(causeOf(1234.5671, 1234.5672, { minorUnitScale: 1000 })).toBe("sub-minor-unit");
    expect(causeOf(1234.5671, 1234.5672, { minorUnitScale: 1000, toleranceMinorUnits: 5 })).toBe("sub-minor-unit");
    // A whole-unit scale: anything below a whole unit is sub-minor.
    expect(causeOf(5.1, 5.2, { minorUnitScale: 1 })).toBe("sub-minor-unit");
    expect(causeOf(5, 6, { minorUnitScale: 1, toleranceMinorUnits: 1 })).toBe("rounding");
    expect(causeOf(5, 6, { minorUnitScale: 1 })).toBe("value-mismatch");
  });

  it("leaves the one-minor-unit boundary exactly where it was", () => {
    expect(causeOf(1234.56, 1234.57, { toleranceMinorUnits: 1 })).toBe("rounding");
    expect(causeOf(1234.56, 1234.57, { toleranceMinorUnits: 0 })).toBe("value-mismatch");
    expect(causeOf(1234.56, 1234.57)).toBe("value-mismatch");
    expect(causeOf(1234.56, 1234.58, { toleranceMinorUnits: 1 })).toBe("value-mismatch");
    expect(causeOf(8000.33, 8000.34, { toleranceMinorUnits: 1 })).toBe("rounding");
    expect(causeOf(8000.33, 8000.34, { toleranceMinorUnits: 0 })).toBe("value-mismatch");
  });

  it("reports a nested sub-minor-unit gap at its own path", () => {
    const diffs = diffFields(
      { payslip: { net: 1234.567, components: [{ amount: 8000.331 }, { amount: 70.07 }] } },
      { payslip: { net: 1234.568, components: [{ amount: 8000.332 }, { amount: 70.08 }] } },
      { toleranceMinorUnits: 1 },
    );
    expect(pathsOf(diffs)).toEqual([
      "payslip.components[0].amount", "payslip.components[1].amount", "payslip.net",
    ]);
    expect(at(diffs, "payslip.net").cause).toBe("sub-minor-unit");
    expect(at(diffs, "payslip.components[0].amount").cause).toBe("sub-minor-unit");
    expect(at(diffs, "payslip.components[1].amount").cause).toBe("rounding");
    // Bare array root, so the bracket path is exercised without an object above it.
    expect(at(diffFields([1234.567], [1234.568]), "[0]").cause).toBe("sub-minor-unit");
  });

  it("names both raw values in the detail and carries them verbatim", () => {
    const diff = single(diffFields(1234.567, 1234.568, { toleranceMinorUnits: 5 }));
    expect(diff.cause).toBe("sub-minor-unit");
    // Without the raw values a gap of zero minor units reads as "no difference".
    expect(diff.detail).toContain("1234.567");
    expect(diff.detail).toContain("1234.568");
    expect(diff.legacy).toBe(1234.567);
    expect(diff.candidate).toBe(1234.568);
  });

  it("gives a detail distinct from a rounding and from a value mismatch", () => {
    const options = { toleranceMinorUnits: 1 };
    const subMinor = single(diffFields(1234.567, 1234.568, options)).detail;
    const rounding = single(diffFields(1234.56, 1234.57, options)).detail;
    const mismatch = single(diffFields(1234.56, 1234.58, options)).detail;
    expect(new Set([subMinor, rounding, mismatch]).size).toBe(3);
    for (const detail of [subMinor, rounding, mismatch]) expect(detail.trim().length).toBeGreaterThan(0);
  });

  // A non-finite value has no distance to measure, and a magnitude past 1e307
  // overflows any float that tries to scale it — under either the old scaling
  // or an exact one, none of these is a sub-minor gap, and all keep the
  // classification they already had.
  it("never sweeps a non-finite or overflowing gap into the new cause", () => {
    const cases: [unknown, unknown][] = [
      [Number.POSITIVE_INFINITY, 1e308],
      [1e308, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, -1e308],
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [Number.NaN, 1234.567],
      [1234.567, Number.NaN],
      [1e307, 2e307], // 1e309 minor units apart — and Infinity through a float multiply
    ];
    for (const options of [undefined, { toleranceMinorUnits: 0 }, { toleranceMinorUnits: 1_000_000 }]) {
      for (const [legacy, candidate] of cases) {
        const cause = causeOf(legacy, candidate, options);
        expect(cause, `${String(legacy)} vs ${String(candidate)}`).toBe("value-mismatch");
      }
    }
  });

  it("reports nothing at all when the amounts are equal, at any scale or tolerance", () => {
    expect(diffFields(1234.567, 1234.567)).toEqual([]);
    expect(diffFields({ net: 1234.567 }, { net: 1234.567 }, { toleranceMinorUnits: 0 })).toEqual([]);
    expect(diffFields({ net: 1234.567 }, { net: 1234.567 }, { minorUnitScale: 1000 })).toEqual([]);
    expect(diffFields(Number.NaN, Number.NaN, { minorUnitScale: 1000 })).toEqual([]);
    expect(diffFields(0, -0, { minorUnitScale: 1000 })).toEqual([]);
    expect(diffFields(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, { minorUnitScale: 1000 })).toEqual([]);
    expect(diffFields(1e308, 1e308)).toEqual([]);
  });

  // The invariant, over a sweep of amounts that are awkward in binary: a third
  // decimal at scale 100 is always the same cause, whatever the amount, whatever
  // the direction, whatever the tolerance.
  it("classifies every third-decimal gap identically across a sweep", () => {
    const causes = new Set<DifferenceCause>();
    let checked = 0;
    for (let i = 1; i <= 150; i += 1) {
      const base = Number((i * 137.77).toFixed(2));
      const legacy = base + 0.001;
      const candidate = base + 0.002;
      for (const toleranceMinorUnits of [0, 1, 250]) {
        causes.add(causeOf(legacy, candidate, { toleranceMinorUnits }));
        causes.add(causeOf(candidate, legacy, { toleranceMinorUnits }));
      }
      checked += 1;
    }
    expect(checked).toBe(150);
    expect([...causes]).toEqual(["sub-minor-unit"]);
  });
});

// ================= harness-exact-minor-scaling · the true distance decides ==
//
// The cause keys on the true distance between the two values, measured in minor
// units and computed exactly:
//     above 0, below one minor unit   -> sub-minor-unit, at every tolerance
//     one or more units, <= tolerance -> rounding
//     more than the tolerance         -> value-mismatch
// `Math.round(x * scale)` is not that distance: it is a float multiply, and it
// bends x.xx5 pairs in both directions and loses whole minor units at magnitudes
// where doubles are further apart than a fils.

const EVERY_TOLERANCE = [0, 1, 2, 100, 1_000_000];

describe("exact scaling · the four distances a float multiply misreports", () => {
  const COLLAPSE: [string, string] = ["0.135", "0.145"];   // both scale+round to 14 -> a gap of 0
  const INFLATE: [string, string] = ["0.145", "0.155"];    // scale+round to 14 and 16 -> a gap of 2
  const LARGE: [string, string] = ["100000000000000.03", "100000000000000.05"];
  const STRADDLE: [string, string] = ["1234.564", "1234.566"];

  /** Every orientation of `pair` must classify the same way at `tolerance`. */
  function expectCause(pair: [string, string], toleranceMinorUnits: number, expected: DifferenceCause): void {
    for (const [legacy, candidate] of orientations(decimal(pair[0]), decimal(pair[1]))) {
      const label = `${legacy} vs ${candidate} at tolerance ${toleranceMinorUnits}`;
      expect(causeOf(legacy, candidate, { toleranceMinorUnits }), label).toBe(expected);
    }
  }

  it("measures 0.135 vs 0.145 as one minor unit, though both scale and round to 14", () => {
    expectCause(COLLAPSE, 0, "value-mismatch");
    expectCause(COLLAPSE, 1, "rounding");
    expectCause(COLLAPSE, 2, "rounding");
  });

  it("measures 0.145 vs 0.155 as one minor unit, though they scale and round to 14 and 16", () => {
    // The inflating half: the old boundary called this a value-mismatch at a
    // tolerance of one, which is a pre-existing bug in rounding, not only in
    // the new cause.
    expectCause(INFLATE, 0, "value-mismatch");
    expectCause(INFLATE, 1, "rounding");
    expectCause(INFLATE, 2, "rounding");
  });

  it("keeps two minor units at a magnitude where consecutive doubles are 0.0156 apart", () => {
    expectCause(LARGE, 0, "value-mismatch");
    expectCause(LARGE, 1, "value-mismatch");
    expectCause(LARGE, 2, "rounding");
    expectCause(LARGE, 3, "rounding");
  });

  it("calls a fifth of a minor unit sub-minor even when it straddles the rounding boundary", () => {
    // An intended behaviour change: scaled and rounded these are 123456 and
    // 123457, so the old code reported a whole minor unit that is not there.
    for (const tolerance of EVERY_TOLERANCE) expectCause(STRADDLE, tolerance, "sub-minor-unit");
  });

  it("never calls a whole-minor-unit pair sub-minor, at any tolerance or orientation", () => {
    for (const pair of [COLLAPSE, INFLATE, LARGE]) {
      for (const toleranceMinorUnits of EVERY_TOLERANCE) {
        for (const [legacy, candidate] of orientations(decimal(pair[0]), decimal(pair[1]))) {
          expect(causeOf(legacy, candidate, { toleranceMinorUnits }),
            `${legacy} vs ${candidate} at tolerance ${toleranceMinorUnits}`).not.toBe("sub-minor-unit");
        }
      }
    }
  });
});

describe("exact scaling · the x.xx5 sweep", () => {
  // Pairs exactly one minor unit apart whose ends both sit on a rounding
  // boundary — the population a float multiply bends, in one direction or the
  // other, in better than one case in ten. A sweep this wide cannot miss it.
  const WHOLES = [0, 1, 7, 42, 137, 999, 12500];
  const AT_100 = halfMinorPairs(2, WHOLES, 99);
  // The same shape one decimal deeper, for a KWD or BHD run configured at 1000.
  const AT_1000 = halfMinorPairs(3, [0, 1234], 120);

  it("sweeps enough pairs for a one-in-ten defect to be certain to show", () => {
    expect(AT_100).toHaveLength(693);
    expect(AT_1000).toHaveLength(240);
  });

  it("reports every one of them as a real mismatch at tolerance 0", () => {
    expect(sweepCauses(AT_100, { toleranceMinorUnits: 0 })).toEqual({ "value-mismatch": expect.any(String) });
    expect(sweepCauses(AT_1000, { toleranceMinorUnits: 0, minorUnitScale: 1000 }))
      .toEqual({ "value-mismatch": expect.any(String) });
  });

  it("reports every one of them as rounding from a tolerance of one upwards", () => {
    for (const toleranceMinorUnits of [1, 2, 1_000_000]) {
      expect(sweepCauses(AT_100, { toleranceMinorUnits }), `tolerance ${toleranceMinorUnits}`)
        .toEqual({ rounding: expect.any(String) });
    }
    expect(sweepCauses(AT_1000, { toleranceMinorUnits: 1, minorUnitScale: 1000 }))
      .toEqual({ rounding: expect.any(String) });
  });

  it("never calls one of them sub-minor-unit", () => {
    for (const toleranceMinorUnits of EVERY_TOLERANCE) {
      const causes = Object.keys(sweepCauses(AT_100, { toleranceMinorUnits }));
      expect(causes, `tolerance ${toleranceMinorUnits}`).not.toContain("sub-minor-unit");
    }
  });

  // The other half of the same population. x.xx4 against x.xx6 is two
  // thousandths — a fifth of a minor unit — and every such pair straddles the
  // rounding boundary, which is where the old scaling invented a whole unit.
  it("calls every straddling x.xx4 / x.xx6 pair sub-minor, at every tolerance", () => {
    const straddling: [number, number][] = [];
    for (const whole of WHOLES) {
      for (let cents = 0; cents <= 99; cents += 1) {
        const at = (last: number): string => `${whole}.${String(cents).padStart(2, "0")}${last}`;
        straddling.push([decimal(at(4)), decimal(at(6))]);
      }
    }
    expect(straddling).toHaveLength(700);
    for (const toleranceMinorUnits of [0, 1, 1_000_000]) {
      expect(sweepCauses(straddling, { toleranceMinorUnits }), `tolerance ${toleranceMinorUnits}`)
        .toEqual({ "sub-minor-unit": expect.any(String) });
    }
  });
});

describe("exact scaling · one minor unit exactly", () => {
  // Every magnitude a payslip reaches, and several decades past it.
  const ONE_UNIT: [string, string][] = [
    ["0", "0.01"], ["0.01", "0.02"], ["0.135", "0.145"], ["9.99", "10"],
    ["999999.99", "1000000"], ["99999999.99", "100000000"],
    ["12345678.9", "12345678.91"], ["1000000000000.01", "1000000000000.02"],
  ];
  // Strictly under one minor unit, including two that straddle the boundary.
  const UNDER_ONE_UNIT: [string, string][] = [
    ["0", "0.009"], ["0.135", "0.1359"], ["1234.564", "1234.566"],
    ["8000.33", "8000.339"], ["1e-7", "0.01"],
  ];

  it("is a mismatch at tolerance 0 and a rounding at tolerance 1 — never sub-minor", () => {
    for (const [a, b] of ONE_UNIT) {
      for (const [legacy, candidate] of orientations(decimal(a), decimal(b))) {
        const label = `${legacy} vs ${candidate}`;
        expect(causeOf(legacy, candidate), label).toBe("value-mismatch");
        expect(causeOf(legacy, candidate, { toleranceMinorUnits: 0 }), label).toBe("value-mismatch");
        expect(causeOf(legacy, candidate, { toleranceMinorUnits: 1 }), label).toBe("rounding");
      }
    }
  });

  it("is sub-minor strictly below one minor unit, and no tolerance can mask it", () => {
    for (const [a, b] of UNDER_ONE_UNIT) {
      for (const [legacy, candidate] of orientations(decimal(a), decimal(b))) {
        for (const toleranceMinorUnits of EVERY_TOLERANCE) {
          expect(causeOf(legacy, candidate, { toleranceMinorUnits }),
            `${legacy} vs ${candidate} at tolerance ${toleranceMinorUnits}`).toBe("sub-minor-unit");
        }
      }
    }
  });

  it("leaves a straddling gap in the hand of a consumer that filters rounding away", () => {
    const diffs = diffFields(
      { kwd: 1234.564, aed: 0.135 },
      { kwd: 1234.566, aed: 0.145 },
      { toleranceMinorUnits: 1_000_000 },
    );
    expect(at(diffs, "aed").cause).toBe("rounding");
    expect(at(diffs, "kwd").cause).toBe("sub-minor-unit");
    expect(pathsOf(diffs.filter((d) => d.cause !== "rounding"))).toEqual(["kwd"]);
  });
});

describe("exact scaling · exponential round-trip strings", () => {
  // String(1e-7) is "1e-7" and String(1e21) is "1e+21". Shifting a decimal point
  // through those strings without reading the exponent mis-scales them by
  // twenty-odd orders of magnitude, in silence.
  it("keeps a tiny exponential gap sub-minor rather than equal or mismatched", () => {
    const tiny: [number, number][] = [
      [1e-7, 2e-7], [1.5e-8, 2.5e-8], [0, 1e-7], [1e-7, 0.000001], [-1e-7, 1e-7],
    ];
    for (const [a, b] of tiny) {
      for (const [legacy, candidate] of [[a, b], [b, a]] as [number, number][]) {
        for (const toleranceMinorUnits of EVERY_TOLERANCE) {
          expect(causeOf(legacy, candidate, { toleranceMinorUnits }),
            `${legacy} vs ${candidate} at tolerance ${toleranceMinorUnits}`).toBe("sub-minor-unit");
        }
      }
    }
  });

  it("puts the one-minor-unit boundary exactly right with an exponential on one side", () => {
    // 0.0100001 - 1e-7 is 0.01 exactly: one whole minor unit, not a hair under.
    const tiny = decimal("1e-7");
    const edge = decimal("0.0100001");
    expect(causeOf(tiny, edge, { toleranceMinorUnits: 0 })).toBe("value-mismatch");
    expect(causeOf(tiny, edge, { toleranceMinorUnits: 1 })).toBe("rounding");
    expect(causeOf(edge, tiny, { toleranceMinorUnits: 1 })).toBe("rounding");
    for (const toleranceMinorUnits of EVERY_TOLERANCE) {
      expect(causeOf(tiny, edge, { toleranceMinorUnits }), `tolerance ${toleranceMinorUnits}`)
        .not.toBe("sub-minor-unit");
    }
    // ...and a hair under is sub-minor: 0.01 - 1e-7 is 0.9999... of a unit.
    expect(causeOf(tiny, decimal("0.01"), { toleranceMinorUnits: 1 })).toBe("sub-minor-unit");
  });

  it("scales a value whose string carries a positive exponent", () => {
    const huge = decimal("1e+21");
    // 100000 lower — exactly ten million minor units at the default scale.
    const justUnder = decimal("999999999999999900000");
    expect(causeOf(justUnder, huge, { toleranceMinorUnits: 9_999_999 })).toBe("value-mismatch");
    expect(causeOf(justUnder, huge, { toleranceMinorUnits: 10_000_000 })).toBe("rounding");
    expect(causeOf(huge, justUnder, { toleranceMinorUnits: 10_000_000 })).toBe("rounding");
    expect(causeOf(huge, decimal("2e+21"), { toleranceMinorUnits: 1_000_000 })).toBe("value-mismatch");
    expect(causeOf(-huge, huge, { toleranceMinorUnits: 1_000_000 })).toBe("value-mismatch");
    expect(causeOf(1e-7, huge, { toleranceMinorUnits: 1_000_000 })).toBe("value-mismatch");
    for (const toleranceMinorUnits of EVERY_TOLERANCE) {
      expect(causeOf(justUnder, huge, { toleranceMinorUnits }), `tolerance ${toleranceMinorUnits}`)
        .not.toBe("sub-minor-unit");
    }
  });

  it("reports nothing at all between two equal exponential values", () => {
    for (const value of [1e-7, 1.5e-8, 1e21, -1e21, 5e-324]) {
      expect(diffFields(value, value), String(value)).toEqual([]);
      expect(diffFields({ v: value }, { v: value }, { toleranceMinorUnits: 3, minorUnitScale: 1000 }),
        String(value)).toEqual([]);
    }
  });
});

describe("exact scaling · a minorUnitScale that is not a power of ten", () => {
  it("never calls a gap of exactly one minor unit sub-minor, at any scale", () => {
    const EXACTLY_ONE: [number, string, string][] = [
      [1, "5", "6"], [2, "1", "1.5"], [4, "1", "1.25"], [5, "1", "1.2"],
      [8, "1", "1.125"], [20, "1", "1.05"], [1000, "1.001", "1.002"],
    ];
    for (const [minorUnitScale, a, b] of EXACTLY_ONE) {
      const [legacy, candidate] = [decimal(a), decimal(b)];
      const label = `${a} vs ${b} at scale ${minorUnitScale}`;
      expect(causeOf(legacy, candidate, { minorUnitScale }), label).toBe("value-mismatch");
      expect(causeOf(legacy, candidate, { minorUnitScale, toleranceMinorUnits: 1 }), label).toBe("rounding");
      expect(causeOf(candidate, legacy, { minorUnitScale, toleranceMinorUnits: 1 }), label).toBe("rounding");
      for (const toleranceMinorUnits of EVERY_TOLERANCE) {
        expect(causeOf(legacy, candidate, { minorUnitScale, toleranceMinorUnits }), label)
          .not.toBe("sub-minor-unit");
      }
    }
  });

  it("calls a gap under one minor unit sub-minor at scales 3 and 7", () => {
    // One minor unit is 0.333... at scale 3 and 0.142857... at scale 7, so no
    // decimal amount is exactly one unit away at either — but plenty are under.
    const UNDER: [number, string, string][] = [
      [3, "1", "1.1"], [3, "1", "1.3"], [7, "1", "1.1"], [7, "1", "1.14"],
    ];
    for (const [minorUnitScale, a, b] of UNDER) {
      for (const toleranceMinorUnits of EVERY_TOLERANCE) {
        expect(causeOf(decimal(a), decimal(b), { minorUnitScale, toleranceMinorUnits }),
          `${a} vs ${b} at scale ${minorUnitScale}, tolerance ${toleranceMinorUnits}`).toBe("sub-minor-unit");
      }
    }
  });

  it("keeps whole multiples of an awkward scale on the right side of the tolerance", () => {
    const MULTIPLES: [number, string, string, number][] = [
      [3, "1", "2", 3], [3, "1", "3", 6], [7, "1", "2", 7], [7, "1", "3", 14],
    ];
    for (const [minorUnitScale, a, b, units] of MULTIPLES) {
      const label = `${a} vs ${b} at scale ${minorUnitScale}`;
      expect(causeOf(decimal(a), decimal(b), { minorUnitScale, toleranceMinorUnits: units - 1 }), label)
        .toBe("value-mismatch");
      expect(causeOf(decimal(a), decimal(b), { minorUnitScale, toleranceMinorUnits: units }), label)
        .toBe("rounding");
    }
  });

  it("is self-consistent on a fractional number of awkward minor units", () => {
    // 1 vs 1.5 at scale 3 is one and a half minor units: past the boundary, so
    // never sub-minor, a mismatch at tolerance 0, and a rounding by tolerance 2.
    // Whether tolerance 1 admits it is the implementation's to decide — but it
    // must answer the same way each time and never narrow as tolerance widens.
    const minorUnitScale = 3;
    const [legacy, candidate] = [decimal("1"), decimal("1.5")];
    expect(causeOf(legacy, candidate, { minorUnitScale, toleranceMinorUnits: 0 })).toBe("value-mismatch");
    expect(causeOf(legacy, candidate, { minorUnitScale, toleranceMinorUnits: 2 })).toBe("rounding");
    const atOne = causeOf(legacy, candidate, { minorUnitScale, toleranceMinorUnits: 1 });
    expect(["rounding", "value-mismatch"]).toContain(atOne);
    expect(causeOf(candidate, legacy, { minorUnitScale, toleranceMinorUnits: 1 })).toBe(atOne);
    let tolerated = false;
    for (const toleranceMinorUnits of [0, 1, 2, 3, 100]) {
      const cause = causeOf(legacy, candidate, { minorUnitScale, toleranceMinorUnits });
      expect(cause, `tolerance ${toleranceMinorUnits}`).not.toBe("sub-minor-unit");
      if (cause === "rounding") tolerated = true;
      else expect(tolerated, `tolerance ${toleranceMinorUnits} narrowed after a rounding`).toBe(false);
    }
  });
});

describe("exact scaling · the gap it reports", () => {
  it("names the true number of minor units, not one a float multiply produced", () => {
    // 0.44 - 0.01 is 43 minor units, and neither value, nor the tolerance, nor
    // the scale contains "43": it can only come from the measured gap.
    const wide = single(diffFields(decimal("0.01"), decimal("0.44"), { toleranceMinorUnits: 50 }));
    expect(wide.cause).toBe("rounding");
    expect(wide.detail).toContain("43");
    // 2.34 - 1.11 is 123 minor units, and 122.99999999999997 through a multiply.
    const wider = single(diffFields(decimal("1.11"), decimal("2.34"), { toleranceMinorUnits: 200 }));
    expect(wider.cause).toBe("rounding");
    expect(wider.detail).toContain("123");
  });

  it("does not inflate the gap of an x.xx5 pair", () => {
    const diff = single(diffFields(decimal("0.145"), decimal("0.155"), { toleranceMinorUnits: 1 }));
    expect(diff.cause).toBe("rounding");
    // The old scaling made two minor units of this one. Nothing in a one-unit
    // gap between 0.145 and 0.155 at a tolerance of 1 contains a "2".
    expect(diff.detail).not.toContain("2");
  });

  it("does not collapse the gap of a pair a float multiply cannot resolve", () => {
    const [legacy, candidate] = [decimal("100000000000000.03"), decimal("100000000000000.05")];
    const diff = single(diffFields(legacy, candidate, { toleranceMinorUnits: 5 }));
    expect(diff.cause).toBe("rounding");
    expect(diff.detail).toContain("2"); // two minor units, not the zero a multiply gives
    expect(diff.legacy).toBe(legacy);
    expect(diff.candidate).toBe(candidate);
  });

  it("carries both raw values verbatim, and names them, on a collapsed pair", () => {
    const diff = single(diffFields(0.135, 0.145));
    expect(diff.cause).toBe("value-mismatch");
    expect(diff.legacy).toBe(0.135);
    expect(diff.candidate).toBe(0.145);
    expect(diff.detail).toContain("0.135");
    expect(diff.detail).toContain("0.145");
  });

  it("applies exact scaling at depth, and keeps each leaf on its own cause", () => {
    const diffs = diffFields(
      { payslip: { net: 0.135, rows: [{ amount: 1234.564 }, { amount: 0.145 }] } },
      { payslip: { net: 0.145, rows: [{ amount: 1234.566 }, { amount: 0.155 }] } },
      { toleranceMinorUnits: 1 },
    );
    expect(pathsOf(diffs)).toEqual(["payslip.net", "payslip.rows[0].amount", "payslip.rows[1].amount"]);
    expect(at(diffs, "payslip.net").cause).toBe("rounding");
    expect(at(diffs, "payslip.rows[0].amount").cause).toBe("sub-minor-unit");
    expect(at(diffs, "payslip.rows[1].amount").cause).toBe("rounding");
    expect(at(diffs, "payslip.rows[0].amount").legacy).toBe(1234.564);
    expect(at(diffs, "payslip.rows[0].amount").candidate).toBe(1234.566);
  });
});

describe("option validation", () => {
  const INVALID: [string, DiffOptions][] = [
    ["a fractional tolerance", { toleranceMinorUnits: 0.5 }],
    ["a negative tolerance", { toleranceMinorUnits: -1 }],
    ["a NaN tolerance", { toleranceMinorUnits: Number.NaN }],
    ["an infinite tolerance", { toleranceMinorUnits: Number.POSITIVE_INFINITY }],
    ["a zero scale", { minorUnitScale: 0 }],
    ["a negative scale", { minorUnitScale: -100 }],
    ["a fractional scale", { minorUnitScale: 2.5 }],
  ];

  it.each(INVALID)("rejects %s loudly rather than coercing it", (_label, options) => {
    expect(() => diffFields({ net: 1 }, { net: 2 }, options)).toThrow();
  });

  it("accepts the documented valid extremes", () => {
    expect(() => diffFields({ net: 1 }, { net: 2 })).not.toThrow();
    expect(() => diffFields({ net: 1 }, { net: 2 }, {})).not.toThrow();
    expect(() => diffFields({ net: 1 }, { net: 2 }, { toleranceMinorUnits: 0 })).not.toThrow();
    expect(() => diffFields({ net: 1 }, { net: 2 }, { minorUnitScale: 1 })).not.toThrow();
  });
});

// ==================================== assertion 4 · nothing silently equal ==

describe("values it cannot compare structurally", () => {
  // The previous implementation compared these as empty key bags, so two
  // different Maps came back EQUAL. That is the failure motivating assertion 4.
  const UNSUPPORTED: [string, unknown, unknown][] = [
    ["Map", new Map([["a", 1]]), new Map([["a", 2]])],
    ["Set", new Set([1, 2]), new Set([1, 3])],
    ["RegExp", /alpha/g, /beta/i],
    ["Error", new Error("legacy failed"), new Error("candidate failed")],
    ["function", () => 1, () => 2],
  ];

  it.each(UNSUPPORTED)("reports two different %ss rather than calling them equal", (_label, legacy, candidate) => {
    expect(at(diffFields({ v: legacy }, { v: candidate }), "v").cause).toBe("unsupported-type");
  });

  // Strong reading of the contract: "anything not a plain object, array, Date
  // or primitive must be REPORTED, never silently equal" is unconditional, so
  // even same-looking instances are reported — the differ cannot know.
  it("reports an unsupported value even when the two instances look alike", () => {
    const diffs = diffFields({ m: new Map([["a", 1]]) }, { m: new Map([["a", 1]]) });
    expect(diffs.length).toBeGreaterThan(0);
    expect(at(diffs, "m").cause).toBe("unsupported-type");
  });

  it("reports an unsupported value against a plain object", () => {
    const diff = single(diffFields({ m: new Map([["a", 1]]) }, { m: { a: 1 } }));
    expect(["unsupported-type", "type-mismatch"]).toContain(diff.cause);
    expect(diff.path).toBe("m");
    expect(diff.detail.trim().length).toBeGreaterThan(0);
  });

  it("keeps recursing past an unsupported value to the rest of the structure", () => {
    const diffs = diffFields(
      { m: new Map([["a", 1]]), net: 100 },
      { m: new Map([["a", 2]]), net: 101 },
    );
    expect(pathsOf(diffs)).toEqual(["m", "net"]);
  });
});

describe("cycles", () => {
  type Node = { name: string; self?: Node; peer?: Node };

  it("reports a self-reference as a cycle instead of overflowing the stack", () => {
    const legacy: Node = { name: "root" };
    legacy.self = legacy;
    const candidate: Node = { name: "root" };
    candidate.self = candidate;

    const diffs = diffFields(legacy, candidate);
    expect(causesOf(diffs)).toContain("cycle");
  });

  it("reports a mutual reference, and a cycle through an array", () => {
    const mutual = (): Node => {
      const a: Node = { name: "a" };
      const b: Node = { name: "b" };
      a.peer = b;
      b.peer = a;
      return a;
    };
    expect(causesOf(diffFields(mutual(), mutual()))).toContain("cycle");

    const ring = (): unknown[] => {
      const r: unknown[] = [1];
      r.push(r);
      return r;
    };
    expect(causesOf(diffFields(ring(), ring()))).toContain("cycle");
  });

  it("does not mistake a repeated but acyclic reference for a cycle", () => {
    const shared = { amount: 100 };
    const legacy = { a: shared, b: shared };
    const other = { amount: 100 };
    expect(diffFields(legacy, { a: other, b: other })).toEqual([]);
  });
});

// ================================================ assertion 2 · cause+detail ==

describe("cause and detail", () => {
  // One diff carrying eight distinct causes.
  const legacy = {
    typed: 1,
    valued: "alpha",
    rounded: 5.0,
    subMinor: 1234.567,
    sized: [1, 2],
    dated: new Date("2026-08-14T00:00:00Z"),
    onlyLegacy: 42,
  };
  const candidate = {
    typed: "1",
    valued: "beta",
    rounded: 5.01,
    subMinor: 1234.568,
    sized: [1],
    dated: new Date("2026-08-15T00:00:00Z"),
    onlyCandidate: 43,
  };
  const diffs = diffFields(legacy, candidate, { toleranceMinorUnits: 1 });

  it("classifies each difference with its own specific cause", () => {
    expect(at(diffs, "typed").cause).toBe("type-mismatch");
    expect(at(diffs, "valued").cause).toBe("value-mismatch");
    expect(at(diffs, "rounded").cause).toBe("rounding");
    // A gap finer than the scale sits beside a genuine rounding and stays apart from it.
    expect(at(diffs, "subMinor").cause).toBe("sub-minor-unit");
    expect(at(diffs, "sized").cause).toBe("array-length");
    expect(at(diffs, "dated").cause).toBe("date-mismatch");
    expect(at(diffs, "onlyLegacy").cause).toBe("missing-in-candidate");
    expect(at(diffs, "onlyCandidate").cause).toBe("missing-in-legacy");
  });

  it("gives every difference a non-empty detail, and never the same one twice", () => {
    expect(diffs).toHaveLength(8);
    for (const diff of diffs) expect(diff.detail.trim().length).toBeGreaterThan(0);
    // A generic message reused across causes would defeat assertion 2.
    expect(new Set(diffs.map((d) => d.detail)).size).toBe(diffs.length);
  });

  it("names the values in a value mismatch and the types in a type mismatch", () => {
    expect(at(diffs, "valued").detail).toContain("alpha");
    expect(at(diffs, "valued").detail).toContain("beta");
    const typed = at(diffs, "typed").detail.toLowerCase();
    expect(typed).toContain("number");
    expect(typed).toContain("string");
  });

  it("carries both sides verbatim on every difference", () => {
    expect(at(diffs, "valued").legacy).toBe("alpha");
    expect(at(diffs, "valued").candidate).toBe("beta");
    expect(at(diffs, "rounded").legacy).toBe(5.0);
    expect(at(diffs, "rounded").candidate).toBe(5.01);
    expect(at(diffs, "subMinor").legacy).toBe(1234.567);
    expect(at(diffs, "subMinor").candidate).toBe(1234.568);
  });

  it("distinguishes the detail of a rounding from that of a value mismatch", () => {
    const rounding = single(diffFields(8000.33, 8000.34, { toleranceMinorUnits: 1 })).detail;
    const mismatch = single(diffFields(8000.33, 8000.35, { toleranceMinorUnits: 1 })).detail;
    expect(rounding).not.toBe(mismatch);
    expect(rounding.trim().length).toBeGreaterThan(0);
    expect(mismatch.trim().length).toBeGreaterThan(0);
  });
});

describe("ignorePaths", () => {
  it("skips exactly the listed paths", () => {
    const legacy = { a: 1, ab: 2, items: [1, 2] };
    const candidate = { a: 9, ab: 8, items: [7, 6] };
    const diffs = diffFields(legacy, candidate, { ignorePaths: ["a", "items[0]"] });
    // "ab" is not "a": a prefix match would wrongly swallow it.
    expect(pathsOf(diffs)).toEqual(["ab", "items[1]"]);
  });

  it("changes nothing when the list is empty or names an absent path", () => {
    const legacy = { a: 1, b: 2 };
    const candidate = { a: 9, b: 8 };
    expect(pathsOf(diffFields(legacy, candidate, { ignorePaths: [] }))).toEqual(["a", "b"]);
    expect(pathsOf(diffFields(legacy, candidate, { ignorePaths: ["nope", "c.d"] }))).toEqual(["a", "b"]);
    // and it can silence a missing key, not only a mismatched value
    expect(diffFields({ a: 1, legacyOnly: 2 }, { a: 1 }, { ignorePaths: ["legacyOnly"] })).toEqual([]);
  });
});
