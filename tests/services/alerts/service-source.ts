// Reads `lib/services/alerts/` as TEXT, for the two assertions of
// tasks/backlog.yaml#service-alerts-surface-and-lifecycle that are claims about
// the source itself rather than about a return value:
//
//   assertion 2 "A fingerprint is an opaque identity: the engine never splits
//                it on the separator"
//   assertion 7 "No file in the service names a jurisdiction, a deadline, a
//                document or a correlation rule"
//
// Neither is observable from behaviour at this node. The service has no store
// yet (the node's own note: "No persistence… no verbs with side effects"), so
// an engine that splits a fingerprint into `{tenant}:{app}:…` to group or route
// merges two identities with nothing returned to show for it, and an engine
// that hardcodes "deadline-monitor" answers every call exactly as one that does
// not. The failure is in the text, so the text is what is read.
//
// HOW IT READS. Through tests/kernel/kernel-source.ts — the TypeScript parser —
// exactly as tests/modules/deadlines/alert-vocabulary.test.ts does, and never a
// regular expression over raw source. The difference between the two files is
// SCOPE, and it is deliberate: there the rule was about three declarations on
// the deadline monitor's port, because OpsMind is entitled to know what a
// jurisdiction is (ADR-043, "What is deliberately NOT renamed"). Here the rule
// is about EVERY FILE IN THE SERVICE, which is a stronger and simpler claim —
// the Alert Manager is a package another codebase imports (ADR-039), and it has
// no OpsMind noun it is entitled to.
//
// No file under lib/services/alerts/ was read by the author of these tests.
// Every expected value comes from the node in tasks/backlog.yaml,
// docs/architecture/flows-alerting.md, the Alert Manager section of
// docs/architecture/data-model.md, ADR-020/039/040/043/044, and the AlertManager
// port in lib/modules/deadlines/index.ts.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

import {
  REPO_ROOT,
  blankNonCode,
  codeWithStrings,
  exportedDeclarations,
  exportedTypeBlocks,
  type Declaration,
  type SourceFile,
  type TypeBlock,
} from "@/tests/kernel/kernel-source";

/** The whole of the service. ADR-039: it is a package, and this is the package. */
export const SERVICE_DIR = path.join(REPO_ROOT, "lib", "services", "alerts");

/** Every TypeScript file under `lib/services/alerts/`, at any depth. */
function collect(dir: string, found: SourceFile[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    found.push({
      path: full,
      relative: path.relative(REPO_ROOT, full),
      module: "alerts",
      name: entry,
      source: readFileSync(full, "utf8"),
    });
  }
}

/**
 * The service's files, or a failure that says so.
 *
 * A source-reading assertion that finds nothing passes, and an empty directory
 * returns nothing — so the emptiness has to be the failure rather than the
 * cheapest route to green. The node produces `index.ts` and `lifecycle.ts`;
 * both are required here by name so that a sweep cannot pass because one of
 * them was never written.
 */
export function serviceFiles(): SourceFile[] {
  const found: SourceFile[] = [];
  collect(SERVICE_DIR, found);
  if (found.length === 0) {
    throw new Error(
      `${path.relative(REPO_ROOT, SERVICE_DIR)} holds no TypeScript file, so every sweep over ` +
        "it would be empty rather than clean. The node produces index.ts and lifecycle.ts.",
    );
  }
  for (const required of ["index.ts", "lifecycle.ts"]) {
    if (!found.some((file) => file.name === required)) {
      throw new Error(
        `lib/services/alerts/${required} does not exist. The node produces ` +
          "lib/services/alerts/{index,lifecycle}.ts; present: " +
          found.map((file) => file.name).join(", "),
      );
    }
  }
  return found;
}

/**
 * One file's CODE: comments blanked, string contents kept, every other
 * character and every newline exactly where it was.
 *
 * WHETHER A COMMENT COUNTS, DECIDED HERE AND ON PURPOSE. It does not. The rule
 * is about what the engine KNOWS, and a comment saying "ADR-043 renamed this
 * from jurisdictionId, because the engine must never spell an OpsMind noun" is
 * the rule being documented rather than broken — a case that failed on it would
 * make deleting the explanation the cheapest way to green, which is the same
 * incentive ADR-035 removed from the size budget. The neighbouring sweep in
 * tests/modules/deadlines/alert-vocabulary.test.ts made the same call for the
 * same reason.
 *
 * A STRING LITERAL DOES COUNT, and that is the other half of the decision. A
 * string is a VALUE the engine computes with — a policy id, a scope key, a map
 * key, a default source name. `"deadline-monitor"` in the service's code is one
 * caller's vocabulary compiled into a component built to serve several
 * (ADR-039), and it is invisible to a type-level check precisely because it is
 * data. So comments are out and strings are in.
 */
export const serviceCode = (file: SourceFile): string => codeWithStrings(file.source);

export interface Literal {
  /** The literal's contents, without the surrounding quotes. */
  text: string;
  line: number;
  file: string;
}

/**
 * The contents of every string, template and regular-expression literal.
 *
 * Derived rather than re-parsed: `codeWithStrings` blanks comments and keeps
 * literal contents, `blankNonCode` blanks both, and both preserve length and
 * newlines. Every position the first kept and the second blanked is therefore
 * literal text, decided by the compiler's grammar rather than by a scanner
 * guessing where a quote begins. Whitespace inside a literal blanks in both, so
 * `"a b"` arrives as two runs — irrelevant to every caller here, which asks
 * whether a separator or a noun appears anywhere in it.
 */
export function literals(file: SourceFile): Literal[] {
  const kept = codeWithStrings(file.source);
  const gone = blankNonCode(file.source);
  const found: Literal[] = [];
  let run = "";
  let line = 1;
  let startedOn = 1;
  for (let index = 0; index < kept.length; index += 1) {
    const isLiteral = kept[index] !== " " && kept[index] !== "\n" && gone[index] === " ";
    if (isLiteral) {
      if (run === "") startedOn = line;
      run += kept[index];
    } else if (run !== "") {
      found.push({ text: run, line: startedOn, file: file.relative });
      run = "";
    }
    if (kept[index] === "\n") line += 1;
  }
  if (run !== "") found.push({ text: run, line: startedOn, file: file.relative });
  return found;
}

/** Every exported declaration in the service, across every file. */
export function serviceDeclarations(): Declaration[] {
  return serviceFiles().flatMap(exportedDeclarations);
}

/** Every exported interface, type literal and class in the service. */
export function serviceTypeBlocks(): TypeBlock[] {
  return serviceFiles().flatMap(exportedTypeBlocks);
}

/**
 * The members of a union of string literals, as declared.
 *
 * `export type AlertState = "firing" | "acknowledged" | …` is the shape ADR-020
 * fixes; the values are read out of the declaration's own text so that a fifth
 * member is visible whatever the type is called. A union with no quoted members
 * — `type X = string` — is not one of these and returns undefined.
 */
export function stringUnion(declaration: Declaration): string[] | undefined {
  const body = declaration.signature.slice(declaration.signature.indexOf("=") + 1);
  if (!declaration.signature.includes("=")) return undefined;
  const quoted = body.match(/"[^"]*"/g);
  if (quoted === null) return undefined;
  // A union and nothing else: strip the members and what is left must be
  // separators. `Record<string, "a" | "b">` is not a state vocabulary.
  const rest = body.replace(/"[^"]*"/g, "").trim();
  if (!/^[|\s]*$/.test(rest)) return undefined;
  return quoted.map((member) => member.slice(1, -1));
}

/**
 * Words, as a reader of the code would say them.
 *
 * `jurisdictionId` is two words and must be found; `documented` is one word and
 * must not be, because it is not the noun. Splitting on camel humps and on
 * every non-letter is what tells those two apart — a substring test calls
 * `documented` a document, and a `\b`-anchored regular expression misses
 * `jurisdictionId` entirely, since `n` to `I` is not a word boundary.
 */
export function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}
