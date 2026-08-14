// A small, dependency-free reader for `lib/kernel/` — the source text, not the
// behaviour.
//
// WHY THIS EXISTS. Three of the four assertions on
// `tasks/backlog.yaml#kernel-entities-law` are about the *shape* of the kernel
// rather than about a value it computes:
//
//   * "Every kernel repository declares its tables with // owns:" is a claim
//     about a comment on line 1 and about every `db.<model>.` the file goes on
//     to touch. `scripts/check-boundaries.sh` reads that declaration, so a
//     declaration that is missing, wrong, or narrower than what the file
//     actually touches turns the boundary gate into a comment.
//   * "Regime holds rates, brackets and deadline days as data, not constants"
//     is a claim about what numbers do NOT appear in the source.
//   * The public surface (rule 4: "A module's public surface is its index.ts")
//     can be read for the vocabulary the spec fixes — `managerId`,
//     `weekendMask`, `holidays`, `rate`, `deadlineDays`, `brackets`.
//
// None of those can be reached by importing the module and calling it, and the
// repository layer cannot be exercised at all without a PostgreSQL this
// environment does not have. So they are read statically.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It never returns a function body. The
// extraction below stops at the `{` that opens one. That is not an accident of
// implementation: the author of these tests did not read the kernel
// implementation (it was written in parallel), and a test that grew an expected
// value out of a body would describe what was written rather than what the spec
// requires. Signatures and type members only — the same allowance the task
// gives for binding calls against `index.ts`.
//
// The parser is shallow on purpose. Anything it cannot classify is surfaced
// (`blankNonCode` is proven against fixtures in kernel-source.test.ts) rather
// than silently dropped, because a reader that quietly sees nothing turns every
// sweep built on it green.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `lib/kernel/` — the folder this task produces. */
export const KERNEL_DIR = path.join(REPO_ROOT, "lib", "kernel");

export interface SourceFile {
  /** Absolute path. */
  path: string;
  /** Repository-relative path, for failure messages: `lib/kernel/person/index.ts`. */
  relative: string;
  /** The immediate folder under `lib/kernel/`, or "" for a file sitting directly in it. */
  module: string;
  /** Basename: `repository.ts`. */
  name: string;
  source: string;
}

export interface KernelModule {
  /** The folder name under `lib/kernel/`. */
  name: string;
  dir: string;
  relative: string;
  /** Every .ts file in the folder, at any depth. */
  files: SourceFile[];
  index?: SourceFile;
  repository?: SourceFile;
}

// ------------------------------------------------------------- the filesystem --

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function read(file: string, root: string): SourceFile {
  const relative = path.relative(REPO_ROOT, file);
  const withinRoot = path.relative(root, file);
  const [first] = withinRoot.split(path.sep);
  return {
    path: file,
    relative,
    module: withinRoot.includes(path.sep) ? first : "",
    name: path.basename(file),
    source: readFileSync(file, "utf8"),
  };
}

/** Every TypeScript file under `lib/kernel/`, at any depth. Empty if it does not exist. */
export function kernelFiles(): SourceFile[] {
  return walk(KERNEL_DIR).map((file) => read(file, KERNEL_DIR));
}

/**
 * The kernel's modules: the folders under `lib/kernel/`. A folder with neither
 * an `index.ts` nor a `repository.ts` is still returned — a module missing one
 * of them is a finding, not something to filter out of the input.
 */
export function kernelModules(): KernelModule[] {
  if (!existsSync(KERNEL_DIR)) return [];
  return readdirSync(KERNEL_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(KERNEL_DIR, entry.name);
      const files = walk(dir).map((file) => read(file, KERNEL_DIR));
      return {
        name: entry.name,
        dir,
        relative: path.relative(REPO_ROOT, dir),
        files,
        index: files.find((file) => file.path === path.join(dir, "index.ts")),
        repository: files.find((file) => file.path === path.join(dir, "repository.ts")),
      };
    });
}

/** Every `lib/kernel/<module>/repository.ts` that exists. */
export function kernelRepositories(): SourceFile[] {
  return kernelModules()
    .map((module) => module.repository)
    .filter((file): file is SourceFile => file !== undefined);
}

// --------------------------------------------------------------- the lexer --

export interface BlankOptions {
  /** Blank the contents of string and template literals too. Default true. */
  strings?: boolean;
}

/**
 * Replaces comments — and, by default, the contents of string, template and
 * regular-expression literals — with spaces, leaving every other character and
 * every newline exactly where it was. Line and column numbers therefore survive,
 * so a finding can name the line it came from.
 *
 * The point is that a sweep for numeric literals must not fire on a number
 * inside a comment explaining a rate, on a version string, or on `\d{2,4}`
 * inside a regular expression, and must not miss one hidden in a template
 * expression — `${deadlineDays ?? 28}` is code, and the 28 in it counts.
 */
export function blankNonCode(source: string, options: BlankOptions = {}): string {
  const blankStrings = options.strings !== false;
  const out = source.split("");
  const blank = (index: number): void => {
    if (out[index] !== "\n") out[index] = " ";
  };

  type Mode = "code" | "line" | "block" | "single" | "double" | "template" | "regex";
  let mode: Mode = "code";
  // Brace depth in code, plus the depth at which each open `${` began, so the
  // matching `}` returns to template mode rather than to code.
  let depth = 0;
  const templateDepths: number[] = [];
  // Whether a `/` here can start a regular expression: true after an operator,
  // a comma, an opening bracket or a keyword, false after a value.
  let regexAllowed = true;
  let inCharClass = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    switch (mode) {
      case "line":
        blank(i);
        if (ch === "\n") mode = "code";
        break;

      case "block":
        blank(i);
        if (ch === "*" && next === "/") {
          blank(i + 1);
          i += 1;
          mode = "code";
        }
        break;

      case "single":
      case "double": {
        const quote = mode === "single" ? "'" : '"';
        if (ch === "\\") {
          if (blankStrings) {
            blank(i);
            blank(i + 1);
          }
          i += 1;
          break;
        }
        if (ch === quote) {
          if (blankStrings) blank(i);
          mode = "code";
          regexAllowed = false;
          break;
        }
        if (blankStrings && ch !== "\n") blank(i);
        break;
      }

      case "template":
        if (ch === "\\") {
          if (blankStrings) {
            blank(i);
            blank(i + 1);
          }
          i += 1;
          break;
        }
        if (ch === "$" && next === "{") {
          if (blankStrings) {
            blank(i);
            blank(i + 1);
          }
          templateDepths.push(depth);
          depth += 1;
          i += 1;
          mode = "code";
          regexAllowed = true;
          break;
        }
        if (ch === "`") {
          if (blankStrings) blank(i);
          mode = "code";
          regexAllowed = false;
          break;
        }
        if (blankStrings && ch !== "\n") blank(i);
        break;

      case "regex":
        if (ch === "\\") {
          if (blankStrings) {
            blank(i);
            blank(i + 1);
          }
          i += 1;
          break;
        }
        if (ch === "[") inCharClass = true;
        else if (ch === "]") inCharClass = false;
        else if (ch === "/" && !inCharClass) {
          if (blankStrings) blank(i);
          mode = "code";
          regexAllowed = false;
          break;
        }
        if (blankStrings && ch !== "\n") blank(i);
        break;

      default: {
        if (ch === "/" && next === "/") {
          blank(i);
          blank(i + 1);
          i += 1;
          mode = "line";
          break;
        }
        if (ch === "/" && next === "*") {
          blank(i);
          blank(i + 1);
          i += 1;
          mode = "block";
          break;
        }
        if (ch === "/" && regexAllowed) {
          if (blankStrings) blank(i);
          inCharClass = false;
          mode = "regex";
          break;
        }
        if (ch === '"') {
          if (blankStrings) blank(i);
          mode = "double";
          break;
        }
        if (ch === "'") {
          if (blankStrings) blank(i);
          mode = "single";
          break;
        }
        if (ch === "`") {
          if (blankStrings) blank(i);
          mode = "template";
          break;
        }
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (templateDepths.length > 0 && depth === templateDepths[templateDepths.length - 1]) {
            templateDepths.pop();
            if (blankStrings) blank(i);
            mode = "template";
            break;
          }
        }
        if (!/\s/.test(ch)) {
          // A `/` may start a regular expression unless the thing before it was
          // a value: an identifier, a number, or a closing bracket.
          regexAllowed = !/[\w$)\]]/.test(ch);
        }
        break;
      }
    }
  }

  return out.join("");
}

/** Comments gone, string contents kept — for reading declarations and members. */
export function codeWithStrings(source: string): string {
  return blankNonCode(source, { strings: false });
}

export interface NumericLiteral {
  raw: string;
  value: number;
  line: number;
  /** The whole line, code only, for context. */
  context: string;
}

const NUMBER = /(?<![\w$.])(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*)(?![\w$])/g;

/**
 * Every numeric literal in the code — comments, strings and regular
 * expressions already removed. `foo.2` cannot occur, and `x2` is an identifier,
 * so both are excluded by the boundaries above.
 */
export function numericLiterals(source: string): NumericLiteral[] {
  const code = blankNonCode(source);
  const lines = code.split("\n");
  const found: NumericLiteral[] = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(NUMBER)) {
      const raw = match[0];
      found.push({
        raw,
        value: Number(raw.replace(/_/g, "")),
        line: index + 1,
        context: line.trim(),
      });
    }
  });
  return found;
}

// ------------------------------------------------------- the owns declaration --

export interface OwnsDeclaration {
  /** True when the file's very first line is the declaration. */
  onFirstLine: boolean;
  /** True when a declaration appears anywhere in the file. */
  present: boolean;
  /** The line it was found on, 1-based; 0 when absent. */
  line: number;
  /** The table names it lists. */
  tables: string[];
  raw: string;
}

const OWNS = /^\s*\/\/\s*owns:(.*)$/i;

/**
 * The `// owns:` declaration CLAUDE.md requires as a repository's first line:
 * "`repository.ts`  the ONLY file importing @/lib/db; its first line is
 * `// owns: TableA, TableB` naming every table it may touch — the boundary
 * check reads this declaration".
 *
 * Names are split on commas, the `·` the ownership table uses, and whitespace.
 */
export function ownsDeclaration(source: string): OwnsDeclaration {
  const lines = source.split("\n");
  const index = lines.findIndex((line) => OWNS.test(line));
  if (index === -1) {
    return { onFirstLine: false, present: false, line: 0, tables: [], raw: "" };
  }
  const raw = lines[index];
  const listed = OWNS.exec(raw)?.[1] ?? "";
  return {
    onFirstLine: index === 0,
    present: true,
    line: index + 1,
    tables: listed
      .split(/[,·|;]+/)
      .flatMap((part) => part.trim().split(/\s+/))
      .map((name) => name.trim())
      .filter((name) => /^[A-Za-z_]\w*$/.test(name)),
    raw: raw.trim(),
  };
}

export interface DbUsage {
  /** The Prisma delegate as written: `personEnrolment` in `db.personEnrolment.findMany`. */
  delegate: string;
  line: number;
  context: string;
}

// `db.person.` and `tx.person.` — the client and the transaction handle a
// repository receives from `$transaction`. `$`-prefixed members (`$transaction`,
// `$queryRaw`) are client methods rather than tables and are excluded by the
// character class.
const DB_USAGE = /\b(?:db|tx|trx|client|prisma)\s*\.\s*([a-zA-Z_]\w*)\s*(?=[.[(])/g;

/** Every table a file actually touches through the client, as written. */
export function dbUsages(source: string): DbUsage[] {
  const code = blankNonCode(source);
  const found: DbUsage[] = [];
  code.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(DB_USAGE)) {
      found.push({ delegate: match[1], line: index + 1, context: line.trim() });
    }
  });
  return found;
}

/** Every module specifier a file imports or re-exports from. */
export function importSpecifiers(source: string): string[] {
  const code = codeWithStrings(source);
  const specifiers: string[] = [];
  const patterns = [
    /\bimport\s+[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

// ------------------------------------------------------- the public surface --

export interface ReExport {
  /** The names listed, or [] for `export * from`. */
  names: string[];
  star: boolean;
  from: string;
}

const RE_EXPORT_NAMED = /\bexport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const RE_EXPORT_STAR = /\bexport\s+\*\s*(?:as\s+\w+\s*)?from\s*["']([^"']+)["']/g;

export function reExports(source: string): ReExport[] {
  const code = codeWithStrings(source);
  const out: ReExport[] = [];
  for (const match of code.matchAll(RE_EXPORT_NAMED)) {
    const names = match[1]
      .split(",")
      .map((part) => part.replace(/\btype\b/, "").trim())
      .map((part) => (part.includes(" as ") ? part.split(" as ")[1].trim() : part))
      .filter((name) => /^[A-Za-z_]\w*$/.test(name));
    out.push({ names, star: false, from: match[2] });
  }
  for (const match of code.matchAll(RE_EXPORT_STAR)) {
    out.push({ names: [], star: true, from: match[1] });
  }
  return out;
}

export interface TypeMember {
  name: string;
  /** Everything after the member name on its line: `: readonly number[];`. */
  type: string;
  optional: boolean;
}

export interface TypeBlock {
  kind: "interface" | "type" | "class";
  name: string;
  members: TypeMember[];
  file: string;
  line: number;
  raw: string;
}

const TYPE_HEADER = /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(interface|type|class)\s+([A-Za-z_]\w*)/g;
const MEMBER = /^\s*(?:readonly\s+|public\s+|private\s+)?([A-Za-z_]\w*)\s*(\??)\s*([:(<].*)$/;

/**
 * Exported `interface`, `type` and `class` declarations, with their member
 * names and the text of each member's type. Only the declaration's braces are
 * read; a class's method bodies are skipped by taking members from lines whose
 * shape is `name: type` or `name(args)` at the top level of the block.
 */
export function exportedTypeBlocks(file: SourceFile): TypeBlock[] {
  const code = codeWithStrings(file.source);
  const blocks: TypeBlock[] = [];
  for (const header of code.matchAll(TYPE_HEADER)) {
    const start = header.index ?? 0;
    const open = code.indexOf("{", start);
    if (open === -1) continue;
    // A `type X = string` with no braces has no members; ignore it unless the
    // brace belongs to this declaration (i.e. arrives before the next `;`).
    const semicolon = code.indexOf(";", start);
    if (semicolon !== -1 && semicolon < open) continue;

    let depth = 0;
    let end = -1;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === "{") depth += 1;
      else if (code[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;

    const body = code.slice(open + 1, end);
    const members: TypeMember[] = [];
    let memberDepth = 0;
    for (const line of body.split("\n")) {
      const match = memberDepth === 0 ? MEMBER.exec(line) : null;
      if (match !== null) {
        members.push({ name: match[1], type: match[3].trim(), optional: match[2] === "?" });
      }
      for (const ch of line) {
        if (ch === "{" || ch === "(" || ch === "[") memberDepth += 1;
        else if (ch === "}" || ch === ")" || ch === "]") memberDepth -= 1;
      }
      if (memberDepth < 0) memberDepth = 0;
    }

    blocks.push({
      kind: header[1] as TypeBlock["kind"],
      name: header[2],
      members,
      file: file.relative,
      line: code.slice(0, start).split("\n").length,
      raw: code.slice(start, end + 1),
    });
  }
  return blocks;
}

export interface Declaration {
  /** The declared name, where there is one. */
  name: string;
  /** The signature: everything up to the `{` that would open a body, never the body. */
  signature: string;
  file: string;
  line: number;
}

const DECLARATION =
  /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_]\w*)/g;

/**
 * Exported declarations, as signatures. The captured text stops at the first
 * `{` that opens a body or at the statement's `;`, whichever comes first — so a
 * function's parameters and return type are readable and its body is not.
 */
export function exportedDeclarations(file: SourceFile): Declaration[] {
  const code = codeWithStrings(file.source);
  const found: Declaration[] = [];
  for (const match of code.matchAll(DECLARATION)) {
    const start = match.index ?? 0;
    const kind = match[1];
    let end = code.length;
    if (kind === "interface" || kind === "type" || kind === "class" || kind === "enum") {
      // A type declaration IS its body; take the balanced block.
      const open = code.indexOf("{", start);
      if (open === -1) {
        end = Math.min(code.indexOf(";", start) === -1 ? code.length : code.indexOf(";", start), code.length);
      } else {
        let depth = 0;
        for (let i = open; i < code.length; i += 1) {
          if (code[i] === "{") depth += 1;
          else if (code[i] === "}") {
            depth -= 1;
            if (depth === 0) {
              end = i + 1;
              break;
            }
          }
        }
      }
    } else {
      // Everything up to the body-opening brace, the arrow, or the semicolon.
      let depth = 0;
      for (let i = start; i < code.length; i += 1) {
        const ch = code[i];
        if (ch === "(" || ch === "[" || ch === "<") depth += 1;
        else if (ch === ")" || ch === "]" || ch === ">") depth -= 1;
        else if (depth <= 0 && (ch === "{" || ch === ";" || ch === "\n")) {
          if (ch === "\n" && code.slice(start, i).trim().endsWith("=")) continue;
          end = i;
          break;
        }
      }
    }
    found.push({
      name: match[2],
      signature: code.slice(start, end).replace(/\s+/g, " ").trim(),
      file: file.relative,
      line: code.slice(0, start).split("\n").length,
    });
  }
  return found;
}

/**
 * The files that make up a module's public surface: `index.ts` plus, following
 * `export … from "./x"` chains, the files it re-exports from. Rule 4 — "A
 * module's public surface is its `index.ts`" — and a type re-exported from
 * `./calendar` is part of that surface even though its declaration lives one
 * file further in.
 */
export function publicSurfaceFiles(module: KernelModule): SourceFile[] {
  if (module.index === undefined) return [];
  const byPath = new Map(module.files.map((file) => [path.resolve(file.path), file]));
  const seen = new Set<string>();
  const queue: SourceFile[] = [module.index];
  const surface: SourceFile[] = [];

  while (queue.length > 0) {
    const file = queue.shift() as SourceFile;
    const key = path.resolve(file.path);
    if (seen.has(key)) continue;
    seen.add(key);
    surface.push(file);
    for (const re of reExports(file.source)) {
      if (!re.from.startsWith(".")) continue;
      const base = path.resolve(path.dirname(file.path), re.from);
      const target =
        byPath.get(`${base}.ts`) ?? byPath.get(path.join(base, "index.ts")) ?? byPath.get(base);
      if (target !== undefined) queue.push(target);
    }
  }
  return surface;
}

/** Every exported type declaration reachable from a module's `index.ts`. */
export function publicTypeBlocks(module: KernelModule): TypeBlock[] {
  return publicSurfaceFiles(module).flatMap(exportedTypeBlocks);
}

/** Every exported declaration signature reachable from a module's `index.ts`. */
export function publicDeclarations(module: KernelModule): Declaration[] {
  return publicSurfaceFiles(module).flatMap(exportedDeclarations);
}

/** The whole kernel's public surface, across every module. */
export function kernelPublicTypeBlocks(): TypeBlock[] {
  return kernelModules().flatMap(publicTypeBlocks);
}

export function kernelPublicDeclarations(): Declaration[] {
  return kernelModules().flatMap(publicDeclarations);
}
