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
  | "array-length" | "rounding" | "sub-minor-unit" | "date-mismatch" | "unsupported-type"
  | "cycle";

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
  /**
   * Minor units per major unit. Integer >= 1, default 100. Any integer, not
   * only a power of ten: the scale is applied as an exact multiplication.
   */
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

// --- exact decimal arithmetic -------------------------------------------------
//
// Everything that decides a numeric classification runs through these. No
// float operation may appear between a pair of numbers and its cause: a float
// multiply by the scale is what made 0.135 and 0.145 — exactly one minor unit
// apart — compute as a gap of 0, and 0.145 and 0.155 compute as a gap of 2.

/** A finite value held exactly as `units / 10 ** decimals`. `decimals >= 0`. */
type Exact = { units: bigint; decimals: number };

const TEN = 10n;

const pow10 = (n: number): bigint => TEN ** BigInt(n);

/**
 * The shortest round-trip decimal of `x`, as an exact scaled integer.
 *
 * `String(x)` is the decimal the value prints as, and the one a reader of a
 * differential report means by "0.145". It is deliberately NOT the exact binary
 * value of the double: in binary 0.145 - 0.135 is 0.009999999999999981, so an
 * exact-binary comparison would call an exactly-one-minor-unit pair sub-minor.
 *
 * `String` switches to exponential notation outside roughly 1e-7 .. 1e21
 * ("1e+21", "1.5e-8", "5e-324"), so the exponent is parsed rather than assumed
 * absent — reading "1e-7" as the digits "1" would be wrong by seven orders of
 * magnitude and silently so.
 *
 * Caller must have established `Number.isFinite(x)`.
 */
function exactOf(x: number): Exact {
  const text = String(x);
  const eAt = text.search(/e/i);
  const significand = eAt === -1 ? text : text.slice(0, eAt);
  const exponent = eAt === -1 ? 0 : Number(text.slice(eAt + 1));
  const negative = significand.startsWith("-");
  const magnitude = negative || significand.startsWith("+") ? significand.slice(1) : significand;
  const dot = magnitude.indexOf(".");
  const whole = dot === -1 ? magnitude : magnitude.slice(0, dot);
  const fraction = dot === -1 ? "" : magnitude.slice(dot + 1);
  let units = BigInt(`${whole}${fraction}` || "0");
  // x = digits * 10 ** (exponent - fraction.length). A negative decimals is a
  // whole number with trailing zeros, folded into the units so that `decimals`
  // is always a real denominator and never has to be reasoned about as a shift
  // in the other direction.
  let decimals = fraction.length - exponent;
  if (decimals < 0) {
    units *= pow10(-decimals);
    decimals = 0;
  }
  // String(-0) is "0", so a negative zero arrives here as zero; it never
  // reaches this function anyway, since -0 === 0 is already agreement.
  return { units: negative ? -units : units, decimals };
}

/**
 * The true distance between `a` and `b`, in minor units, exactly.
 *
 * The scale is applied as an integer multiplication, not as a decimal-point
 * shift, so `minorUnitScale` may be any integer >= 1 as documented and not only
 * a power of ten: a scale of 3 gives thirds of a major unit, exactly, and a
 * scale of 1000 gives KWD fils, exactly. The denominator stays a power of ten,
 * which is what makes the result renderable as a finite decimal.
 *
 * The result keeps its fractional part rather than rounding to an integer count
 * of minor units. Two values can be less than one minor unit apart while
 * straddling a minor-unit boundary (1234.564 vs 1234.566 at scale 100), and
 * rounding each side first reports that pair as a whole unit apart when it is
 * two tenths of one.
 */
function minorUnitDistance(a: number, b: number, scale: number): Exact {
  const left = exactOf(a);
  const right = exactOf(b);
  const decimals = Math.max(left.decimals, right.decimals);
  const lift = (v: Exact): bigint => v.units * pow10(decimals - v.decimals);
  const difference = lift(right) - lift(left);
  const magnitude = difference < 0n ? -difference : difference;
  return { units: magnitude * BigInt(scale), decimals };
}

/** `value < limit` where `limit` is a non-negative integer. Exact. */
const isBelow = (value: Exact, limit: number): boolean =>
  value.units < BigInt(limit) * pow10(value.decimals);

/** `value <= limit` where `limit` is a non-negative integer. Exact. */
const isAtMost = (value: Exact, limit: number): boolean =>
  value.units <= BigInt(limit) * pow10(value.decimals);

/** An exact non-negative `Exact` as a decimal string: "1", "0.2", "0.1". */
function renderExact(value: Exact): string {
  const divisor = pow10(value.decimals);
  const whole = value.units / divisor;
  const remainder = value.units % divisor;
  if (remainder === 0n) return whole.toString();
  const fraction = remainder.toString().padStart(value.decimals, "0").replace(/0+$/, "");
  return `${whole}.${fraction}`;
}

/**
 * Diff `candidate` against `legacy`, returning every differing leaf.
 *
 * Ordering is deterministic — depth first, legacy key order, then keys only the
 * candidate has — so a failing differential case reads the same way twice.
 *
 * Tolerance is an integer count of minor units, and the two numbers are scaled
 * to minor units EXACTLY — decimal digits carried as BigInt, no float operation
 * anywhere in the decision — so the gap that is classified is the true distance
 * between them:
 *
 *  - unequal but strictly less than one minor unit apart: `sub-minor-unit`, at
 *    every tolerance, decided before the tolerance is read;
 *  - one minor unit or more, up to and including exactly `toleranceMinorUnits`:
 *    `rounding`;
 *  - beyond that: `value-mismatch`.
 *
 * The gap reported in `detail` is that true distance and may be fractional
 * (1234.567 vs 1234.568 at scale 100 is 0.1 minor units). Two earlier attempts
 * got this wrong in opposite directions: `Math.abs(b - a) <= 0.01` classified
 * four identical one-fils gaps two different ways depending on binary
 * representation, and `Math.round(x * scale)` collapsed 0.135 vs 0.145 — exactly
 * one minor unit apart — to a gap of 0 while inflating 0.145 vs 0.155 to a gap
 * of 2. Across x.xx5 pairs one minor unit apart, that proxy misreported 11.25%.
 *
 * The two limits previously recorded here are both gone, and are named so that
 * nobody reintroduces a workaround for them:
 *
 *  - There is no float multiply left to move the boundary. A value whose scaled
 *    form lands on a `.5` no longer rounds to a neighbouring minor unit,
 *    because nothing is rounded: the exact distance is compared against 1 and
 *    against the tolerance as integer ratios.
 *  - There is no `Number.MAX_SAFE_INTEGER / scale` ceiling. BigInt has no
 *    precision limit, so 100000000000000.03 vs 100000000000000.05 is 2 minor
 *    units at scale 100, not the 0 the previous code computed, and the largest
 *    and smallest doubles scale without loss.
 *
 * What remains, deliberately, is that the comparison is on each value's
 * shortest round-trip decimal — the string it prints as — and not on its exact
 * binary value. 0.145 as a double is a shade under 0.145, so an exact-binary
 * distance between 0.135 and 0.145 is 0.009999999999999981, which is less than
 * one minor unit and would report a pair that a human reads as exactly one fils
 * apart as `sub-minor-unit`. The printed decimal is what a differential report
 * is about, so that is what is compared.
 *
 * Above 2**53 that decision becomes visible, because there the shortest
 * round-trip decimal is no longer the value the double holds: the reported gap
 * is the distance between the printed numbers, not between the machine values.
 * 999999999999999900000 vs 1e21 at scale 100 reports 10,000,000 minor units,
 * while those two doubles are one ulp — 13,107,200 minor units — apart. Both
 * readings are defensible; the printed one is chosen because a human reads this
 * output as money, and it is also the reading that holds where the data lives. A
 * binary-exact implementation gives a different cause in 12% of money-shaped
 * comparisons (600,000 sampled, <= 1e9, <= 3 dp, scale 100), calling 47.18 vs
 * 47.19 — a plain one-fils difference — `sub-minor-unit`, i.e. finer than a
 * fils, which is flatly wrong on a payslip. Above 2**53 the two never disagree,
 * because there every double is an integer.
 *
 * Two deliberate consequences of the rule:
 *
 *  - Being finer than the scale is the whole of what `sub-minor-unit` keys on,
 *    whether or not the two values round to the same integer minor unit.
 *    1234.567 vs 1234.568 (0.1 minor units apart) and 1234.564 vs 1234.566 (0.2
 *    apart, straddling a minor-unit boundary) are the same size of difference
 *    and get the same cause. It is not `rounding`, at any tolerance including 0:
 *    KWD and BHD are three-decimal currencies, so at the default scale of 100 a
 *    genuine one-fils difference lands here, and a consumer that treats
 *    `rounding` as tolerated noise must not be able to drop it with the noise.
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
    // NaN and the infinities have no decimal expansion to scale, so they are
    // settled before any of it. Equality is already ruled out above, which
    // leaves only unequal pairs — Infinity against 1e308, NaN against a number,
    // Infinity against -Infinity — and every one of them keeps the
    // `value-mismatch` it has always had, at every tolerance. There is no
    // distance in minor units to report and none is invented.
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      push(path, a, b, "value-mismatch",
        `legacy ${describe(a)} vs candidate ${describe(b)}: a gap that is not representable in ` +
          `minor units, over the tolerance of ${tolerance} minor units`);
      return;
    }

    const distance = minorUnitDistance(a, b, scale);
    const gapText = renderExact(distance);
    // Strictly less than one minor unit, and unequal — the gap is finer than
    // the scale can express. Decided before the tolerance is consulted, so no
    // tolerance can produce this cause and no tolerance can suppress it. It
    // cannot be `rounding`: a consumer filtering `rounding` as tolerated noise
    // would drop a real one-fils KWD or BHD difference with it.
    //
    // This keys on the true distance, not on the two values rounding to the
    // same integer minor unit. Those come apart on a pair that straddles a
    // minor-unit boundary (1234.564 vs 1234.566 at scale 100 rounds to 123456
    // and 123457), which is two tenths of a minor unit and belongs here.
    if (isBelow(distance, 1)) {
      push(path, a, b, "sub-minor-unit",
        `legacy ${describe(a)} vs candidate ${describe(b)}: the two values are not equal, but at ` +
          `scale ${scale} they are ${gapText} minor units apart — less than the one minor unit ` +
          "that is the smallest difference this scale can express. This is not rounding within " +
          `tolerance: the cause does not depend on the tolerance of ${tolerance} minor units and ` +
          "no tolerance can suppress it. The cause exists because a real one-fils difference on a " +
          "three-decimal currency such as KWD or BHD, compared at a scale of 100, is a tenth of a " +
          "minor unit exactly like this, so it must be adjudicated rather than tolerated.");
      return;
    }
    const within = isAtMost(distance, tolerance);
    push(path, a, b, within ? "rounding" : "value-mismatch",
      `legacy ${describe(a)} vs candidate ${describe(b)}: a gap of ${gapText} minor ` +
        `unit${gapText === "1" ? "" : "s"} at scale ${scale}, ` +
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
