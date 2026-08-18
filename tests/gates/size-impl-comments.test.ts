// Assertions for the `gate-size-impl-exclude-comments` backlog task:
//
//   1. "A comment-only line does not count toward size-impl, in .ts, .tsx, .mjs,
//       .cjs, .js or .sh"
//   2. "A blank line does not count toward size-impl"
//   3. "A line carrying code and a trailing comment counts as code, in full"
//   4. "// inside a string literal, a template literal or a JSX expression counts
//       as CODE, never as a comment"
//   5. "The classification comes from the TypeScript compiler API through the
//       kernel-source reader, never a regex — .mjs, .cjs and .js through the same
//       reader under ts.ScriptKind.JS"
//   6. "In shell a # inside a single- or double-quoted string, inside a heredoc,
//       on the shebang line, or not at a word boundary counts as CODE; a shell
//       file the reader cannot follow is refused, never counted"
//   7. "tasks/backlog.yaml contributes nothing to size-impl and every line to
//       size-total"
//   8. "size-impl stays 400 and never-waivable; size-total counts every line as
//       before"
//   9. "A 450-line diff with no comments is still refused"
//
// HOW THESE ARE DRIVEN. `scripts/size-impl.mjs` and `scripts/gate.sh` are run for
// real against fixture repositories in temp directories, exactly as
// tests/gates/stale-input.test.ts drives the gate and tests/gates/
// coverage-gate.test.ts drives the coverage script. A number nobody has watched
// a real script produce is not a verified number.
//
// POLARITY. Every rule is pinned in both directions: a comment is discounted AND
// code is not; a 450-line diff of which 100 are comments passes AND the same 450
// lines without comments is refused; size-impl discounts AND size-total does not.
// A one-sided suite is satisfied by a gate that counts nothing.
//
// WHY THE GATE FIXTURES CARRY node_modules AND THE READER. The classification is
// the TypeScript compiler's, reached through tests/kernel/kernel-source.ts, so a
// gate run needs both to be resolvable — that is the state a real checkout is in
// and the state the measurement requires. The fixtures below therefore symlink
// the repository's node_modules and copy the reader in, rather than the script
// being softened for an environment missing its toolchain. The refusals at the
// bottom of this file pin what happens when they are absent.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// A TIMEOUT IS FOR A HANG, NOT FOR CONTENTION (ADR-033). Every case here spawns
// real processes — git, node, and for the end-to-end cases the whole of
// gate.sh. Measured on a 14-core machine inside this file: a script-only case
// costs 0.14–2.4 s and a gate.sh case 1.5–4.1 s on an idle machine, the slowest
// being the one that runs the gate twice. Vitest's default 5 s bound is under
// 1.3x that figure, which is a false red waiting for a busy machine; 120 s is
// ~30x it. Set per file rather than in vitest.config.ts, so no other suite's
// bound moves.
vi.setConfig({ testTimeout: 120_000 });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIZE_IMPL = path.join(repoRoot, "scripts", "size-impl.mjs");
const GATE = path.join(repoRoot, "scripts", "gate.sh");
const READER_RELATIVE = path.join("tests", "kernel", "kernel-source.ts");

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const GIT_ENV = {
  GIT_AUTHOR_NAME: "gate",
  GIT_AUTHOR_EMAIL: "gate@opsmind.test",
  GIT_COMMITTER_NAME: "gate",
  GIT_COMMITTER_EMAIL: "gate@opsmind.test",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...GIT_ENV },
  });
}

function write(dir: string, relative: string, content: string): void {
  const target = path.join(dir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

// The size-impl pathspecs gate.sh passes: the exclusions ADR-026 and ADR-028
// already granted, which this task leaves exactly as they were.
const IMPL_PATHS = [
  ":(top)",
  ":(top,exclude)*package-lock.json",
  ":(top,exclude)docs/",
  ":(top,exclude)*.md",
  ":(top,exclude)prisma/migrations/**/*.sql",
  ":(top,exclude)tests/",
  ":(top,exclude)scripts/test-guards.sh",
  ":(top,exclude)tasks/backlog.yaml",
];

/**
 * A repository with a `main` commit and a `task/demo` commit adding `files`.
 * `prepare` runs before the base commit, so anything a harness needs is part of
 * `main` and never of the diff under measurement — a fixture that committed its
 * own scaffolding onto the branch would be measuring the scaffolding.
 */
function fixture(
  files: Record<string, string>,
  backlog?: string,
  prepare?: (dir: string) => void,
): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opsmind-size-impl-"));
  temps.push(dir);
  git(dir, ["init", "-q"]);
  git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  write(dir, ".gitignore", "node_modules\ncoverage/\n.task-current.yaml\n");
  write(dir, "lib/seed.ts", "export const seed = 1;\n");
  write(dir, "tasks/backlog.yaml", backlog ?? "- id: demo\n  risk: low\n  status: todo\n");
  if (prepare !== undefined) prepare(dir);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "base"]);

  git(dir, ["checkout", "-q", "-b", "task/demo"]);
  for (const [file, content] of Object.entries(files)) write(dir, file, content);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "task"]);
  return dir;
}

interface Run {
  code: number;
  out: string;
}

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}): Run {
  const { GITHUB_HEAD_REF: _ignored, ...cleanEnv } = process.env;
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...cleanEnv, ...GIT_ENV, ...env },
  });
  if (result.error !== undefined) throw result.error;
  return { code: result.status ?? -1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** `scripts/size-impl.mjs` over a fixture's diff, returning the integer it printed. */
function measure(dir: string, paths: string[] = IMPL_PATHS): number {
  const result = run("node", [SIZE_IMPL, "--base", "main", "--", ...paths], dir);
  expect(result.code, result.out).toBe(0);
  const printed = Number(result.out.trim());
  expect(Number.isInteger(printed), `not an integer: ${result.out}`).toBe(true);
  return printed;
}

/** What `git diff --numstat` alone would have said: the measurement before this task. */
function rawAdded(dir: string, paths: string[] = IMPL_PATHS): number {
  const numstat = git(dir, ["diff", "--numstat", "main...HEAD", "--", ...paths]);
  return numstat
    .split("\n")
    .filter((line) => line.trim() !== "")
    .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0);
}

/** The kind the script gave each line of one file, under the reading its extension implies. */
function classify(source: string, extension = ".ts"): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), "opsmind-classify-"));
  temps.push(dir);
  const file = path.join(dir, `sample${extension}`);
  writeFileSync(file, source);
  const result = run("node", [SIZE_IMPL, "--classify", file], repoRoot);
  expect(result.code, result.out).toBe(0);
  return result.out.replace(/\n$/, "").split("\n").map((line) => line.split("\t")[1]);
}

const codeLines = (count: number, from = 0): string =>
  Array.from({ length: count }, (_, index) => `export const v${from + index} = ${from + index};`)
    .map((line) => `${line}\n`)
    .join("");

const commentLines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `// explanation line ${index}\n`).join("");

/** `count` lines of shell that carry code and nothing else. */
const codeShell = (count: number): string =>
  Array.from({ length: count }, (_, index) => `echo ${index}\n`).join("");

/**
 * A backlog of exactly `count` lines, carrying the `demo` node the fixture's
 * branch is named after. Used with a base backlog that shares none of its lines,
 * so `git diff` reports every one of them as added and the expected totals are
 * the file's own length.
 */
const backlogOf = (count: number): string => {
  const head = ["- id: demo", "  risk: low", "  status: todo", "  note: >"];
  const rest = Array.from({ length: count - head.length }, (_, i) => `    reasoning line ${i}`);
  return `${[...head, ...rest].join("\n")}\n`;
};

/** A file in a temp directory of its own, for the `--classify` cases. */
function written(name: string, content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opsmind-written-"));
  temps.push(dir);
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

// ---------------------------------------------------------------------------//
// Assertions 1, 2 and 9 — the headline case, at the gate's own scale
// ---------------------------------------------------------------------------//

describe("assertions 1, 2 and 9 · a 450-line diff, with and without comments", () => {
  it("counts 350 of a 450-line diff whose other 100 lines are comments", () => {
    const dir = fixture({ "lib/modules/deadlines/sweep.ts": commentLines(100) + codeLines(350) });
    expect(rawAdded(dir), "the fixture is not 450 added lines").toBe(450);
    expect(measure(dir)).toBe(350);
  });

  it("still counts 450 when none of the 450 lines is a comment", () => {
    const dir = fixture({ "lib/modules/deadlines/sweep.ts": codeLines(450) });
    expect(rawAdded(dir)).toBe(450);
    expect(measure(dir), "a diff of pure code was discounted").toBe(450);
  });

  it("does not count blank lines", () => {
    const withBlanks = `${codeLines(20)}\n\n\n${codeLines(20, 20)}\n\n`;
    const dir = fixture({ "lib/a.ts": withBlanks });
    expect(rawAdded(dir)).toBe(45);
    expect(measure(dir)).toBe(40);
  });

  it("discounts comments interleaved with code, not only a block at the top", () => {
    const mixed = Array.from(
      { length: 40 },
      (_, index) => `// why v${index} is what it is\nexport const v${index} = ${index};\n`,
    ).join("");
    const dir = fixture({ "lib/a.ts": mixed });
    expect(rawAdded(dir)).toBe(80);
    expect(measure(dir)).toBe(40);
  });

  it("discounts a block comment across every line it spans", () => {
    const source = `/**\n * four lines\n * of jsdoc\n */\nexport const one = 1;\n`;
    const dir = fixture({ "lib/a.ts": source });
    expect(rawAdded(dir)).toBe(5);
    expect(measure(dir)).toBe(1);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 3 — a trailing comment buys no discount
// ---------------------------------------------------------------------------//

describe("assertion 3 · a line carrying code and a comment counts in full", () => {
  it("counts a code line with a trailing comment exactly as one line", () => {
    const trailing = Array.from(
      { length: 30 },
      (_, index) => `export const v${index} = ${index}; // ${index} is the statutory day\n`,
    ).join("");
    const dir = fixture({ "lib/a.ts": trailing });
    expect(rawAdded(dir)).toBe(30);
    expect(measure(dir), "a trailing comment discounted the code it sits beside").toBe(30);
  });

  it("counts a line whose comment opens before the code, too", () => {
    expect(classify("/* fx */ export const rate = 3;\n")[0]).toBe("code");
    expect(classify("export const x = 1; /* spans\n   two lines */ export const y = 2;\n")).toEqual([
      "code",
      "code",
      "blank",
    ]);
  });

  it("gives no partial credit — 40 annotated lines cost 40, not 20", () => {
    const dir = fixture({
      "lib/a.ts": Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i}; // note\n`).join(
        "",
      ),
    });
    expect(measure(dir)).toBe(40);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 4 — `//` that the compiler does not treat as a comment is code
//
// The reason the classification is the parser's rather than a pattern's. Each of
// these lines starts (or contains) `//` and each is executable text.
// ---------------------------------------------------------------------------//

describe("assertion 4 · a // the compiler does not read as a comment is code", () => {
  it("counts // inside a string literal as code", () => {
    expect(classify('export const url = "https://opsmind.test//path";\n')[0]).toBe("code");
    expect(classify('export const s = "// not a comment";\n')[0]).toBe("code");
  });

  it("counts // inside a template literal as code, including on its own line", () => {
    const template = "export const sql = `\n// this line is inside a template literal\n`;\n";
    expect(classify(template)).toEqual(["code", "code", "code", "blank"]);
  });

  it("counts // inside a JSX expression as code", () => {
    const jsx = [
      "export function Row({ note }: { note: string }) {",
      '  return <div title="// in an attribute">{note || "// in an expression"}</div>;',
      "}",
      "",
    ].join("\n");
    expect(classify(jsx, ".tsx")).toEqual(["code", "code", "code", "blank"]);
  });

  it("still reads a real comment as a comment in each of those files", () => {
    // The polarity half: a rule that called everything code would pass every
    // check above and discount nothing anywhere.
    expect(classify('// a real comment\nexport const s = "//";\n')).toEqual([
      "comment",
      "code",
      "blank",
    ]);
    expect(classify("// a real comment\nexport const x = <div />;\n", ".tsx")[0]).toBe("comment");
  });

  it("counts the braces around a JSX comment, because they are code", () => {
    // `{/* … */}` is a comment inside an expression container. The comment is
    // discounted; the container the parser needs is not, so the line is charged.
    expect(classify("export const el = <div>{/* why */}</div>;\n", ".tsx")[0]).toBe("code");
  });

  it("charges a .tsx file's code to the budget and discounts only its comments", () => {
    const component = [
      "// the note row",
      "export function Row({ note }: { note: string }) {",
      "  // the caller guarantees a note",
      '  return <div title="// literal">{note ?? "// fallback"}</div>;',
      "}",
      "",
    ].join("\n");
    const dir = fixture({ "app/row.tsx": component });
    expect(rawAdded(dir)).toBe(5);
    expect(measure(dir), "a .tsx file was misread — JSX is not a type assertion").toBe(3);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 5 — the compiler API, through the reader, never a regex
// ---------------------------------------------------------------------------//

describe("assertion 5 · one implementation, and it is the compiler's", () => {
  const script = readFileSync(SIZE_IMPL, "utf8");
  const reader = readFileSync(path.join(repoRoot, READER_RELATIVE), "utf8");

  it("classifies through the kernel-source reader rather than its own parser", () => {
    expect(script, "the script does not reach kernel-source.ts").toContain("kernel-source.ts");
    expect(script, "the script does not call the reader's classifier").toContain("classifyLines");
    // A call, not the name: the header explains what the reader does with
    // `ts.createSourceFile`, and naming it is not doing it.
    expect(script, "the script parses a second time, in its own way").not.toContain(
      "createSourceFile(",
    );
  });

  it("the reader classifies from comment trivia the parser reported", () => {
    expect(reader).toContain("getLeadingCommentRanges");
    expect(reader).toContain("getTrailingCommentRanges");
    expect(reader).toContain("export function classifyLines");
  });

  it("parses a .tsx file as TSX and a .ts file as TS", () => {
    // The same bytes, two kinds. Under the TS kind `<div>` opens a type
    // assertion, JSX text is not JSX text, and `// rendered` inside the element
    // is read as trivia — the misparse the kind exists to avoid.
    const element = ["export const el = (", "  <div>", "    // rendered text", "  </div>", ");", ""];
    expect(classify(element.join("\n"), ".tsx")[2]).toBe("code");
    expect(reader, "the reader no longer distinguishes the two script kinds").toContain(
      "ScriptKind.TSX",
    );
  });

  it("is not fooled by a file that only looks like comments", () => {
    // Every line here contains `//` and not one of them is a comment.
    const sneaky = [
      'export const a = "//";',
      "export const b = `//`;",
      'export const c = ["//", "//"];',
      "",
    ].join("\n");
    expect(classify(sneaky)).toEqual(["code", "code", "code", "blank"]);
  });
});

// ---------------------------------------------------------------------------//
// Every source language — .mjs, .cjs and .js through the same reader
//
// Ahmed's ruling of 2026-08-17: the discount applies to every language this
// repository writes, not to TypeScript alone. JavaScript is read by the
// TypeScript compiler under ts.ScriptKind.JS — the same reader, one
// implementation — so the polarity that matters is the same one: a real comment
// is discounted, and a `//` the parser does not read as a comment is not.
// ---------------------------------------------------------------------------//

describe("JavaScript · .mjs, .cjs and .js get the same reading as .ts", () => {
  for (const extension of [".mjs", ".cjs", ".js"]) {
    it(`discounts a comment-only line and a blank line in a ${extension} file`, () => {
      expect(classify("// why\n\nexport const x = 1;\n", extension)).toEqual([
        "comment",
        "blank",
        "code",
        "blank",
      ]);
    });
  }

  it("counts a // inside a JavaScript string or template literal as code", () => {
    expect(classify('const url = "https://x.test//path";\n', ".mjs")[0]).toBe("code");
    expect(classify('const s = "// not a comment";\n', ".js")[0]).toBe("code");
    expect(classify("const t = `\n// inside a template literal\n`;\n", ".mjs")).toEqual([
      "code",
      "code",
      "code",
      "blank",
    ]);
  });

  it("counts a line carrying code and a trailing comment in full", () => {
    expect(classify("const days = 28; // the statutory day\n", ".mjs")[0]).toBe("code");
  });

  it("reads a #! line as code — it is a directive, not an annotation", () => {
    expect(classify("#!/usr/bin/env node\n// why\nconst x = 1;\n", ".mjs")).toEqual([
      "code",
      "comment",
      "code",
      "blank",
    ]);
  });

  it("charges a .mjs file's code and discounts its comments, end to end", () => {
    const dir = fixture({ "scripts/thing.mjs": commentLines(60) + codeLines(40) });
    expect(rawAdded(dir), "the fixture is not 100 added lines").toBe(100);
    expect(measure(dir), "a .mjs file was counted line for line").toBe(40);
  });

  it("still charges a .mjs file that is all code", () => {
    const dir = fixture({ "eslint.config.mjs": codeLines(100) });
    expect(measure(dir), "JavaScript was discounted for being JavaScript").toBe(100);
  });
});

// ---------------------------------------------------------------------------//
// Shell — the language with no compiler to ask
//
// The four cases Ahmed named, each of which a `^\s*#` scanner gets wrong:
// a `#` in a single-quoted string, a `#` in a heredoc, the shebang, and a
// trailing `#`. Every one of them is CODE. The polarity half is the line above
// or below it in the same fixture: a real shell comment is still discounted.
// ---------------------------------------------------------------------------//

describe("shell · a # that is not a comment is code", () => {
  it("counts # inside a single-quoted string as code", () => {
    const source = ["#!/usr/bin/env bash", "# a real comment", "grep '#define' \"$1\"", ""];
    expect(classify(source.join("\n"), ".sh")).toEqual(["code", "comment", "code", "blank"]);
  });

  it("counts # inside a double-quoted string as code, and keeps quotes across lines", () => {
    expect(classify('echo "a # b"\n', ".sh")[0]).toBe("code");
    // A shell string may span newlines, so the second line is inside the quote
    // and its leading # is a character of the string.
    expect(classify("echo 'one\n# two'\n", ".sh")).toEqual(["code", "code", "blank"]);
  });

  it("counts # inside a heredoc as code, quoted delimiter or not", () => {
    const source = [
      "cat <<'EOF'",
      "# this is payload, not an annotation",
      "EOF",
      "cat <<EOF",
      "# so is this",
      "EOF",
      "# but this is a comment",
      "",
    ];
    expect(classify(source.join("\n"), ".sh")).toEqual([
      "code",
      "code",
      "code",
      "code",
      "code",
      "code",
      "comment",
      "blank",
    ]);
  });

  it("follows a <<- heredoc, whose terminator may be indented with tabs", () => {
    const source = ["cat <<-EOF", "\t# payload", "\tEOF", "# comment", ""];
    expect(classify(source.join("\n"), ".sh")).toEqual([
      "code",
      "code",
      "code",
      "comment",
      "blank",
    ]);
  });

  it("queues two heredocs opened by one line", () => {
    const source = ["cat <<A <<B", "# payload of A", "A", "# payload of B", "B", "# comment", ""];
    expect(classify(source.join("\n"), ".sh")).toEqual([
      "code",
      "code",
      "code",
      "code",
      "code",
      "comment",
      "blank",
    ]);
  });

  it("does not read <<< as a heredoc", () => {
    const source = ["grep x <<<\"$y\"", "# comment", "echo done", ""];
    expect(classify(source.join("\n"), ".sh")).toEqual(["code", "comment", "code", "blank"]);
  });

  it("counts the shebang as code", () => {
    expect(classify("#!/usr/bin/env bash\n# why\nset -eu\n", ".sh")).toEqual([
      "code",
      "comment",
      "code",
      "blank",
    ]);
    // Only on line 1. The same characters lower down are a comment.
    expect(classify("set -eu\n#!/usr/bin/env bash\n", ".sh")[1]).toBe("comment");
  });

  it("counts a trailing # in full, and gives no partial credit", () => {
    expect(classify("set -eu  # fail fast\n", ".sh")[0]).toBe("code");
    const dir = fixture({
      "scripts/thing.sh": Array.from({ length: 40 }, (_, i) => `echo ${i}  # note\n`).join(""),
    });
    expect(measure(dir), "a trailing comment discounted the code it sits beside").toBe(40);
  });

  it("counts a # that is not at a word boundary as code", () => {
    const source = ["echo ${x#prefix}", "echo foo#bar", 'echo "${#list[@]}"', "echo a\\#b", ""];
    expect(classify(source.join("\n"), ".sh")).toEqual(["code", "code", "code", "code", "blank"]);
  });

  it("discounts a real shell comment and a blank line, end to end", () => {
    const script = `#!/usr/bin/env bash\n${Array.from({ length: 60 }, (_, i) => `# explanation ${i}\n`).join("")}\n${codeShell(39)}`;
    const dir = fixture({ "scripts/thing.sh": script });
    expect(rawAdded(dir), "the fixture is not 101 added lines").toBe(101);
    expect(measure(dir), "shell comments were charged to the code budget").toBe(40);
  });

  it("refuses a file it has lost the thread of rather than counting it", () => {
    const unterminated = run("node", [SIZE_IMPL, "--classify", written("x.sh", "echo 'open\n")], repoRoot);
    expect(unterminated.code, unterminated.out).not.toBe(0);
    expect(unterminated.out).toMatch(/never closed/);

    const heredoc = run("node", [SIZE_IMPL, "--classify", written("y.sh", "cat <<EOF\nbody\n")], repoRoot);
    expect(heredoc.code, heredoc.out).not.toBe(0);
    expect(heredoc.out).toMatch(/never terminated/);
  });

  it("needs no compiler for a diff of nothing but shell", () => {
    // Shell is classified without the TypeScript package, so a shell-only diff
    // must not acquire it. The orphan fixture has no node_modules at all.
    const dir = fixture({ "scripts/thing.sh": "#!/bin/sh\n# why\necho one\n" });
    execFileSync("cp", ["-r", path.join(repoRoot, "scripts"), path.join(dir, "scripts-copy")]);
    const result = run(
      "node",
      [path.join(dir, "scripts-copy", "size-impl.mjs"), "--base", "main", "--", ":(top)"],
      dir,
    );
    expect(result.code, result.out).toBe(0);
    expect(Number(result.out.trim())).toBe(2);
  });
});

// ---------------------------------------------------------------------------//
// tasks/backlog.yaml is task metadata, not authored source
// ---------------------------------------------------------------------------//

describe("the backlog is out of size-impl and still inside size-total", () => {
  // The base carries a backlog that shares no line with the one the branch
  // commits, so every line of the node is an ADDED line and the totals below are
  // the file's own length rather than whatever git chose to call common.
  const PLACEHOLDER = "# the task graph starts empty for this fixture\n";

  it("contributes nothing to size-impl", () => {
    const dir = fixture(
      { "tasks/backlog.yaml": backlogOf(300), "lib/a.ts": codeLines(10) },
      PLACEHOLDER,
    );
    expect(rawAdded(dir, [":(top)"]), "the fixture is not 310 added lines").toBe(310);
    expect(measure(dir), "a backlog node was charged to the code budget").toBe(10);
  });

  it("is still counted, in full, by size-total", () => {
    // 2700 against the 2600 backstop (ADR-042). The magnitude tracks the
    // budget; the assertion does not — size-total must still see every line of
    // a backlog that size-impl is now blind to.
    const gated = gateRun({ "tasks/backlog.yaml": backlogOf(2700) }, PLACEHOLDER);
    expect(line(gated, "size-impl"), gated.out).toContain("pass");
    expect(line(gated, "size-total"), "size-total stopped counting the backlog").toContain("FAIL");
    expect(gated.out).toMatch(/2700/);
  });

  it("does not exempt every YAML file — a workflow is authored behaviour", () => {
    const dir = fixture({ ".github/workflows/gates.yml": codeLines(40) });
    expect(measure(dir), "the exclusion widened past the one file it names").toBe(40);
  });
});

// ---------------------------------------------------------------------------//
// Assertion 8 — the other measurements are untouched
// ---------------------------------------------------------------------------//

describe("assertion 8 · nothing else about the size gates moved", () => {
  const gate = readFileSync(GATE, "utf8");

  it("counts a non-TypeScript file exactly as --numstat does", () => {
    const dir = fixture({
      "prisma/schema.prisma": "// a prisma comment\nmodel A {\n  id String @id\n}\n",
      "scripts/backfill.sql": "-- a sql comment\nUPDATE x SET y = 1;\n",
    });
    expect(measure(dir), "a non-.ts file was reclassified").toBe(rawAdded(dir));
  });

  it("keeps every exclusion size-impl already had", () => {
    const dir = fixture({
      "docs/architecture/x.md": codeLines(200),
      "tests/x.test.ts": codeLines(200),
      "prisma/migrations/20260101000000_x/migration.sql": codeLines(200),
      "scripts/test-guards.sh": codeLines(200),
      "lib/a.ts": codeLines(10),
    });
    expect(measure(dir)).toBe(10);
  });

  it("size-impl is 400 and no node field raises it", () => {
    const waived = [
      "- id: demo",
      "  size_impl: 9000",
      "  size_total: 2500",
      '  size_waiver_reason: "tests, and only tests"',
      "  risk: low",
      "  status: todo",
    ].join("\n");
    const dir = fixture({ "lib/a.ts": codeLines(10) }, waived);
    const summary = run(GATE, ["--summary"], dir, { GATE_BASE: "main" });
    expect(summary.out).toMatch(/size-impl\s+400/);
    expect(summary.out).not.toMatch(/size-impl\s+9000/);
    expect(gate, "an impl budget is assigned somewhere other than the constant").toContain(
      "impl_budget=400",
    );
    expect(gate.match(/impl_budget=/g) ?? [], "impl_budget is assigned more than once").toHaveLength(
      1,
    );
  });

  it("leaves size-total counting every line, comments and blanks included", () => {
    const gated = gateRun({
      "lib/modules/deadlines/sweep.ts": commentLines(100) + codeLines(350),
    });
    expect(line(gated, "size-impl"), gated.out).toContain("pass");
    // 450 added lines against a 2600 backstop: it passes, and the total the
    // suite would fail on is still the undiscounted one. The failing direction
    // is pinned below, where the same discount does not save a 2700-line diff.
    expect(line(gated, "size-total"), gated.out).toContain("pass");

    const big = gateRun({
      "lib/modules/deadlines/sweep.ts": commentLines(2500) + codeLines(200),
    });
    expect(line(big, "size-impl"), "2500 comment lines were charged as code").toContain("pass");
    expect(line(big, "size-total"), "size-total stopped counting comments").toContain("FAIL");
    expect(big.out).toMatch(/2700/);
  });
});

// ---------------------------------------------------------------------------//
// The gate itself — the four demonstrations, end to end
// ---------------------------------------------------------------------------//

/**
 * A fixture the full `gate.sh` can run in. It carries its own copy of scripts/,
 * with `test-guards.sh` stubbed so the suite does not re-enter itself, `npx` and
 * `npm` stubbed because there is no toolchain to lint or test with, the
 * repository's `node_modules` symlinked and the kernel-source reader copied in —
 * the last two because classifying a line needs the compiler and the reader, and
 * a fixture missing them is not a smaller version of a real run, it is a run
 * that cannot measure.
 */
function gateFixture(files: Record<string, string>, backlog?: string): string {
  return fixture(files, backlog, (dir) => {
    execFileSync("cp", ["-r", path.join(repoRoot, "scripts"), path.join(dir, "scripts")]);
    write(dir, "scripts/test-guards.sh", "#!/bin/sh\nexit 0\n");
    execFileSync("chmod", ["+x", path.join(dir, "scripts", "test-guards.sh")]);
    mkdirSync(path.join(dir, "stub-bin"));
    for (const tool of ["npx", "npm"]) {
      const stub = path.join(dir, "stub-bin", tool);
      writeFileSync(stub, "#!/bin/sh\nexit 0\n");
      execFileSync("chmod", ["+x", stub]);
    }
    // Gitignored in the fixture, so it is neither committed nor a dirty path.
    symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"));
    write(dir, READER_RELATIVE, readFileSync(path.join(repoRoot, READER_RELATIVE), "utf8"));
  });
}

function gateRun(files: Record<string, string>, backlog?: string): Run {
  const dir = gateFixture(files, backlog);
  return run(path.join(dir, "scripts", "gate.sh"), [], dir, {
    GATE_BASE: "main",
    PATH: `${path.join(dir, "stub-bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  });
}

const line = (result: Run, label: string): string =>
  result.out.split("\n").filter((l) => l.startsWith(label)).join("\n");

describe("the gate, end to end", () => {
  it("passes a 450-line diff of which 100 are comments, at 350", () => {
    const result = gateRun({
      "lib/modules/deadlines/sweep.ts": commentLines(100) + codeLines(350),
    });
    expect(line(result, "size-impl"), result.out).toContain("pass");
  });

  it("refuses the same 450 lines when none of them is a comment", () => {
    const result = gateRun({ "lib/modules/deadlines/sweep.ts": codeLines(450) });
    expect(line(result, "size-impl"), result.out).toContain("FAIL");
    expect(result.out, "the refusal does not name the count it measured").toMatch(/450/);
    expect(result.out).toMatch(/split the task/);
  });

  it("refuses a diff that is over the budget on its code alone", () => {
    const result = gateRun({
      "lib/modules/deadlines/sweep.ts": commentLines(300) + codeLines(410),
    });
    expect(line(result, "size-impl"), "comments bought an oversized diff headroom").toContain(
      "FAIL",
    );
    expect(result.out).toMatch(/410/);
  });
});

// ---------------------------------------------------------------------------//
// It fails closed — ADR-031, and the direction that matters is under-counting
// ---------------------------------------------------------------------------//

describe("a diff it cannot classify is refused, never under-counted", () => {
  /** A copy of scripts/ with no repository around it: no reader, no node_modules. */
  function orphan(files: Record<string, string>): Run {
    const dir = fixture(files);
    execFileSync("cp", ["-r", path.join(repoRoot, "scripts"), path.join(dir, "scripts")]);
    return run("node", [path.join(dir, "scripts", "size-impl.mjs"), "--base", "main", "--", ":(top)"], dir);
  }

  it("refuses when the reader is not there to classify with", () => {
    const result = orphan({ "lib/a.ts": codeLines(10) });
    expect(result.code, result.out).not.toBe(0);
    expect(result.out).toMatch(/kernel-source\.ts/);
  });

  it("refuses rather than printing a number a caller would read as a count", () => {
    const result = orphan({ "lib/a.ts": codeLines(450) });
    expect(result.code).not.toBe(0);
    expect(result.out.trim(), "a refusal printed something shaped like a measurement").not.toMatch(
      /^\d+$/,
    );
  });

  it("needs no compiler for a diff with no TypeScript in it — the polarity check", () => {
    // A gate that refused whenever the toolchain was out of reach would refuse
    // more than it must. Nothing here needs classifying, so nothing is loaded.
    const result = orphan({ "prisma/schema.prisma": "model A {\n  id String @id\n}\n" });
    expect(result.code, result.out).toBe(0);
    expect(Number(result.out.trim())).toBe(3);
  });

  it("refuses when no base is given", () => {
    const dir = fixture({ "lib/a.ts": codeLines(10) });
    const result = run("node", [SIZE_IMPL], dir);
    expect(result.code).not.toBe(0);
    expect(result.out).toMatch(/--base/);
  });

  it("refuses when the base cannot be resolved", () => {
    const dir = fixture({ "lib/a.ts": codeLines(10) });
    const result = run("node", [SIZE_IMPL, "--base", "no-such-ref", "--", ":(top)"], dir);
    expect(result.code).not.toBe(0);
    expect(result.out).toMatch(/git/);
  });

  it("gate.sh fails size-impl closed rather than passing an unmeasured budget", () => {
    const gate = readFileSync(GATE, "utf8");
    const block = gate.slice(gate.indexOf("size-impl.mjs"));
    expect(block, "gate.sh does not fail the line when the script refuses").toMatch(
      /printf[^\n]*size-impl[\s\S]{0,120}FAIL/,
    );
    expect(block).toContain("fail=1");
  });
});

// ---------------------------------------------------------------------------//
// The record
// ---------------------------------------------------------------------------//

describe("the decision is recorded", () => {
  const decisions = readFileSync(path.join(repoRoot, "docs/architecture/decisions.md"), "utf8");
  const record = decisions.slice(decisions.indexOf("### ADR-035"));

  it("ADR-035 exists and states the rule", () => {
    expect(decisions).toContain("### ADR-035");
    expect(record).toMatch(/comment/i);
    expect(record, "the trailing-comment rule is not stated").toMatch(/trailing comment/i);
  });

  it("carries the evidence the 400 rests on", () => {
    for (const [what, re] of [
      ["the SmartBear/Cisco basis for 400", /SmartBear/i],
      ["the annotation finding", /annotat/i],
      ["the ADR-026 precedent", /ADR-026/],
      ["the ADR-028 precedent", /ADR-028/],
      ["the case that forced it", /module-deadlines-sweep/],
      ["the 400 to 403 measurement", /403/],
    ] as const) {
      expect(re.test(record), `ADR-035 does not carry ${what}`).toBe(true);
    }
  });

  it("records the whole ruling, not the TypeScript half of it", () => {
    for (const [what, re] of [
      ["the shell extension", /\.sh/],
      ["the JavaScript extension", /\.mjs/],
      ["the backlog exclusion", /tasks\/backlog\.yaml/],
      ["what the shell reader cannot do", /heredoc/i],
    ] as const) {
      expect(re.test(record), `ADR-035 does not carry ${what}`).toBe(true);
    }
    // One record of one ruling: the exclusions are stated in the decision
    // itself, not bolted on as a later amendment to a narrower rule.
    const decision = record.slice(record.indexOf("**Decision.**"));
    expect(decision.slice(0, 900), "the decision paragraph is still TypeScript-only").toMatch(
      /tasks\/backlog\.yaml/,
    );
  });

  it("says what it costs rather than only what it buys", () => {
    expect(record, "the cost — a comment-heavy diff is still a large diff — is not stated").toMatch(
      /size-total/,
    );
    expect(record, "that size-total is now the only budget holding that line is not stated").toMatch(
      /only budget|only thing/i,
    );
  });

  it("PIPELINE.md's gate table describes what size-impl now measures", () => {
    const pipeline = readFileSync(path.join(repoRoot, "PIPELINE.md"), "utf8");
    const row = pipeline.split("\n").find((l) => l.startsWith("| `size-impl`")) ?? "";
    expect(row, "the size-impl row does not mention comments").toMatch(/comment/i);
    expect(row).toMatch(/400/);
    expect(row, "the row still describes a TypeScript-only discount").toMatch(/\.sh/);
    expect(row, "the row does not say the backlog is out").toMatch(/backlog/i);
  });
});
