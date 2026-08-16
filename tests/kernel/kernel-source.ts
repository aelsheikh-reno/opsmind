// A reader for `lib/kernel/` — the source text, not the behaviour.
//
// It reads through the TypeScript compiler API. `typescript` is already a
// devDependency (it is what the `types` gate runs), so the questions below are
// answered from the same token stream and the same syntax tree the compiler
// itself builds, rather than from a lexer written here that has to be believed.
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
// The queries are shallow on purpose. Anything the reader cannot classify is
// surfaced (`blankNonCode` is proven against fixtures in kernel-source.test.ts)
// rather than silently dropped, because a reader that quietly sees nothing turns
// every sweep built on it green.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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

// ------------------------------------------------------------- the compiler --

interface Parsed {
  file: ts.SourceFile;
  /** Every token with nothing beneath it, in source order. */
  tokens: ts.Node[];
  /** Every comment, in source order. Comments are trivia, so they are not nodes. */
  comments: ts.CommentRange[];
}

/**
 * Parsing is memoised on the source text and the script kind it was read in:
 * a sweep asks the same file for its comments, then for its literals, then for
 * its declarations, and re-parsing each time is work with no new answer
 * attached. The kind is part of the key because the same bytes parse into two
 * different trees under the two kinds, and answering a .tsx question from a
 * cached .ts parse is exactly the silent wrong answer this reader exists to
 * avoid.
 *
 * The DEFAULT is TypeScript rather than TSX, and that is deliberate for
 * `lib/kernel/`: it is shared vocabulary holding no components, and `<T>` in a
 * .ts file means a type argument — the reading the compiler only takes in this
 * mode. A .tsx file must be parsed as TSX or the opposite mistake happens:
 * `<div>{x}</div>` is read as a type assertion, the JSX is not a tree, and the
 * comment ranges inside it are wrong. So callers reading a real file pass the
 * kind their extension implies rather than inheriting this default.
 */
const parses = new Map<string, Parsed>();

function parse(source: string, kind: ts.ScriptKind = ts.ScriptKind.TS): Parsed {
  const key = `${kind}\u0000${source}`;
  const cached = parses.get(key);
  if (cached !== undefined) return cached;

  const name = kind === ts.ScriptKind.TSX ? "kernel.tsx" : "kernel.ts";
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, kind);
  const tokens: ts.Node[] = [];
  const collect = (node: ts.Node): void => {
    const children = node.getChildren(file);
    if (children.length === 0) tokens.push(node);
    else children.forEach(collect);
  };
  collect(file);

  // Between a token's full start and its start lies nothing but whitespace and
  // comments, so every comment in the file is in some token's trivia — the last
  // one included, because the end-of-file token is a token. `getLeading…` alone
  // would miss a comment that trails code on its own line, which is exactly
  // where a rate gets explained; the two together miss nothing.
  //
  // A range is kept only where it lies inside that trivia span. The two
  // `get…CommentRanges` helpers are text scanners rather than parser output:
  // handed a position they read forward through whatever looks like a comment,
  // and they are right precisely because everything between a token's full
  // start and its start IS trivia. JSX text is the exception — it carries none,
  // so its own characters begin at the full start and the scanner reads them —
  // and `<div>// not a comment</div>` renders those characters. Bounding every
  // range by the token's start drops the misreading and keeps every real
  // comment, whose whole extent is in the trivia by construction.
  const comments: ts.CommentRange[] = [];
  const seen = new Set<number>();
  for (const token of tokens) {
    const trivia = token.getFullStart();
    const start = token.getStart(file);
    const found = [
      ...(ts.getTrailingCommentRanges(source, trivia) ?? []),
      ...(ts.getLeadingCommentRanges(source, trivia) ?? []),
    ];
    for (const range of found) {
      if (range.end > start || seen.has(range.pos)) continue;
      seen.add(range.pos);
      comments.push(range);
    }
  }

  const parsed: Parsed = { file, tokens, comments };
  parses.set(key, parsed);
  return parsed;
}

const lineAt = (file: ts.SourceFile, position: number): number =>
  file.getLineAndCharacterOfPosition(position).line + 1;

/** Every node in the tree, outermost first, in source order. */
function eachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => {
    eachNode(child, visit);
  });
}

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

const NAME = /^[A-Za-z_]\w*$/;

// ------------------------------------------------------------ blanking code --

export interface BlankOptions {
  /** Blank the contents of string and template literals too. Default true. */
  strings?: boolean;
  /**
   * Parse as TSX rather than TS. Default false. Set it for a `.tsx` file and
   * for nothing else: the two kinds disagree about `<`, so each is wrong on the
   * other's files.
   */
  tsx?: boolean;
}

/**
 * The literal tokens whose contents are text rather than code. A template with
 * a substitution is three or more tokens — `` `due ${ ``, then the expression,
 * then `` } days` `` — so blanking the literal tokens leaves the expression
 * standing, which is the behaviour that matters below.
 */
const LITERAL_TOKENS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

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
 *
 * Telling `/` the divisor from `/` the regular expression is the parser's job
 * here rather than this file's: `total / 2` is a slash token and
 * `/^[A-Z]{2}\d{2,4}$/` is one literal token, decided by the same grammar the
 * compiler uses.
 */
export function blankNonCode(source: string, options: BlankOptions = {}): string {
  const blankStrings = options.strings !== false;
  const { file, tokens, comments } = parse(
    source,
    options.tsx === true ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out = source.split("");
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      if (out[index] !== "\n") out[index] = " ";
    }
  };

  for (const comment of comments) blank(comment.pos, comment.end);
  if (blankStrings) {
    for (const token of tokens) {
      if (LITERAL_TOKENS.has(token.kind)) blank(token.getStart(file), token.end);
    }
  }
  return out.join("");
}

/** Comments gone, string contents kept — for reading declarations and members. */
export function codeWithStrings(source: string): string {
  return blankNonCode(source, { strings: false });
}

// ------------------------------------------------------ classifying a line --

/**
 * What one physical line of a file carries. A line is `code` if any code
 * survives on it once comments are removed, `comment` if it had text and none
 * of it survived, and `blank` if it was empty or whitespace to begin with.
 */
export type LineKind = "blank" | "comment" | "code";

/**
 * Every line of a file, classified. Used by `scripts/size-impl.mjs`, which
 * charges only `code` lines to the 400-line implementation budget (ADR-035):
 * an annotation is not implementation, and charging it makes deleting it the
 * cheapest way to a green gate.
 *
 * The classification is the compiler's, not a scanner's, and the difference is
 * the whole point. `//` inside a string literal, inside a template literal and
 * inside a JSX expression is CODE; only the ranges the parser reports as
 * comment trivia are comments. A line scanner reading declarations out of
 * string literals is the mistake this file was written to stop making, and
 * "the line starts with //" is the same mistake with a smaller blast radius.
 *
 * A line carrying code AND a trailing comment is code, in full and with no
 * partial credit — string contents are kept here (`strings: false`) so a
 * literal never blanks a line down to nothing, and the alternative rule would
 * reward moving an explanation onto the line it explains.
 *
 * Pass `tsx: true` for a `.tsx` file. Under the default TS kind
 * `<div>{x}</div>` parses as a type assertion rather than as JSX, and the
 * comment ranges that come back describe a file nobody wrote.
 */
export function classifyLines(source: string, options: BlankOptions = {}): LineKind[] {
  const code = blankNonCode(source, { tsx: options.tsx, strings: false }).split("\n");
  return source.split("\n").map((line, index) => {
    if (line.trim() === "") return "blank";
    return (code[index] ?? "").trim() === "" ? "comment" : "code";
  });
}

export interface NumericLiteral {
  raw: string;
  value: number;
  line: number;
  /** The whole line, code only, for context. */
  context: string;
}

/**
 * Every numeric literal in the code. A number in a comment, in a string or in a
 * regular expression is not a numeric literal token, so none of them appear
 * here; neither does the `2` of `x2`, which is part of an identifier. `28` in
 * `${days ?? 28}` does appear, because it is code.
 */
export function numericLiterals(source: string): NumericLiteral[] {
  const { file, tokens } = parse(source);
  const lines = blankNonCode(source).split("\n");
  return tokens
    .filter((token) => token.kind === ts.SyntaxKind.NumericLiteral)
    .map((token) => {
      const raw = source.slice(token.getStart(file), token.end);
      const line = lineAt(file, token.getStart(file));
      return { raw, value: Number(raw.replace(/_/g, "")), line, context: lines[line - 1].trim() };
    });
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

const OWNS = /^\/\/\s*owns:(.*)$/i;

/**
 * The `// owns:` declaration CLAUDE.md requires as a repository's first line:
 * "`repository.ts`  the ONLY file importing @/lib/db; its first line is
 * `// owns: TableA, TableB` naming every table it may touch — the boundary
 * check reads this declaration".
 *
 * Read from the file's comments, so the same words inside a string literal are
 * not a declaration, and required to open its line, which is the convention
 * CLAUDE.md states. Names are split on commas, the `·` the ownership table
 * uses, and whitespace.
 */
export function ownsDeclaration(source: string): OwnsDeclaration {
  const { file, comments } = parse(source);
  const lines = source.split("\n");
  for (const comment of comments) {
    if (comment.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
    const listed = OWNS.exec(source.slice(comment.pos, comment.end));
    if (listed === null) continue;
    const { line, character } = file.getLineAndCharacterOfPosition(comment.pos);
    if (lines[line].slice(0, character).trim() !== "") continue;
    return {
      onFirstLine: line === 0,
      present: true,
      line: line + 1,
      tables: listed[1]
        .split(/[,·|;]+/)
        .flatMap((part) => part.trim().split(/\s+/))
        .map((name) => name.trim())
        .filter((name) => NAME.test(name)),
      raw: lines[line].trim(),
    };
  }
  return { onFirstLine: false, present: false, line: 0, tables: [], raw: "" };
}

export interface DbUsage {
  /** The Prisma delegate as written: `personEnrolment` in `db.personEnrolment.findMany`. */
  delegate: string;
  line: number;
  context: string;
}

// The client and the transaction handle a repository receives from
// `$transaction`. `$`-prefixed members (`$transaction`, `$queryRaw`) are client
// methods rather than tables and fail the name test below.
const CLIENTS = new Set(["db", "tx", "trx", "client", "prisma"]);

/** True when the access is a base rather than the whole expression: `db.person.findMany`, `db.person[k]`, `db.person(…)`. */
function isReached(node: ts.Node): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) {
    return parent.expression === node;
  }
  return ts.isCallExpression(parent) && parent.expression === node;
}

/**
 * Every table a file actually touches through the client, as written. Read from
 * the tree, so a chain broken across lines — `db.person` on one and
 * `.findMany()` on the next — counts exactly as the one-line form does.
 */
export function dbUsages(source: string): DbUsage[] {
  const { file } = parse(source);
  const lines = blankNonCode(source).split("\n");
  const found: DbUsage[] = [];
  eachNode(file, (node) => {
    if (!ts.isPropertyAccessExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || !CLIENTS.has(node.expression.text)) return;
    if (!ts.isIdentifier(node.name) || !NAME.test(node.name.text)) return;
    if (!isReached(node)) return;
    const line = lineAt(file, node.getStart(file));
    found.push({ delegate: node.name.text, line, context: lines[line - 1].trim() });
  });
  return found;
}

/** Every module specifier a file imports or re-exports from. */
export function importSpecifiers(source: string): string[] {
  const { file } = parse(source);
  const specifiers: string[] = [];
  const add = (node: ts.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  eachNode(file, (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      add(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const dynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
      if (dynamic || (ts.isIdentifier(callee) && callee.text === "require")) add(node.arguments[0]);
    }
  });
  return specifiers;
}

// ------------------------------------------------------- the public surface --

export interface ReExport {
  /** The names listed, or [] for `export * from`. */
  names: string[];
  star: boolean;
  from: string;
}

export function reExports(source: string): ReExport[] {
  const { file } = parse(source);
  const out: ReExport[] = [];
  eachNode(file, (node) => {
    if (!ts.isExportDeclaration(node)) return;
    const from = node.moduleSpecifier;
    if (from === undefined || !ts.isStringLiteralLike(from)) return;
    const clause = node.exportClause;
    const named = clause !== undefined && ts.isNamedExports(clause) ? clause.elements : [];
    out.push({
      // The name the importer sees, so `x as y` is exported as `y`.
      names: named.map((element) => element.name.text).filter((name) => NAME.test(name)),
      star: clause === undefined || ts.isNamespaceExport(clause),
      from: from.text,
    });
  });
  return out;
}

export interface TypeMember {
  name: string;
  /** Everything after the member name: `: readonly number[];`. */
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

/**
 * The declared members of one braced block, with the text of each member's
 * type. Left out: a member with no name — an index signature, a call signature,
 * a constructor — and a member whose declaration is not a type, such as a class
 * field with an initialiser. Neither is a shape a caller reads a value out of.
 * A method's body is never included; the text stops at the `{` that opens it.
 */
function typeMembers(
  members: readonly (ts.TypeElement | ts.ClassElement)[],
  file: ts.SourceFile,
  code: string,
): TypeMember[] {
  const found: TypeMember[] = [];
  for (const member of members) {
    const name = member.name;
    if (name === undefined || !ts.isIdentifier(name) || !NAME.test(name.text)) continue;
    const question = (member as { questionToken?: ts.QuestionToken }).questionToken;
    const body = (member as { body?: ts.Node }).body;
    const from = (question ?? name).end;
    const type = code.slice(from, body === undefined ? member.end : body.getStart(file)).trim();
    if (!/^[:(<]/.test(type)) continue;
    found.push({ name: name.text, type, optional: question !== undefined });
  }
  return found;
}

/** The first `{ … }` in a type expression: what `type X = { … } | null` declares. */
function firstTypeLiteral(node: ts.Node): ts.TypeLiteralNode | undefined {
  if (ts.isTypeLiteralNode(node)) return node;
  let found: ts.TypeLiteralNode | undefined;
  ts.forEachChild(node, (child) => {
    if (found === undefined) found = firstTypeLiteral(child);
  });
  return found;
}

/**
 * Exported `interface`, `type` and `class` declarations, with their member
 * names and the text of each member's type. A `type X = string` declares no
 * members and is not a block; a `type X = { … }` is.
 */
export function exportedTypeBlocks(file: SourceFile): TypeBlock[] {
  const { file: parsed } = parse(file.source);
  const code = codeWithStrings(file.source);
  const blocks: TypeBlock[] = [];
  const push = (
    node: ts.Node,
    kind: TypeBlock["kind"],
    name: string,
    members: readonly (ts.TypeElement | ts.ClassElement)[],
    end: number,
  ): void => {
    const start = node.getStart(parsed);
    blocks.push({
      kind,
      name,
      members: typeMembers(members, parsed, code),
      file: file.relative,
      line: lineAt(parsed, start),
      raw: code.slice(start, end),
    });
  };

  eachNode(parsed, (node) => {
    if (!isExported(node)) return;
    if (ts.isInterfaceDeclaration(node)) push(node, "interface", node.name.text, node.members, node.end);
    else if (ts.isClassDeclaration(node) && node.name !== undefined)
      push(node, "class", node.name.text, node.members, node.end);
    else if (ts.isTypeAliasDeclaration(node)) {
      const literal = firstTypeLiteral(node.type);
      if (literal !== undefined) push(node, "type", node.name.text, literal.members, literal.end);
    }
  });
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

/**
 * Where a variable's signature stops. An object, an array or a class body is
 * the initialiser's body and is dropped; a function's body is dropped but its
 * parameters and return type are kept, because those are the contract. Anything
 * else — `export const retries = 3` — is short enough to be its own signature.
 */
function initialiserEnd(declaration: ts.VariableDeclaration, file: ts.SourceFile): number {
  const initialiser = declaration.initializer;
  if (initialiser === undefined) return declaration.end;
  if (ts.isArrowFunction(initialiser) || ts.isFunctionExpression(initialiser)) {
    return initialiser.body.getStart(file);
  }
  const isBody =
    ts.isObjectLiteralExpression(initialiser) ||
    ts.isArrayLiteralExpression(initialiser) ||
    ts.isClassExpression(initialiser);
  return isBody ? initialiser.getStart(file) : declaration.end;
}

/**
 * Exported declarations, as signatures. A function's parameters and return type
 * are readable and its body is not; a type, an interface, an enum and a class
 * ARE their bodies, so those are returned whole.
 */
export function exportedDeclarations(file: SourceFile): Declaration[] {
  const { file: parsed } = parse(file.source);
  const code = codeWithStrings(file.source);
  const found: Declaration[] = [];
  const add = (name: string, start: number, end: number): void => {
    found.push({
      name,
      signature: code.slice(start, end).replace(/\s+/g, " ").trim().replace(/;$/, ""),
      file: file.relative,
      line: lineAt(parsed, start),
    });
  };

  eachNode(parsed, (node) => {
    if (!isExported(node)) return;
    const start = node.getStart(parsed);
    if (ts.isFunctionDeclaration(node)) {
      if (node.name !== undefined) add(node.name.text, start, node.body?.getStart(parsed) ?? node.end);
    } else if (ts.isClassDeclaration(node)) {
      if (node.name !== undefined) add(node.name.text, start, node.end);
    } else if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      add(node.name.text, start, node.end);
    } else if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach((declaration, index) => {
        if (!ts.isIdentifier(declaration.name)) return;
        // The first declarator carries the `export const` the reader is looking
        // for; a second one in the same statement starts at its own name.
        const from = index === 0 ? start : declaration.getStart(parsed);
        add(declaration.name.text, from, initialiserEnd(declaration, parsed));
      });
    }
  });
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
