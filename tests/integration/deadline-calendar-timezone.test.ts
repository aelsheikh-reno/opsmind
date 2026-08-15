// The three-step backfill in
//   prisma/migrations/20260815090000_deadline_calendar_timezone/migration.sql
// against a real PostgreSQL, populated and empty.
//
// WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST. There is nothing here to
// substitute a port for. What is being asserted is what PostgreSQL does with
// this SQL — that the UPDATE joins the map to the right rows, that the DO block
// raises rather than falling through, that SET NOT NULL then succeeds. A fake
// database would assert what its own author believed the SQL means, which is
// the belief under test.
//
// WHEN IT SKIPS, AND WHY THAT IS SAID OUT LOUD. It runs only when DATABASE_URL
// is set. It was NOT executed on the machine that wrote it — that machine has
// no PostgreSQL, no Docker and no local server — so its first real run is CI,
// where .github/workflows/gates.yml starts postgres:16 and exports the URL. A
// skipped run is reported as skipped, never as passed: the describe carries the
// reason in its own title and a warning is printed when the suite loads.
//
// NOTHING IS PERSISTED. Every case runs inside one interactive transaction that
// ends by rolling back — DDL is transactional in PostgreSQL, so the scratch
// schema, its tables and its rows vanish with it. No DROP is issued and no
// existing table is touched: the migration's unqualified names resolve through
// a search_path pointed at the scratch schema.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATION = fileURLToPath(
  new URL(
    "../../prisma/migrations/20260815090000_deadline_calendar_timezone/migration.sql",
    import.meta.url,
  ),
);

const SCHEMA = "opsmind_migration_scratch";

/** The map the migration states. Written out again here, from the task, not read back from it. */
const ZONES: Record<string, string> = {
  AE: "Asia/Dubai",
  EG: "Africa/Cairo",
  SA: "Asia/Riyadh",
  KW: "Asia/Kuwait",
  BH: "Asia/Bahrain",
};

/** Only what this file asks of a client, so no Prisma type is imported here. */
interface Tx {
  $executeRawUnsafe(query: string): Promise<number>;
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

// ------------------------------------------------------------- the SQL file --

/**
 * The migration split into statements.
 *
 * `prisma migrate deploy` sends the file whole; a Prisma raw call takes one
 * statement at a time, so the file is split here. Dollar-quoted blocks, line
 * comments and string literals are respected — a naive split on ";" would cut
 * the DO block in half at its first internal statement and then report a syntax
 * error that has nothing to do with the migration.
 */
function statements(sql: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let index = 0;
  let tag: string | null = null;

  while (index < sql.length) {
    const rest = sql.slice(index);
    if (tag !== null) {
      if (rest.startsWith(tag)) {
        current += tag;
        index += tag.length;
        tag = null;
      } else {
        current += sql[index];
        index += 1;
      }
      continue;
    }
    const opening = /^\$[A-Za-z_]*\$/.exec(rest);
    if (opening !== null) {
      tag = opening[0];
      current += tag;
      index += tag.length;
      continue;
    }
    if (sql[index] === "'") {
      const close = /'(?:[^']|'')*'/.exec(rest);
      const literal = close === null ? rest : close[0];
      current += literal;
      index += literal.length;
      continue;
    }
    if (rest.startsWith("--")) {
      const newline = sql.indexOf("\n", index);
      const stop = newline === -1 ? sql.length : newline;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }
    if (sql[index] === ";") {
      chunks.push(current);
      current = "";
      index += 1;
      continue;
    }
    current += sql[index];
    index += 1;
  }
  chunks.push(current);

  const executable = (chunk: string): boolean =>
    chunk
      .split("\n")
      .some((line) => line.trim() !== "" && !line.trim().startsWith("--"));
  return chunks.map((chunk) => chunk.trim()).filter(executable);
}

// The one thing here that needs no database, and the non-vacuity guard for
// everything below: if the splitter found nothing, every case that "applies the
// migration" would apply an empty list and assert against an untouched table.
describe("the migration file this suite executes", () => {
  it("is the four statements the three steps are made of", () => {
    // Add the column nullable, backfill it, abort on anything unmapped, then
    // SET NOT NULL. One file, because a migration is atomic.
    const parts = statements(readFileSync(MIGRATION, "utf8"));
    expect(parts.length, `statements found: ${parts.length}`).toBe(4);
    expect(parts[0]).toMatch(/ADD COLUMN "timeZone" TEXT\s*$/);
    expect(parts[1]).toMatch(/^UPDATE "BusinessCalendar"/m);
    expect(parts[2]).toMatch(/RAISE EXCEPTION/);
    expect(parts[3]).toMatch(/SET NOT NULL\s*$/);
  });
});

// -------------------------------------------------------------- the database --

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const skipped = DATABASE_URL === "";

if (skipped) {
  console.warn(
    "\n  SKIPPED: tests/integration/deadline-calendar-timezone.test.ts needs a PostgreSQL.\n" +
      "  DATABASE_URL is not set, so the timeZone backfill was NOT exercised by this run.\n" +
      "  CI sets it (.github/workflows/gates.yml); a green run here does not cover it.\n",
  );
}

const title = skipped
  ? "the timeZone backfill (SKIPPED — DATABASE_URL is unset, so nothing below ran)"
  : "the timeZone backfill";

class Rollback extends Error {}

/**
 * Runs `work` against a pre-migration BusinessCalendar seeded with one calendar
 * per entry of `codes`, then rolls everything back. A null entry is a calendar
 * whose jurisdictionId matches no Jurisdiction row.
 */
async function onScratchDatabase(
  codes: readonly (string | null)[],
  work: (tx: Tx) => Promise<void>,
): Promise<void> {
  const { db } = await import("@/lib/db");
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${SCHEMA}"`);
        await tx.$executeRawUnsafe(
          `CREATE TABLE "Jurisdiction" (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL)`,
        );
        // No foreign key on "jurisdictionId", deliberately: the orphan case the
        // migration's LEFT JOIN exists for is unrepresentable with one, and an
        // orphan is exactly the row that must be reported by code rather than
        // dropped from the check and left to fail at SET NOT NULL.
        await tx.$executeRawUnsafe(
          `CREATE TABLE "BusinessCalendar" (id TEXT PRIMARY KEY, "jurisdictionId" TEXT NOT NULL UNIQUE, "weekendMask" INTEGER[] NOT NULL)`,
        );
        for (const [position, code] of codes.entries()) {
          const jurisdictionId = code === null ? `orphan-${position}` : `jur-${code}`;
          if (code !== null) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "Jurisdiction" (id, code, name) VALUES ('${jurisdictionId}', '${code}', 'jurisdiction ${code}')`,
            );
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO "BusinessCalendar" (id, "jurisdictionId", "weekendMask") ` +
              `VALUES ('cal-${position}', '${jurisdictionId}', ARRAY[5, 6])`,
          );
        }
        for (const statement of statements(readFileSync(MIGRATION, "utf8"))) {
          await tx.$executeRawUnsafe(statement);
        }
        await work(tx);
        throw new Rollback("the case passed; undo everything it wrote");
      },
      { timeout: 20_000, maxWait: 10_000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

/** The error the migration raised, or null when it did not raise one. */
async function failureFrom(codes: readonly (string | null)[]): Promise<string | null> {
  return onScratchDatabase(codes, async () => undefined).then(
    () => null,
    (error: unknown) => String(error),
  );
}

const nullability = async (tx: Tx): Promise<string | undefined> => {
  const rows = await tx.$queryRawUnsafe<{ is_nullable: string }[]>(
    `SELECT is_nullable FROM information_schema.columns WHERE table_schema = '${SCHEMA}' ` +
      `AND table_name = 'BusinessCalendar' AND column_name = 'timeZone'`,
  );
  return rows[0]?.is_nullable;
};

const suite = skipped ? describe.skip : describe;

suite(title, () => {
  it(
    "fills every mapped jurisdiction with the zone the map names",
    async () => {
      // The whole point of step 2. A row left on the wrong zone computes its
      // civil date on the wrong day, every day, silently.
      await onScratchDatabase(Object.keys(ZONES), async (tx) => {
        const rows = await tx.$queryRawUnsafe<{ code: string; timeZone: string }[]>(
          `SELECT j.code, c."timeZone" FROM "BusinessCalendar" c ` +
            `JOIN "Jurisdiction" j ON j.id = c."jurisdictionId"`,
        );
        expect(Object.fromEntries(rows.map((row) => [row.code, row.timeZone]))).toEqual(ZONES);
      });
    },
    30_000,
  );

  it(
    "leaves the column NOT NULL on a table that had rows",
    async () => {
      // The backfill is only half of it: a nullable column is one a later
      // insert can leave empty, which is the state this field exists to refuse.
      await onScratchDatabase(Object.keys(ZONES), async (tx) => {
        expect(await nullability(tx)).toBe("NO");
      });
    },
    30_000,
  );

  it(
    "is a no-op on an empty table, and still ends NOT NULL",
    async () => {
      // The path CI's `prisma migrate deploy` takes on every run. Steps 2 and 3
      // must find nothing and say nothing rather than raising on zero rows.
      await onScratchDatabase([], async (tx) => {
        expect(await nullability(tx)).toBe("NO");
        const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT count(*) AS count FROM "BusinessCalendar"`,
        );
        expect(Number(rows[0]?.count ?? -1)).toBe(0);
      });
    },
    30_000,
  );

  it(
    "aborts, naming the jurisdiction, when the map has no zone for it",
    async () => {
      // CLAUDE.md rule 8. GB is a jurisdiction this build does not serve today
      // and could hold a calendar tomorrow; the migration must stop and say so
      // rather than invent a zone for it or fail on a constraint that names
      // only a column.
      const failure = await failureFrom([...Object.keys(ZONES), "GB"]);
      expect(failure, "an unmapped jurisdiction was accepted").not.toBeNull();
      expect(failure).toMatch(/GB/);
      expect(failure).toMatch(/timeZone/);
    },
    30_000,
  );

  it(
    "aborts, naming the row, when a calendar's jurisdiction is missing entirely",
    async () => {
      // What the LEFT JOIN is for. An inner join would drop this row from the
      // check, and the failure would arrive at SET NOT NULL as a constraint
      // violation naming no jurisdiction at all.
      const failure = await failureFrom([null]);
      expect(failure, "a calendar with no jurisdiction row was accepted").not.toBeNull();
      expect(failure).toMatch(/orphan-0/);
      expect(failure).toMatch(/no Jurisdiction row/);
    },
    30_000,
  );
});
