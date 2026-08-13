// Field-by-field structural diff with a classified cause.
//
// This is half of the differential harness — the only oracle in this repository
// for whether a business rule is right. Its output is what a human reads when
// legacy and candidate disagree, so a misclassified difference, or a value
// silently called equal because the walker could not inspect it, is worse than
// no harness at all: it is a green gate that proves nothing.

/** Why two values differ. One cause per difference — never a generic "unequal". */
export type DifferenceCause =
  | "value-mismatch" | "type-mismatch" | "missing-in-candidate" | "missing-in-legacy"
  | "array-length" | "rounding" | "date-mismatch" | "unsupported-type" | "cycle";

/** One differing leaf. `path` is dot/bracket notation; `""` at a scalar root. */
export type FieldDifference = {
  path: string;
  legacy: unknown;
  candidate: unknown;
  cause: DifferenceCause;
  detail: string;
};

export type DiffOptions = {
  /** A COUNT of minor units (fils, piastres), not a fraction. Integer >= 0. */
  toleranceMinorUnits?: number;
  /** Minor units per major unit. Integer >= 1, default 100. */
  minorUnitScale?: number;
  /** Exact paths to skip, subtree and all. */
  ignorePaths?: string[];
};

type Kind =
  | "null" | "undefined" | "boolean" | "number" | "string" | "bigint" | "symbol"
  | "date" | "array" | "object" | "unsupported";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Anything outside this set cannot be walked field by field without guessing at
// its semantics, so it is reported (CLAUDE.md rule 8). The previous attempt ran
// Object.keys over everything, which made two different Maps, Sets, RegExps and
// Errors all compare equal — a difference detector answering "no difference".
function kindOf(value: unknown): Kind {
  if (value === null) return "null";
  const t = typeof value;
  if (t !== "object" && t !== "function") return t as Kind;
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  const proto: unknown = Object.getPrototypeOf(value as object);
  return proto === Object.prototype || proto === null ? "object" : "unsupported";
}

function typeName(value: unknown): string {
  const kind = kindOf(value);
  if (kind !== "unsupported") return kind;
  const proto = Object.getPrototypeOf(value as object) as { constructor?: { name?: string } } | null;
  return proto?.constructor?.name ?? "exotic object";
}

/** Compact, concrete rendering of a value for `detail`. Never throws. */
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (Array.isArray(value)) return `array of ${value.length}`;
  if (typeof value === "object" && value !== null) return typeName(value);
  return String(value);
}

// NaN equals NaN (two runs of the same broken calculation are not a difference
// to chase), and 0 equals -0, which `===` already gives us.
function sameNumber(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

const label = (path: string): string => (path === "" ? "(root)" : path);

function childPath(parent: string, key: string): string {
  if (!IDENTIFIER.test(key)) return `${parent}[${JSON.stringify(key)}]`;
  return parent === "" ? key : `${parent}.${key}`;
}

// A misread tolerance is a wrong verdict on money, so an invalid option is
// refused loudly rather than coerced into something plausible.
function requireInteger(value: number, name: string, min: number): number {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`diffFields: ${name} must be an integer >= ${min}, received ${String(value)}`);
  }
  return value;
}

/**
 * Diff `candidate` against `legacy`, returning every differing leaf.
 *
 * Ordering is deterministic — depth first, legacy key order, then keys only the
 * candidate has — so a failing differential case reads the same way twice.
 *
 * Tolerance is an integer count of minor units, and both numbers are scaled and
 * rounded to integers before the comparison, so the boundary is exact by
 * construction: at exactly `toleranceMinorUnits` the cause is `rounding`, at one
 * more it is `value-mismatch`, with no float in the decision. The previous
 * attempt compared `Math.abs(b - a) <= 0.01` and classified four identical
 * one-fils gaps two different ways depending on binary representation.
 *
 * Two deliberate consequences of that rule:
 *
 *  - A pair finer than the scale (1234.567 vs 1234.568 at scale 100) rounds to
 *    the same minor unit, so the gap is 0 and it is reported as `rounding` even
 *    at the default tolerance of 0. It is still reported — sub-minor-unit noise
 *    is named as such, never silently dropped.
 *  - The scale applies to every number in the tree, money or not. A count, a
 *    percentage or a numeric id differing by 1 is a gap of `minorUnitScale`
 *    minor units, so at the default tolerance it is still a `value-mismatch`;
 *    only a caller who raises tolerance above the scale can mask one, and such
 *    a caller wants `ignorePaths` instead.
 *
 * @throws RangeError on a non-integer or out-of-range tolerance or scale.
 */
export function diffFields(
  legacy: unknown,
  candidate: unknown,
  options: DiffOptions = {},
): FieldDifference[] {
  const tolerance = requireInteger(options.toleranceMinorUnits ?? 0, "toleranceMinorUnits", 0);
  const scale = requireInteger(options.minorUnitScale ?? 100, "minorUnitScale", 1);
  const ignored = new Set(options.ignorePaths ?? []);
  const out: FieldDifference[] = [];
  // Ancestors on the current path only, so a subtree repeated across siblings is
  // compared twice rather than mistaken for a cycle.
  const openLegacy = new Map<object, string>();
  const openCandidate = new Map<object, string>();

  const push = (path: string, l: unknown, c: unknown, cause: DifferenceCause, detail: string): void => {
    out.push({ path, legacy: l, candidate: c, cause, detail });
  };

  const compareNumbers = (path: string, a: number, b: number): void => {
    if (sameNumber(a, b)) return;
    const gap = Math.abs(Math.round(b * scale) - Math.round(a * scale));
    const gapText = Number.isFinite(gap)
      ? `a gap of ${gap} minor unit${gap === 1 ? "" : "s"} at scale ${scale}`
      : "a gap that is not representable in minor units";
    const within = gap <= tolerance;
    push(path, a, b, within ? "rounding" : "value-mismatch",
      `legacy ${describe(a)} vs candidate ${describe(b)}: ${gapText}, ` +
        `${within ? "within" : "over"} the tolerance of ${tolerance} minor units`);
  };

  const compareDates = (path: string, a: Date, b: Date): void => {
    const ta = a.getTime();
    const tb = b.getTime();
    if (sameNumber(ta, tb)) return;
    const gap = Math.abs(tb - ta);
    push(path, a, b, "date-mismatch",
      `legacy ${describe(a)} vs candidate ${describe(b)}: ` +
        (Number.isFinite(gap) ? `${gap} ms apart` : "one side is an Invalid Date"));
  };

  const compareArrays = (path: string, a: unknown[], b: unknown[]): void => {
    if (a.length !== b.length) {
      push(path, a, b, "array-length", `legacy has ${a.length} elements, candidate has ${b.length}`);
    }
    const overlap = Math.min(a.length, b.length);
    for (let i = 0; i < overlap; i += 1) walk(`${path}[${i}]`, a[i], b[i]);
  };

  const compareObjects = (path: string, a: Record<string, unknown>, b: Record<string, unknown>): void => {
    const has = (o: Record<string, unknown>, k: string): boolean =>
      Object.prototype.hasOwnProperty.call(o, k);
    // Own enumerable string keys, so `{ a: undefined }` vs `{}` is a missing key
    // rather than an equality. Symbol keys are not part of a legacy payload.
    for (const key of Object.keys(a)) {
      const p = childPath(path, key);
      if (has(b, key)) walk(p, a[key], b[key]);
      else if (!ignored.has(p)) {
        push(p, a[key], undefined, "missing-in-candidate",
          `key ${JSON.stringify(key)} is present in legacy (${describe(a[key])}) but absent from candidate`);
      }
    }
    for (const key of Object.keys(b)) {
      if (has(a, key)) continue;
      const p = childPath(path, key);
      if (ignored.has(p)) continue;
      push(p, undefined, b[key], "missing-in-legacy",
        `key ${JSON.stringify(key)} is absent from legacy but present in candidate (${describe(b[key])})`);
    }
  };

  function walk(path: string, a: unknown, b: unknown): void {
    if (ignored.has(path)) return;
    const ka = kindOf(a);
    const kb = kindOf(b);

    if (ka === "unsupported" || kb === "unsupported") {
      push(path, a, b, "unsupported-type",
        `cannot structurally compare ${typeName(a)} against ${typeName(b)}: ` +
          "diffFields understands plain objects, arrays, Date and primitives, so this " +
          "pair is reported rather than assumed equal");
      return;
    }
    if (ka !== kb) {
      push(path, a, b, "type-mismatch",
        `legacy is ${ka} (${describe(a)}), candidate is ${kb} (${describe(b)})`);
      return;
    }
    if (ka === "number") return compareNumbers(path, a as number, b as number);
    if (ka === "date") return compareDates(path, a as Date, b as Date);
    if (ka === "array" || ka === "object") {
      const oa = a as object;
      const ob = b as object;
      const priorLegacy = openLegacy.get(oa);
      const prior = priorLegacy ?? openCandidate.get(ob);
      if (prior !== undefined) {
        push(path, a, b, "cycle",
          `the ${priorLegacy !== undefined ? "legacy" : "candidate"} value at ` +
            `${label(path)} is the same object already open at ${label(prior)}; ` +
            "refusing to recurse into a cycle");
        return;
      }
      openLegacy.set(oa, path);
      openCandidate.set(ob, path);
      if (ka === "array") compareArrays(path, a as unknown[], b as unknown[]);
      else compareObjects(path, a as Record<string, unknown>, b as Record<string, unknown>);
      openLegacy.delete(oa);
      openCandidate.delete(ob);
      return;
    }
    // string, boolean, bigint, symbol, null, undefined — identity is the whole
    // comparison; null vs undefined never reaches here, it is a type-mismatch.
    if (a !== b) {
      push(path, a, b, "value-mismatch", `legacy ${describe(a)} vs candidate ${describe(b)}`);
    }
  }

  walk("", legacy, candidate);
  return out;
}
