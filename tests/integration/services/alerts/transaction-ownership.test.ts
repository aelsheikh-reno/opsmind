// tasks/backlog.yaml#service-alerts-atomic-event, ASSERTION 3:
//
//   "The ownership check still reports an undeclared table reached inside that
//    transaction"
//
// THAT transaction — the one this node adds — and not a transaction in general.
// gate-boundaries-blind-to-a-transaction taught scripts/check-boundaries.sh to
// read a transaction handle out of the source, and tests/scaffold/
// service-boundary-rules.test.ts proves it against fixtures and against a
// probe transaction APPENDED to each real repository. Neither drives the real
// repository's OWN transaction, and the node says why that matters: this is the
// first real one in the build, and the third assertion exists "so that fix is
// re-proved against the first real transaction in the repository rather than
// assumed".
//
// The difference is not academic. The handle is a callback parameter and its
// name is the author's choice; an appended probe brings its own spelling with
// it, so it cannot notice that the spelling the repository actually uses is one
// the reader cannot see. This file takes the handle FROM the file under test.
//
// HOW IT READS THE IMPLEMENTATION. As repository-ownership.test.ts does: the
// TEST PROCESS reads the source at run time and no expected value is copied out
// of it. Nothing is written outside a mkdtemp directory, so the working copy of
// lib/services/alerts is left exactly as found.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, blankNonCode, ownsDeclaration } from "@/tests/kernel/kernel-source";

const REPOSITORY = path.join("lib", "services", "alerts", "repository.ts");
const BOUNDARY_SCRIPT = path.join(REPO_ROOT, "scripts", "check-boundaries.sh");
const FINDING_PREFIX = "BOUNDARY: ";

/** A table name no declaration in this build contains, as a whole word or not. */
const PROBE_TABLE = "probeUndeclaredTable";

const source = (): string => fs.readFileSync(path.join(REPO_ROOT, REPOSITORY), "utf8");

interface Verdict {
  status: number | null;
  findings: string[];
  output: string;
}

/** The real gate, run against a tree of this file's own. */
function runBoundaryCheck(dir: string): Verdict {
  const run = spawnSync("bash", [BOUNDARY_SCRIPT], { cwd: dir, encoding: "utf8" });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  return {
    status: run.status,
    findings: output
      .split("\n")
      .filter((line) => line.startsWith(FINDING_PREFIX))
      .map((line) => line.slice(FINDING_PREFIX.length)),
    output,
  };
}

/**
 * The real source tree, copied so a case may modify one file in it.
 *
 * lib/, app/ and the schema are everything check-boundaries.sh reads, so a run
 * against this copy answers the question a run at the repository root answers.
 * The removal is in `finally`: a case that tidies up only when it passes leaves
 * its litter exactly when somebody is already debugging.
 */
async function inCopiedTree<T>(edit: (repository: string) => string, work: (dir: string) => T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opsmind-alerts-transaction-"));
  try {
    for (const entry of ["lib", "app"]) {
      const from = path.join(REPO_ROOT, entry);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, entry), { recursive: true });
    }
    fs.mkdirSync(path.join(dir, "prisma"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "prisma", "schema.prisma"), path.join(dir, "prisma", "schema.prisma"));

    const target = path.join(dir, REPOSITORY);
    fs.writeFileSync(target, edit(fs.readFileSync(target, "utf8")));
    return await work(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The handle the repository's own transaction callback names, and where its
 * body starts.
 *
 * Read from the file rather than assumed, for the reason lessons.md records:
 * "do not hardcode `tx` — the handle is a name the author chooses, so read it
 * from the source or a rename evades you". Comments and strings are blanked
 * first, so prose about transactions cannot be mistaken for one; offsets are
 * preserved by that blanking, so the index found here indexes the real source.
 */
function ownTransaction(text: string): { handle: string; bodyStartsAt: number } {
  const code = blankNonCode(text);
  const match = /\$transaction\(\s*async\s*\(?\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(code);
  if (match === null) {
    throw new Error(
      `${REPOSITORY} contains no db.$transaction with an async callback. ` +
        "tasks/backlog.yaml#service-alerts-atomic-event's first assertion is that an alert row " +
        "and the event recording its change are written in ONE TRANSACTION, and assertion 3 is " +
        "about the ownership check reading that transaction — so with no transaction in the file " +
        "there is nothing here to check and assertion 1 is unimplemented, not merely untested.",
    );
  }
  const bodyStartsAt = code.indexOf("{", match.index + match[0].length);
  if (bodyStartsAt === -1) throw new Error(`the transaction callback in ${REPOSITORY} has no block body to inject into`);
  return { handle: match[1], bodyStartsAt: bodyStartsAt + 1 };
}

describe("the repository writes through a transaction of its own", () => {
  it("carries one, with a handle its callback names", () => {
    // Assertion 1's static half, and the non-vacuity guard for the cases below:
    // an injection into a transaction that does not exist proves nothing about
    // whether the gate can see into one.
    const { handle } = ownTransaction(source());
    expect(handle.length, "the transaction callback takes no named handle").toBeGreaterThan(0);
  });

  it("declares the tables it reaches through that handle", () => {
    // The positive side of the ownership claim, stated over the transaction
    // body specifically. Whole-token comparison, case-insensitively: lessons.md
    // records a substring match letting a repository declaring `AlertEvent`
    // touch `Alert`, and every table in this schema is a prefix pair.
    const text = source();
    const { handle } = ownTransaction(text);
    const declared = ownsDeclaration(text).tables.map((table) => table.toLowerCase());
    const reached = [...blankNonCode(text).matchAll(new RegExp(`\\b${handle}\\.([a-zA-Z]+)\\.`, "g"))].map(
      (match) => match[1],
    );

    expect(new Set(reached).size, `nothing is reached through '${handle}', so the transaction writes nothing`)
      .toBeGreaterThan(0);
    expect(
      [...new Set(reached)].filter((table) => !declared.includes(table.toLowerCase())),
      `reached through '${handle}' inside db.$transaction but absent from '// owns:' (${declared.join(", ")})`,
    ).toEqual([]);
  });
});

describe("check-boundaries.sh reads the transaction this repository actually has", () => {
  it("reports an undeclared table reached inside it, by name", async () => {
    // ASSERTION 3. The probe goes into the repository's OWN transaction, through
    // the repository's OWN handle — so a reader that recognises some spellings
    // of a handle and not the one in front of it fails here, which is the only
    // place that difference is visible.
    const verdict = await inCopiedTree((text) => {
      const { handle, bodyStartsAt } = ownTransaction(text);
      return `${text.slice(0, bodyStartsAt)}\n      await ${handle}.${PROBE_TABLE}.create({ data: {} });${text.slice(bodyStartsAt)}`;
    }, runBoundaryCheck);

    expect(
      verdict.findings.filter((finding) => finding.includes(PROBE_TABLE)),
      "check-boundaries.sh does not report a table written inside the transaction " +
        `${REPOSITORY} already has, through the handle that file already uses. eslint exempts a ` +
        "repository.ts from the import rule entirely, so this check is the whole of CLAUDE.md " +
        `rule 1 for that file. Full output:\n${verdict.output}`,
    ).not.toHaveLength(0);
    expect(verdict.status, "an undeclared table reached inside the transaction must fail the check").not.toBe(0);
  });

  it("leaves the repository as it stands alone, so the report above is about the probe", async () => {
    // The control. Without it a red from the case above could equally mean the
    // repository is already reporting findings for some other reason, and the
    // injection would have proved nothing.
    const verdict = await inCopiedTree((text) => text, runBoundaryCheck);

    expect(verdict.findings, `check-boundaries.sh reports findings against this build:\n${verdict.output}`).toEqual([]);
    expect(verdict.status, `check-boundaries.sh did not exit clean:\n${verdict.output}`).toBe(0);
  });
});
