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
import { describe, expect, it } from "vitest";
import { diffFields } from "@/tests/differential/diff-fields";
import type { DiffOptions, DifferenceCause, FieldDifference } from "@/tests/differential/diff-fields";

// Listing the union members here is itself a check: if the contract's cause
// vocabulary changes, this file stops compiling rather than drifting quietly.
const ALL_CAUSES: DifferenceCause[] = [
  "value-mismatch", "type-mismatch", "missing-in-candidate", "missing-in-legacy",
  "array-length", "rounding", "date-mismatch", "unsupported-type", "cycle",
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
  // One diff carrying seven distinct causes.
  const legacy = {
    typed: 1,
    valued: "alpha",
    rounded: 5.0,
    sized: [1, 2],
    dated: new Date("2026-08-14T00:00:00Z"),
    onlyLegacy: 42,
  };
  const candidate = {
    typed: "1",
    valued: "beta",
    rounded: 5.01,
    sized: [1],
    dated: new Date("2026-08-15T00:00:00Z"),
    onlyCandidate: 43,
  };
  const diffs = diffFields(legacy, candidate, { toleranceMinorUnits: 1 });

  it("classifies each difference with its own specific cause", () => {
    expect(at(diffs, "typed").cause).toBe("type-mismatch");
    expect(at(diffs, "valued").cause).toBe("value-mismatch");
    expect(at(diffs, "rounded").cause).toBe("rounding");
    expect(at(diffs, "sized").cause).toBe("array-length");
    expect(at(diffs, "dated").cause).toBe("date-mismatch");
    expect(at(diffs, "onlyLegacy").cause).toBe("missing-in-candidate");
    expect(at(diffs, "onlyCandidate").cause).toBe("missing-in-legacy");
  });

  it("gives every difference a non-empty detail, and never the same one twice", () => {
    expect(diffs).toHaveLength(7);
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
