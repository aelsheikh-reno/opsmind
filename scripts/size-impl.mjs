#!/usr/bin/env node
// size-impl — the added IMPLEMENTATION lines of a diff, for scripts/gate.sh.
//
//   node scripts/size-impl.mjs --base <rev> [--head <rev>] [-- <pathspec>...]
//   node scripts/size-impl.mjs --classify <file>
//
// The first form prints one integer: the added lines of `<base>...<head>` under
// the given pathspecs, counting a `.ts` or `.tsx` line only when it carries
// code. Comment-only lines and blank lines are not implementation (ADR-035) —
// the 400 comes from a study of reviewer cognitive load whose other finding was
// that authors who annotate ship fewer defects, so charging annotations to the
// code budget makes deleting them the cheapest path to green. A trailing
// comment discounts nothing: a line carrying code counts in full. Every other
// file is counted exactly as `git diff --numstat` counts it, unchanged.
//
// The second form prints `<line>\t<kind>\t<text>` for one file, so that what
// the gate believes about a file can be read directly rather than inferred from
// a total. It is what the demonstrations in the pull request are captured from.
//
// WHY A NODE SCRIPT AND NOT MORE AWK. Deciding whether a line is a comment
// needs the parser, not a pattern: `//` inside a string literal, inside a
// template literal and inside a JSX expression is code, and this repository has
// already been bitten once by a line scanner that read declarations out of
// string literals. tests/kernel/kernel-source.ts is the reader built for that
// lesson — it parses with `ts.createSourceFile` and collects comments as
// `ts.CommentRange[]` — so the classification is ITS `classifyLines`, called
// here rather than reimplemented. Two implementations would drift, and the
// suite would only ever grade one of them.
//
// HOW A .ts FILE IS REACHED FROM PLAIN NODE. There is no `tsx` or `ts-node` in
// this repository and node 20 cannot import TypeScript, so the reader is
// transpiled with `ts.transpileModule` and the JavaScript is imported. The copy
// is written to `node_modules/.cache`, which is chosen for reasons and not for
// taste: a bare `import ts from "typescript"` inside the copy has to resolve
// (node walks up from the importing file, so anything under `node_modules/`
// finds its sibling), and the directory is gitignored, so the copy can never
// make the tree the gate measures dirty. What the copy must NOT be trusted for
// is its own idea of where the repository is — the note in `classifier()` below
// says why, and it is the reason only its pure functions are used.
//
// `typescript` is imported dynamically, inside the classifier and nowhere else,
// so that a diff carrying no .ts or .tsx file needs no compiler at all: there
// is nothing to classify, --numstat has already answered, and a measurement
// should not acquire a dependency it does not use.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const READER = path.join(ROOT, "tests", "kernel", "kernel-source.ts");
const CACHE = path.join(ROOT, "node_modules", ".cache");

// FAIL CLOSED, ALWAYS. Every exit from here is non-zero with a reason on
// stderr, and gate.sh prints it under a FAILing size-impl line. A measurement
// that cannot be taken must not be reported as one that was (ADR-031), and the
// direction that matters here is under-counting: a size-impl that quietly
// classifies nothing would pass every oversized implementation ever written.
function refuse(message) {
  process.stderr.write(`size-impl cannot measure this diff: ${message}\n`);
  process.exit(1);
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const said = `${error.stderr ?? ""}`.trim() || `${error.message ?? error}`;
    return refuse(`git ${args.join(" ")} failed — ${said}`);
  }
}

/**
 * The reader's `classifyLines`, transpiled and loaded. Anything that goes wrong
 * on the way — a missing reader, a compiler that cannot be loaded, a transpile
 * that reports diagnostics, a copy that cannot be written or imported, a module
 * that does not export what it must — refuses rather than returning something
 * that would classify nothing.
 */
async function classifier() {
  if (!existsSync(READER)) refuse(`${READER} is missing; nothing can classify a line without it`);
  let ts;
  try {
    ts = (await import("typescript")).default;
  } catch (error) {
    refuse(
      "the typescript package could not be loaded, so no line can be classified — " +
        `${error.message ?? error}`,
    );
  }
  const source = readFileSync(READER, "utf8");
  const emitted = ts.transpileModule(source, {
    fileName: READER,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: true,
    },
  });
  const complaints = (emitted.diagnostics ?? []).map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, " "),
  );
  if (complaints.length > 0) refuse(`${READER} did not transpile — ${complaints.join("; ")}`);

  const digest = createHash("sha256").update(emitted.outputText).digest("hex").slice(0, 16);
  const copy = path.join(CACHE, `kernel-source.${digest}.mjs`);
  if (!existsSync(copy)) {
    try {
      mkdirSync(CACHE, { recursive: true });
      // Written under a unique name and renamed, so a concurrent run never
      // imports half a file.
      const partial = `${copy}.${process.pid}.partial`;
      writeFileSync(partial, emitted.outputText);
      renameSync(partial, copy);
    } catch (error) {
      refuse(`could not write the transpiled reader to ${copy} — ${error.message ?? error}`);
    }
  }

  let loaded;
  try {
    loaded = await import(pathToFileURL(copy).href);
  } catch (error) {
    refuse(`could not load the transpiled reader from ${copy} — ${error.message ?? error}`);
  }
  if (typeof loaded.classifyLines !== "function") {
    refuse(`${READER} no longer exports classifyLines`);
  }
  // ONLY THE PURE FUNCTIONS OF THE COPY MAY BE USED. `classifyLines` takes a
  // string and touches no filesystem, which is why it is safe to call on a copy
  // that lives somewhere else. The reader's `REPO_ROOT` and everything built on
  // it (`kernelFiles`, `kernelModules`) resolve from the copy's own location —
  // and `node_modules` is a symlink often enough, in an agent worktree or in a
  // gate fixture, that the copy is not reliably under the tree being measured.
  // Anything here that starts reading files through the reader has to be handed
  // a root rather than trusting that one.
  return loaded.classifyLines;
}

const isTypeScript = (file) => /\.tsx?$/.test(file);

/**
 * Added and deleted counts per file, keyed by the path as it exists at `head`.
 * `-z` is what makes this parseable: paths are neither quoted nor munged, and a
 * rename arrives as an empty path field followed by the old and new names, so
 * the count lands on the file the diff produced rather than on the one it
 * consumed.
 */
function changedFiles(base, head, pathspecs, cwd) {
  const raw = git(["diff", "--numstat", "-z", `${base}...${head}`, "--", ...pathspecs], cwd);
  const fields = raw.split("\0");
  const files = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === "") continue;
    const parts = field.split("\t");
    if (parts.length !== 3) refuse(`could not read a --numstat record: ${JSON.stringify(field)}`);
    const [added, , name] = parts;
    let file = name;
    if (file === "") {
      // A rename or a copy: the two names follow as their own fields.
      file = fields[index + 2];
      index += 2;
      if (file === undefined) refuse("a --numstat rename record named no destination file");
    }
    // A binary file reports "-" for both counts, and `git diff --numstat | awk
    // '{a+=$1}'` — which this replaces — adds zero for it; so does this, unless
    // it is a .ts or .tsx, which git calls binary when the source holds a NUL.
    // Its lines cannot be classified, and zero is precisely the under-count.
    // Not hypothetical: during this task a NUL landed in a template literal in
    // kernel-source.ts and git stopped diffing the file at all.
    if (added === "-" && isTypeScript(file)) refuse(`${file} is binary to git; no line is readable`);
    const count = added === "-" ? 0 : Number(added);
    if (!Number.isInteger(count)) refuse(`--numstat reported ${added} added lines for ${file}`);
    files.push({ file, added: count });
  }
  return files;
}

/**
 * The line numbers each file gained, read from a zero-context patch: `@@ -a,b
 * +c,d @@` says d lines were added starting at c in the post-image, and an
 * absent count means one. The same shape scripts/coverage-gate.sh reads to find
 * the lines a task must cover.
 *
 * The file a hunk belongs to is taken from the `+++ b/<path>` header rather
 * than from `diff --git`, whose two paths cannot be split unambiguously when
 * one contains a space. Every path parsed here must be one --numstat also
 * named; anything else means the two readings disagree, and a disagreement is
 * refused rather than resolved.
 */
function addedLines(base, head, pathspecs, cwd, known) {
  const patch = git(
    ["diff", "--unified=0", "--no-color", "--no-ext-diff", `${base}...${head}`, "--", ...pathspecs],
    cwd,
  );
  const lines = new Map();
  let current = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      const named = line.slice(4).trim();
      current = named === "/dev/null" ? null : named.replace(/^b\//, "");
      if (current !== null && !known.has(current)) {
        refuse(
          `the patch names ${current}, which --numstat did not report; refusing to guess which ` +
            "file its lines belong to",
        );
      }
      continue;
    }
    if (!line.startsWith("@@")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk === null) refuse(`could not read a hunk header: ${JSON.stringify(line)}`);
    if (current === null) refuse(`a hunk arrived before any file header: ${JSON.stringify(line)}`);
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const found = lines.get(current) ?? [];
    for (let n = start; n < start + count; n += 1) found.push(n);
    lines.set(current, found);
  }
  return lines;
}

async function measure(base, head, pathspecs, cwd) {
  const files = changedFiles(base, head, pathspecs, cwd);
  const typescriptFiles = files.filter((f) => f.added > 0 && isTypeScript(f.file));
  let total = 0;
  for (const f of files) if (!isTypeScript(f.file)) total += f.added;
  if (typescriptFiles.length === 0) return total;

  const classifyLines = await classifier();
  const known = new Set(files.map((f) => f.file));
  const added = addedLines(base, head, pathspecs, cwd, known);
  for (const f of typescriptFiles) {
    const numbers = added.get(f.file) ?? [];
    // The two readings of the same diff must agree before either is trusted.
    if (numbers.length !== f.added) {
      refuse(
        `${f.file}: --numstat reports ${f.added} added lines and the patch shows ` +
          `${numbers.length}; refusing to charge a budget against a diff read two ways`,
      );
    }
    // The post-image is read from `head` rather than from the working tree:
    // the added line numbers refer to the committed side of the diff, which is
    // the subject gate.sh names and refuses to disagree with (ADR-031).
    const at = git(["show", `${head}:${f.file}`], cwd);
    const kinds = classifyLines(at, { tsx: f.file.endsWith(".tsx") });
    for (const n of numbers) {
      const kind = kinds[n - 1];
      if (kind === undefined) {
        refuse(
          `${f.file}: the diff adds line ${n} but the file at ${head} has ${kinds.length} lines`,
        );
      }
      if (kind === "code") total += 1;
    }
  }
  return total;
}

async function classifyFile(file) {
  const classifyLines = await classifier();
  // Read through a catch rather than an existsSync test: a directory, a broken
  // symlink and a file the runner cannot read are all "cannot classify this",
  // and only the error says which. A refusal that names the wrong cause sends
  // its reader somewhere the fault is not.
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (error) {
    refuse(`could not read ${file} — ${error.message ?? error}`);
  }
  const kinds = classifyLines(source, { tsx: file.endsWith(".tsx") });
  const text = source.split("\n");
  const out = kinds.map((kind, index) => `${index + 1}\t${kind}\t${text[index]}`);
  process.stdout.write(`${out.join("\n")}\n`);
}

async function main(argv) {
  const separator = argv.indexOf("--");
  const flags = separator === -1 ? argv : argv.slice(0, separator);
  const pathspecs = separator === -1 ? [] : argv.slice(separator + 1);
  const read = (name, fallback) => {
    const at = flags.indexOf(name);
    if (at === -1) return fallback;
    const value = flags[at + 1];
    if (value === undefined) refuse(`${name} was given no value`);
    return value;
  };

  const file = read("--classify", null);
  if (file !== null) return classifyFile(file);

  const base = read("--base", null);
  if (base === null) refuse("no --base was given, and there is no diff to measure without one");
  const head = read("--head", "HEAD");
  const specs = pathspecs.length > 0 ? pathspecs : [":(top)"];
  process.stdout.write(`${await measure(base, head, specs, process.cwd())}\n`);
}

await main(process.argv.slice(2));
