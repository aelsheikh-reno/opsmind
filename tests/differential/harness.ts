// The differential runner — the other half of the harness PIPELINE.md calls the
// highest-value thing in this repository. It pushes one input through the legacy
// system and through this build and diffs the two outputs field by field, so a
// business rule is judged against something other than the agent that wrote it.
//
// Every failure mode of this file is silence. A runner that stops at the first
// throw hides every case behind it; one that reports a pass for zero cases, or
// compares the candidate against a stub standing in for a legacy module that
// would not load, prints green while proving nothing. That is strictly worse
// than having no oracle, because it looks finished.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffFields, type DiffOptions, type FieldDifference } from "./diff-fields";

/** One case's verdict. `matched` is false whenever anything at all differed. */
export type CaseResult = {
  name: string;
  matched: boolean;
  differences: FieldDifference[];
  /** Set when either side threw, or when the diff itself threw. */
  error?: string;
};

export type DifferentialReport = {
  total: number;
  matched: number;
  failed: number;
  results: CaseResult[];
};

export type DifferentialCase<I> = { name: string; input: I };

export type DifferentialSpec<I, O> = {
  legacy: (input: I) => O | Promise<O>;
  candidate: (input: I) => O | Promise<O>;
  cases: DifferentialCase<I>[];
  options?: DiffOptions;
};

type Outcome<T> = { ok: true; value: T } | { ok: false; thrown: string };

/** Renders a thrown value without ever throwing itself. */
function describeThrown(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch {
    // e.g. Object.create(null), which has no toString.
    return `a thrown ${typeof value} that cannot be converted to a string`;
  }
}

/** Runs one side, converting a sync throw and a rejection into the same shape. */
async function attempt<T>(run: () => T | Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, thrown: describeThrown(error) };
  }
}

async function runCase<I, O>(spec: DifferentialSpec<I, O>, name: string, input: I): Promise<CaseResult> {
  // Both sides run even when the first throws, so "both threw identically" is
  // distinguishable from "only the candidate threw" — the second is a
  // regression, the first is usually the legacy rule being reproduced faithfully.
  const legacy = await attempt(() => spec.legacy(input));
  const candidate = await attempt(() => spec.candidate(input));

  if (!legacy.ok || !candidate.ok) {
    const sides = [
      legacy.ok ? null : `legacy threw ${legacy.thrown}`,
      candidate.ok ? null : `candidate threw ${candidate.thrown}`,
    ].filter((side): side is string => side !== null);
    return { name, matched: false, differences: [], error: sides.join("; ") };
  }

  // diffFields throws on an invalid option and can exhaust the stack on
  // extremely deep nesting. A throw here is this case's failure, not the run's.
  let differences: FieldDifference[];
  try {
    differences = diffFields(legacy.value, candidate.value, spec.options);
  } catch (error) {
    return { name, matched: false, differences: [], error: `diff threw ${describeThrown(error)}` };
  }

  // `matched` is strict, and deliberately so. A `rounding` difference is still a
  // difference and still fails the case.
  //
  // DO NOT add an option to filter, collapse or downgrade any cause here.
  // diffFields reports the true distance in minor units, computed exactly, and
  // `minorUnitScale` defaults to 100 — but KWD and BHD are three-decimal
  // currencies, so a genuine one-fils gap (1234.567 vs 1234.568) arrives as a
  // gap of 0.1: below one minor unit, and so under its own `sub-minor-unit`
  // cause precisely so that it is never mistaken for tolerated rounding noise.
  // Treating any of these as "no difference" would silently lose real money in
  // two live jurisdictions. The gate exists to make a human approve a
  // divergence, not to forgive one. A fils on a payslip is a real fils.
  return { name, matched: differences.length === 0, differences };
}

/**
 * Runs every case through both sides and diffs the outputs.
 *
 * Every case runs. One case throwing — on either side, or inside the diff —
 * marks that case failed and the run continues, because the case that hides
 * behind an aborted run is the one nobody knew to look at.
 */
export async function runDifferential<I, O>(spec: DifferentialSpec<I, O>): Promise<DifferentialReport> {
  const results: CaseResult[] = [];
  // Sequential, not Promise.all: legacy code may hold module-level state, and a
  // differential result that depends on interleaving is not a result.
  for (const testCase of spec.cases) {
    results.push(await runCase(spec, testCase.name, testCase.input));
  }
  const matched = results.filter((result) => result.matched).length;
  return { total: results.length, matched, failed: results.length - matched, results };
}

// ---------------------------------------------------------------- the oracle --

const LEGACY_ROOT = path.resolve(fileURLToPath(new URL("../../reference/legacy", import.meta.url)));

/**
 * Loads a module from `reference/legacy/` — the oracle — by a path relative to
 * that directory, e.g. `"lib/prorata.ts"`.
 *
 * The specifier is built at runtime on purpose. tsconfig.json excludes
 * `reference`, so a statically resolvable import would pull legacy source back
 * into the program and typecheck someone else's code under `strict`, and
 * `tsc --noEmit` is a gate. It is also deliberately NOT marked `@vite-ignore`:
 * the import must go through Vite so that vite-node transforms the legacy
 * TypeScript and so that the `opsmind:legacy-self-alias` plugin in
 * vitest.config.ts resolves the legacy module's own `@/...` imports inside
 * reference/legacy/. Read and evaluate the source outside Vite instead and both
 * guarantees vanish without a symptom: the oracle would bind to the new build
 * and the differential would compare the candidate against itself.
 *
 * @throws Error naming the module and the reason if it cannot be loaded. It
 * never returns a stub or an empty namespace — a differential case run against
 * nothing is precisely the green-but-vacuous gate this harness exists to prevent.
 */
export async function loadLegacyModule(relativePath: string): Promise<Record<string, unknown>> {
  const target = path.resolve(LEGACY_ROOT, relativePath);
  const inside = path.relative(LEGACY_ROOT, target);
  // A `..` segment is refused outright rather than judged by where it lands, so
  // the rule is "this path names something under reference/legacy/" and not
  // "this path happens not to escape today".
  const traverses = relativePath.split(/[\\/]+/).includes("..");
  if (relativePath === "" || path.isAbsolute(relativePath) || traverses || inside === "" || inside.startsWith("..")) {
    throw new Error(
      `loadLegacyModule: ${JSON.stringify(relativePath)} is not a path inside reference/legacy/. ` +
        "Pass a relative path with no \"..\" segment, such as \"lib/prorata.ts\"; " +
        "the oracle is that tree and nothing else.",
    );
  }

  let loaded: unknown;
  try {
    loaded = await import(target);
  } catch (error) {
    throw new Error(
      `loadLegacyModule: reference/legacy/${inside} could not be loaded: ${describeThrown(error)}. ` +
        "reference/legacy/node_modules/ is deliberately not committed, so a legacy module that " +
        "imports a third-party package cannot load here; neither can one whose own imports have no " +
        "counterpart inside reference/legacy/. Nothing is substituted for it — comparing the " +
        "candidate against a stub would report agreement with code that never ran.",
      { cause: error },
    );
  }

  if (typeof loaded !== "object" || loaded === null || Object.keys(loaded).length === 0) {
    throw new Error(
      `loadLegacyModule: reference/legacy/${inside} loaded but exports nothing. ` +
        "An empty oracle agrees with every candidate, so it is refused rather than returned.",
    );
  }
  return loaded as Record<string, unknown>;
}

// ------------------------------------------------------------------ reporting --

/** Renders a value for a human, verbatim where it can, and never throws. */
function render(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }
  try {
    // JSON.stringify drops undefined and throws on a cycle or a bigint field.
    return JSON.stringify(value) ?? String(value);
  } catch (error) {
    return `[not serialisable: ${describeThrown(error)}]`;
  }
}

/**
 * A readable multi-line summary: every failing case with each differing path,
 * its cause and detail, and BOTH raw values.
 *
 * The values are printed verbatim rather than left to the cause and detail
 * alone. A sub-minor-unit gap on a three-decimal currency is classified
 * `sub-minor-unit` and its gap is reported in minor units at the scale in use —
 * 0.1 for 1234.567 against 1234.568 at scale 100 — so only the raw values tell
 * the reader how much money actually moved.
 */
export function formatReport(report: DifferentialReport): string {
  if (report.total === 0) {
    // Zero cases is not a pass. A golden-file runner whose glob matched nothing
    // would otherwise print a green line for having compared nothing at all.
    return "differential: NO CASES RAN — nothing was compared against the legacy oracle. " +
      "An empty run is not a match.";
  }

  const lines = [
    `differential: ${report.matched}/${report.total} cases matched, ${report.failed} failed`,
  ];
  for (const result of report.results) {
    if (result.matched) continue;
    lines.push(`  FAIL ${result.name}`);
    if (result.error !== undefined) lines.push(`    error: ${result.error}`);
    for (const difference of result.differences) {
      lines.push(`    ${difference.path === "" ? "(root)" : difference.path} [${difference.cause}] ${difference.detail}`);
      lines.push(`      legacy:    ${render(difference.legacy)}`);
      lines.push(`      candidate: ${render(difference.candidate)}`);
    }
  }
  if (report.failed === 0) lines.push("  every case matched the legacy oracle field for field");
  return lines.join("\n");
}
