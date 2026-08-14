// A small, dependency-free reader for `prisma/schema.prisma`.
//
// The kernel schema task (`tasks/backlog.yaml#kernel-schema-base`) produces a
// schema, not executable logic, so its assertions can only be pinned
// structurally. `@prisma/internals` (the package exposing `getDMMF`) is not a
// dependency of this repository and pulling one in to read four constraints
// would be a heavier change than the constraints themselves, so the schema is
// parsed here.
//
// What is parsed is deliberately shallow — blocks, fields, optionality,
// attributes — because that is all the assertions need. Anything it cannot
// understand is surfaced rather than dropped: `parseSchema` records unparsed
// statements so a test can fail loudly instead of quietly checking nothing.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The one schema file in the repository. */
export const SCHEMA_PATH = path.join(repoRoot, "prisma", "schema.prisma");

/** The migrations directory named in the task's `produces`. */
export const MIGRATIONS_DIR = path.join(repoRoot, "prisma", "migrations");

export type BlockKind = "model" | "view" | "type" | "enum" | "datasource" | "generator";

export interface PrismaAttribute {
  /** `unique` for `@unique` and for `@@unique`; `db.Decimal` for `@db.Decimal(12, 2)`. */
  name: string;
  /** Everything between the outermost parentheses, or "" when there are none. */
  args: string;
  /** Identifiers of the first bracketed list in `args` — `[legalEntityId, regimeId]`. */
  fields: string[];
  raw: string;
}

export interface PrismaField {
  name: string;
  /** The base type with `?` and `[]` stripped: `String`, `Direction`, `Person`. */
  type: string;
  /** True for `Type?` — the nullability the direction assertion turns on. */
  optional: boolean;
  /** True for `Type[]`. */
  list: boolean;
  attributes: PrismaAttribute[];
  line: number;
  raw: string;
}

export interface PrismaBlock {
  kind: BlockKind;
  name: string;
  line: number;
  /** Fields, for a `model`, `view` or `type` block. */
  fields: PrismaField[];
  /** Values, for an `enum` block. */
  values: string[];
  /** Block-level attributes: `@@unique`, `@@id`, `@@index`, `@@map`. */
  attributes: PrismaAttribute[];
  /** Statements inside the block that could not be classified. */
  unparsed: string[];
}

export interface PrismaSchema {
  source: string;
  blocks: PrismaBlock[];
  /** `model` and `view` blocks — both carry persisted columns. */
  models: PrismaBlock[];
  enums: PrismaBlock[];
  /** Statements inside blocks that the parser did not understand. */
  unparsed: string[];
}

/** Strips `//` and `///` comments while leaving string literals and line count intact. */
function stripComments(source: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += source[i + 1] ?? "";
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

interface Depths {
  brace: number;
  paren: number;
}

/** Counts bracket depth changes on a line, ignoring anything inside a string. */
function depthDelta(line: string): Depths {
  const delta: Depths = { brace: 0, paren: 0 };
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") delta.brace += 1;
    else if (ch === "}") delta.brace -= 1;
    else if (ch === "(" || ch === "[") delta.paren += 1;
    else if (ch === ")" || ch === "]") delta.paren -= 1;
  }
  return delta;
}

/** The identifiers of a bracketed list: `[a, b(sort: Desc)]` -> `["a", "b"]`. */
function listIdentifiers(args: string): string[] {
  const start = args.indexOf("[");
  if (start === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = start; i < args.length; i += 1) {
    if (args[i] === "[") depth += 1;
    else if (args[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  return args
    .slice(start + 1, end)
    .split(",")
    .map((part) => /[A-Za-z_]\w*/.exec(part)?.[0] ?? "")
    .filter((name) => name !== "");
}

function parseAttribute(raw: string): PrismaAttribute {
  const withoutAt = raw.replace(/^@+/, "");
  const name = /^[\w.]+/.exec(withoutAt)?.[0] ?? withoutAt;
  const open = withoutAt.indexOf("(");
  const args = open === -1 ? "" : withoutAt.slice(open + 1, withoutAt.lastIndexOf(")"));
  return { name, args, fields: listIdentifiers(args), raw };
}

/** Splits a trailing attribute string on top-level `@`, respecting strings and brackets. */
function parseAttributes(rest: string): PrismaAttribute[] {
  const attributes: PrismaAttribute[] = [];
  let i = 0;
  while (i < rest.length) {
    if (rest[i] !== "@") {
      i += 1;
      continue;
    }
    let j = i + 1;
    let depth = 0;
    let inString = false;
    while (j < rest.length) {
      const ch = rest[j];
      if (inString) {
        if (ch === "\\") j += 1;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "(" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "]") depth -= 1;
      else if (ch === "@" && depth === 0) break;
      j += 1;
    }
    attributes.push(parseAttribute(rest.slice(i, j).trim()));
    i = j;
  }
  return attributes;
}

const BLOCK_HEADER = /^\s*(model|view|type|enum|datasource|generator)\s+([A-Za-z_]\w*)\s*\{/;
const FIELD = /^(\w+)\s+(Unsupported\(\s*"[^"]*"\s*\)|[\w.]+)(\[\])?(\?)?\s*(.*)$/s;

/** Joins the statements of a block, merging lines while a bracket is still open. */
function statementsOf(lines: { text: string; line: number }[]): { text: string; line: number }[] {
  const statements: { text: string; line: number }[] = [];
  let buffer = "";
  let bufferLine = 0;
  let open = 0;
  for (const { text, line } of lines) {
    const trimmed = text.trim();
    if (trimmed === "" && open === 0) continue;
    if (buffer === "") bufferLine = line;
    buffer = buffer === "" ? trimmed : `${buffer} ${trimmed}`;
    open += depthDelta(trimmed).paren;
    if (open <= 0) {
      statements.push({ text: buffer, line: bufferLine });
      buffer = "";
      open = 0;
    }
  }
  if (buffer !== "") statements.push({ text: buffer, line: bufferLine });
  return statements;
}

export function parseSchema(source: string): PrismaSchema {
  const lines = stripComments(source).split("\n");
  const blocks: PrismaBlock[] = [];
  const unparsed: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const header = BLOCK_HEADER.exec(lines[i]);
    if (header === null) continue;

    const kind = header[1] as BlockKind;
    const block: PrismaBlock = {
      kind,
      name: header[2],
      line: i + 1,
      fields: [],
      values: [],
      attributes: [],
      unparsed: [],
    };

    // Collect the body, tracking brace depth so a nested `{` cannot end it early.
    let depth = depthDelta(lines[i]).brace;
    const body: { text: string; line: number }[] = [];
    let j = i + 1;
    for (; j < lines.length && depth > 0; j += 1) {
      const delta = depthDelta(lines[j]).brace;
      if (depth + delta <= 0) {
        const closing = lines[j].replace(/}\s*$/, "");
        if (closing.trim() !== "") body.push({ text: closing, line: j + 1 });
        depth = 0;
        break;
      }
      depth += delta;
      body.push({ text: lines[j], line: j + 1 });
    }

    for (const statement of statementsOf(body)) {
      const { text, line } = statement;
      if (text.startsWith("@@")) {
        block.attributes.push(parseAttribute(text));
        continue;
      }
      if (kind === "enum") {
        const value = /^(\w+)/.exec(text)?.[1];
        if (value === undefined) {
          block.unparsed.push(text);
          unparsed.push(`${block.name}: ${text}`);
        } else {
          block.values.push(value);
        }
        continue;
      }
      if (kind === "datasource" || kind === "generator") continue;
      const field = FIELD.exec(text);
      if (field === null) {
        block.unparsed.push(text);
        unparsed.push(`${block.name}: ${text}`);
        continue;
      }
      block.fields.push({
        name: field[1],
        type: field[2],
        list: field[3] !== undefined,
        optional: field[4] !== undefined,
        attributes: parseAttributes(field[5] ?? ""),
        line,
        raw: text,
      });
    }

    blocks.push(block);
    i = j;
  }

  return {
    source,
    blocks,
    models: blocks.filter((block) => block.kind === "model" || block.kind === "view"),
    enums: blocks.filter((block) => block.kind === "enum"),
    unparsed,
  };
}

export function loadSchema(file: string = SCHEMA_PATH): PrismaSchema {
  if (!existsSync(file)) {
    throw new Error(`${file} does not exist — there is no schema to check`);
  }
  const source = readFileSync(file, "utf8");
  if (source.trim() === "") {
    throw new Error(`${file} is empty — there is no schema to check`);
  }
  return parseSchema(source);
}

// ------------------------------------------------------------------ lookups --

/** A model or view by exact name. */
export function modelNamed(schema: PrismaSchema, name: string): PrismaBlock | undefined {
  return schema.models.find((block) => block.name === name);
}

export function enumNamed(schema: PrismaSchema, name: string): PrismaBlock | undefined {
  return schema.enums.find((block) => block.name === name);
}

export function fieldNamed(block: PrismaBlock, name: string): PrismaField | undefined {
  return block.fields.find((field) => field.name === name);
}

/** Every field in the schema, tagged with the model it belongs to. */
export function everyField(schema: PrismaSchema): { model: PrismaBlock; field: PrismaField }[] {
  return schema.models.flatMap((model) => model.fields.map((field) => ({ model, field })));
}

export function hasAttribute(field: PrismaField, name: string): boolean {
  return field.attributes.some((attribute) => attribute.name === name);
}

export function blockAttributes(block: PrismaBlock, name: string): PrismaAttribute[] {
  return block.attributes.filter((attribute) => attribute.name === name);
}

/**
 * Case and separator insensitive comparison key, so `CORPORATE_TAX`,
 * `corporate_tax` and `CorporateTax` are one value. Prisma enum values are
 * conventionally written in several cases and the spec does not fix one.
 */
export function normalise(name: string): string {
  return name.replace(/[_\-\s]/g, "").toLowerCase();
}

export function normalisedValues(block: PrismaBlock): string[] {
  return block.values.map(normalise).sort();
}

/** `[a, b]` and `[b, a]` are the same constraint. */
export function sameFieldSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((name, index) => name === sortedRight[index]);
}

/** `Model.field` locations, for failure messages that name the offender. */
export function locate(model: PrismaBlock, field: PrismaField): string {
  return `${model.name}.${field.name} (line ${field.line}): ${field.raw}`;
}
