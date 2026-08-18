// Assertion 7 of tasks/backlog.yaml#service-alerts-surface-and-lifecycle:
//
//   "No file in the service names a jurisdiction, a deadline, a document or a
//    correlation rule"
//
// components-services.md:24 states the same as the Alert Manager's "does not
// know" column: "What a visa, a filing or a correlation rule is. It consumes
// severity; it never judges it." ADR-039 is why it matters — the reuse target
// is an importable package, a component another application adds to its own
// codebase — and ADR-043 is why the assertion is satisfiable at all: the port's
// scope field was renamed from `jurisdictionId` to `area` on 2026-08-18,
// because "TypeScript is structural, so reading a scope means spelling the
// field's name — the engine's own source would contain `jurisdictionId` in
// order to find a value it neither understands nor cares about."
//
// ---------------------------------------------------------------------------
// THE SCOPE OF THIS RULE, AND HOW IT DIFFERS FROM ITS NEIGHBOUR. Read this
// before changing either.
//
// tests/modules/deadlines/alert-vocabulary.test.ts applies a narrow version of
// the same rule to THREE DECLARATIONS — AlertManager, ReportedAlert, RunScope —
// and deliberately not to the module around them, because "OpsMind is entitled
// to know what a jurisdiction is" (ADR-043). Here the claim is stronger and
// simpler: EVERY FILE IN lib/services/alerts/. The Alert Manager is the
// component being lent, so it has no OpsMind noun it is entitled to anywhere.
//
// WHETHER A COMMENT COUNTS: it does not, and the reasoning is in
// ./service-source.ts. Briefly — the rule is about what the engine KNOWS, and a
// comment reading "ADR-043 renamed this from jurisdictionId" is the rule being
// documented rather than broken. Failing on it would make deleting the
// explanation the cheapest route to green. A STRING LITERAL does count: a
// string is a value the engine computes with, so `"deadline-monitor"` as a
// default source id is one caller's vocabulary compiled in, and it is invisible
// to any type-level check precisely because it is data.
// ---------------------------------------------------------------------------
//
// Read through tests/kernel/kernel-source.ts — the TypeScript parser — and
// never a regular expression over raw source, so "comments do not count" is the
// compiler's answer about where the comments are rather than a scanner's guess.
//
// Written from the specification alone: no file under lib/services/alerts/ was
// read by the author of these tests. The sweep below reads them at RUN TIME, in
// the test process.
import { describe, expect, it } from "vitest";

import { REPO_ROOT, type SourceFile } from "@/tests/kernel/kernel-source";

import { serviceCode, serviceFiles, words } from "./service-source";

/**
 * Words only OpsMind knows.
 *
 * The first four are the assertion's own. The rest are the same fault arriving
 * under a different word: the deadline monitor's domain (it is a SOURCE, and
 * detection engines own thresholds — ADR-020), the other modules' nouns, and
 * the two examples components-services.md:24 gives by name.
 *
 * Deliberately NOT here, and this is the load-bearing half of the list: `alert`,
 * `source`, `policy`, `severity`, `area`, `fingerprint`, `context`, `tenant`,
 * `entity`, `run`, `scope`, `suppress`, `acknowledge`, `stale`. Those are the
 * ALERT ENGINE's own vocabulary — the fingerprint is
 * `{tenant}:{app}:{source}:{entity}:{policy}` — so an engine naming an entity is
 * naming its own concept, not OpsMind's. `area` in particular is the word
 * ADR-043 chose so that this rule and the port could both hold.
 */
const OPSMIND_NOUNS = [
  "jurisdiction",
  "deadline",
  "document",
  "correlation",
  "emirate",
  "registration",
  "threshold",
  "calendar",
  "holiday",
  "visa",
  "filing",
  "invoice",
  "settlement",
  "payroll",
  "expense",
  "timesheet",
];

/**
 * Every OpsMind noun in a line of code, by word rather than by substring.
 *
 * `jurisdictionId` is two words and is found; `documented` is one word and is
 * not, because it is not the noun. A plural counts — `deadlines` is a deadline.
 *
 * ONE EXCEPTION, AND IT IS DELIBERATE: `correlationId`. ADR-024 puts correlation
 * ids in every service from day one as an observability concern, and the
 * assertion's word is a correlation RULE — the SOC product's detection logic,
 * which is exactly the kind of domain knowledge that must stay with the source.
 * A request id is not a rule, so `correlation` followed by `id` is passed over
 * and `correlation` anywhere else is reported.
 */
function nounsIn(line: string): string[] {
  const tokens = words(line);
  const found: string[] = [];
  tokens.forEach((token, index) => {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    const noun = OPSMIND_NOUNS.find((candidate) => candidate === token || candidate === singular);
    if (noun === undefined) return;
    if (noun === "correlation" && (tokens[index + 1] === "id" || tokens[index + 1] === "ids")) {
      return;
    }
    found.push(noun);
  });
  return found;
}

/** Every finding in a file, as `path:line → noun`. */
function findingsIn(file: SourceFile): string[] {
  return serviceCode(file)
    .split("\n")
    .flatMap((line, index) =>
      nounsIn(line).map((noun) => `${file.relative}:${index + 1} → ${noun} (${line.trim()})`),
    );
}

describe("no file in the Alert Manager names an OpsMind noun", () => {
  it("has files with code in them, so this sweep is clean rather than empty", () => {
    // A source-reading assertion that finds nothing passes, and so does one
    // over an empty directory. Both of the node's files are required by name in
    // serviceFiles(); this states the guard as a case, so an empty service is a
    // failure with a message rather than a green run.
    const files = serviceFiles();
    expect(files.length, "lib/services/alerts/ holds no TypeScript file").toBeGreaterThan(0);
    for (const file of files) {
      const lines = serviceCode(file)
        .split("\n")
        .filter((line) => line.trim() !== "");
      expect(lines.length, `${file.relative} carries no code at all`).toBeGreaterThan(0);
    }
  });

  it("names no jurisdiction, deadline, document or correlation rule, in any file", () => {
    // The assertion, applied to every file the service has. `jurisdictionId` is
    // the case ADR-043 found before it could happen; `"deadline-monitor"` as a
    // hardcoded default source id is the same fault as a string, and is caught
    // by the same sweep because a string literal is code.
    const findings = serviceFiles().flatMap(findingsIn);
    expect(
      findings,
      "ADR-039: this component is added to another application's codebase. Every one of these " +
        "is a word that application does not have, in a value the engine never interprets.",
    ).toEqual([]);
  });

  it("still reads a scope, under the neutral name ADR-043 chose", () => {
    // The positive half, and the case that fails if the rule is satisfied by
    // DELETING the scope rather than by naming it neutrally. An engine holding
    // no area at all would pass every sweep above while making resolution by
    // absence unsound — "an alert closes only within an area the run declared
    // checked" (ADR-040(1)) — which is the failure the rename existed to avoid,
    // reached by the other road.
    const withArea = serviceFiles().filter((file) =>
      serviceCode(file)
        .split("\n")
        .some((line) => words(line).includes("area") || words(line).includes("areas")),
    );
    expect(
      withArea.map((file) => file.relative),
      "no file in the service mentions an area. ADR-040 put `areas` on raiseAlert and ADR-043 " +
        "spelled reportRun's side the same way; an engine that never reads one cannot scope " +
        "resolution at all.",
    ).not.toEqual([]);
  });

  it("would notice: the same sweep flags the port as it stood before ADR-043", () => {
    // The detector's own case. Every assertion above says a search found
    // nothing, which is also what a broken search returns — so the rule is
    // pointed at the shape it was written to reject, and at the two shapes it
    // must NOT reject. The text is the pre-ADR-043 declaration, quoted from the
    // record rather than read from any file.
    const before: SourceFile = {
      path: "(pre-ADR-043)",
      relative: "(pre-ADR-043)",
      module: "alerts",
      name: "index.ts",
      source: [
        "// ADR-043 renamed this field from jurisdictionId; a deadline is not",
        "// the engine's concept, and neither is a document.",
        "export interface ReportedAlert {",
        "  fingerprint: string;",
        "  jurisdictionId: string;",
        "}",
        'const DEFAULT_SOURCE = "deadline-monitor";',
        "const documented = true;",
        "const correlationId = crypto.randomUUID();",
      ].join("\n"),
    };
    expect(findingsIn(before).map((finding) => finding.split(" (")[0])).toEqual([
      // The declaration, which is the fault ADR-043 was written about…
      "(pre-ADR-043):5 → jurisdiction",
      // …and the hardcoded source id, which is the same fault as data.
      "(pre-ADR-043):7 → deadline",
    ]);
    // Not flagged, and each for its own reason: the two-line comment quotes the
    // record that decided the rule (line 1-2), `documented` is not `document`
    // (line 8), and a correlation ID is ADR-024's observability, not the SOC
    // product's correlation rule (line 9).
  });

  it("reads the service from where the service is", () => {
    // Cheap, and it catches the sweep pointing at a directory that no longer
    // exists after a move — which would otherwise turn every case above green
    // by way of an exception nobody reads.
    for (const file of serviceFiles()) {
      expect(file.path.startsWith(REPO_ROOT)).toBe(true);
      expect(file.relative.startsWith("lib/services/alerts/")).toBe(true);
    }
  });
});
