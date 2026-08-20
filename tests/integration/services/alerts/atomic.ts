// Plumbing for tasks/backlog.yaml#service-alerts-atomic-event, shared by
// repository.test.ts (assertion 1) and atomic-change.test.ts (assertion 2), so
// the two halves of one node's claim are written once and found together.
//
// WHAT ITS AUTHOR READ. The node and its note; docs/architecture/data-model.md's
// Alert and AlertEvent cards; docs/architecture/lessons.md; the merged public
// surface `lib/services/alerts/index.ts` for its exported TYPES; and the diff of
// lib/ under review, which is the change these cases are commissioned against.
// It read no working-tree implementation body — every expected value below comes
// from the cards and the node's own words, never from watching the code answer.
//
// ---------------------------------------------------------------------------
// THE WRITER IS DISCOVERED, NOT NAMED, AND HERE IS THE ARGUMENT.
//
// data-model.md requires that a state change and the event recording it are one
// write; it names no function, and neither does flows-alerting.md, ADR-020,
// ADR-039 or the node. `applyAlertChange` is the implementer's spelling and
// nothing fixes it. lessons.md — "assert the distinction, not the spelling" —
// says to pin a literal only where a document does, so this file derives the
// writer from a CRITERION instead: it is the member of the store beyond the
// seven that repository.test.ts's own CONTRACT names.
//
// That criterion also fails in the right direction. If the store carries no such
// member the failure says the node produces one; if it carries two, the failure
// says which, and asks for a case naming the one that writes atomically —
// rather than a list written from memory going quietly stale (lessons.md,
// "derive a list from its criterion").
// ---------------------------------------------------------------------------
import type { AlertRecord, AlertState } from "@/lib/services/alerts";

/** The client the repositories under test hold, typed without importing it. */
type Database = (typeof import("@/lib/db"))["db"];

/**
 * The AlertEvent card's columns MINUS the id of the alert it hangs off.
 *
 * Declared here rather than imported, on components-services.md's terms and
 * lessons.md's ("a reusable component must not import its caller" — the same
 * discipline applied the other way): a structural disagreement with the store's
 * own parameter type should be a red `npm run typecheck`, not a surprise at run
 * time. The alert id is absent because the card ties an event to the alert it
 * happened to, and if the row and the event are one write then the id is the
 * WRITER'S to assign — a caller has nothing to supply it from.
 */
export interface AlertChangeLike {
  at: Date;
  kind:
    | "raised"
    | "reasserted"
    | "severity_raised"
    | "stale_marked"
    | "stale_cleared"
    | "acknowledged"
    | "suppressed"
    | "unsuppressed"
    | "resolved";
  /** Null where the kind changes no state — a reassert, or a stale flag. */
  fromState: AlertState | null;
  toState: AlertState | null;
  /** Null means the source or the engine did it. */
  actor: string | null;
  runId: string | null;
  reason: string | null;
}

/** What the store hands back for a written row. Only `id` is depended on here;
 *  the columns are asserted against the card by the cases themselves. */
export interface StoredAlertLike {
  id: string;
  [column: string]: unknown;
}

export type AtomicWrite = (record: AlertRecord, change: AlertChangeLike) => Promise<StoredAlertLike>;

/** Every function the store carries, sorted, read at call time. */
export function storeMembers(store: unknown): string[] {
  return Object.entries((store ?? {}) as Record<string, unknown>)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
    .sort();
}

/**
 * The store's atomic state-change writer, by the criterion in the header.
 *
 * `record` names the row after the change and `change` names the event, in that
 * order, because that is the only order the two can be written in: the event
 * needs the id the row write returns, which is the node's own reason the pair
 * cannot simply be reversed.
 */
export function atomicWriter(store: unknown, contract: readonly string[]): { name: string; write: AtomicWrite } {
  const members = storeMembers(store);
  const extras = members.filter((name) => !contract.includes(name));

  if (extras.length === 0) {
    throw new Error(
      "lib/services/alerts/repository.ts's store carries no function beyond the ones this suite " +
        `already names (${contract.join(", ")}), so nothing on it writes an alert row and its ` +
        "AlertEvent as one unit. tasks/backlog.yaml#service-alerts-atomic-event produces exactly " +
        "that: 'An alert row and the event recording its change are written in one transaction'. " +
        `The store carries: ${members.join(", ") || "nothing"}.`,
    );
  }
  if (extras.length > 1) {
    throw new Error(
      `lib/services/alerts/repository.ts's store carries ${extras.length} functions beyond the ` +
        `suite's contract — ${extras.join(", ")} — so which of them writes the row and its event ` +
        "together is now ambiguous. This file identifies the atomic writer as 'the one the " +
        "contract does not name'; a second unnamed member wants a case that says which is which, " +
        "not a guess here.",
    );
  }

  const name = extras[0];
  const write: AtomicWrite = (record, change) => {
    const target = (store as Record<string, unknown>)[name];
    if (typeof target !== "function") {
      throw new Error(`the store's '${name}' is no longer a function; it carries: ${storeMembers(store).join(", ")}`);
    }
    return (target as (...args: unknown[]) => Promise<StoredAlertLike>).call(store, record, change);
  };
  return { name, write };
}

// ------------------------------------------------------- forcing the failure --

/** The constraint a case adds to make every AlertEvent write fail. Named, so a
 *  leak is identifiable in a database rather than anonymous. */
const FORCED = "opsmind_forced_alertevent_write_failure";

/**
 * The physical table behind the AlertEvent card, read from the catalogue, IN
 * THIS FILE'S OWN SCHEMA.
 *
 * Discovered rather than written down, because the mapping from a card to a
 * table name is the schema's to decide and this file is not entitled to assume
 * it. Compared as a WHOLE normalised token — lessons.md: `grep -qi alert` let a
 * repository declaring `AlertEvent` touch `Alert`, because every table here is a
 * prefix pair, and `Alert` must never be the table this returns.
 *
 * SCOPED TO ONE SCHEMA, AND THE TWO ENGINES ARE WHY. PGlite gives each file its
 * own database, so a catalogue sweep finds one `AlertEvent`; DATABASE_URL gives
 * the whole suite one database with a schema per file, so the same sweep finds
 * one per alerts file. Four, on #81 — and this function refused rather than
 * choosing, which is the only reason it was a red gate and not a poisoned
 * neighbour: the caller adds a `CHECK (false)` to whatever comes back, so an
 * arbitrary pick puts that constraint on ANOTHER FILE'S table and surfaces as
 * unrelated flakiness somewhere else in the suite.
 *
 * The schema comes from `integrationSchema`, the harness's own rule, so it
 * cannot drift from the schema this file was actually migrated into.
 */
export async function alertEventTable(db: Database, schema: string): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ schemaname: string; tablename: string }[]>(
    "SELECT schemaname, tablename FROM pg_tables WHERE schemaname = $1",
    schema,
  );
  const token = (name: string): string =>
    name
      .replace(/[^a-z0-9]+/gi, "")
      .toLowerCase()
      .replace(/s$/, "");
  const matches = rows.filter((row) => token(row.tablename) === "alertevent");
  if (matches.length !== 1) {
    // KEPT, and it is what caught the engine divergence in the first place.
    // Zero now means this file was not migrated into the schema it believes it
    // owns; more than one means a schema is not what isolates these files after
    // all. Either way the cases below would be making some other write fail, or
    // none — and a case that fails nothing proves nothing about a rollback.
    throw new Error(
      `${matches.length} tables in schema '${schema}' answer to the AlertEvent card, so the ` +
        "forced-failure cases cannot know which write to make fail — and a case that fails " +
        "nothing proves nothing about a rollback. Tables in that schema: " +
        `${rows.map((row) => row.tablename).join(", ") || "none"}`,
    );
  }
  return `"${matches[0].schemaname}"."${matches[0].tablename}"`;
}

/**
 * Runs `work` with every insert into AlertEvent refused by the ENGINE.
 *
 * A database-level `CHECK (false)` and not a stubbed store, deliberately. The
 * failure has to land where a real one would — at PostgreSQL, after the alert
 * upsert has already executed inside the transaction — because the claim under
 * test is that the engine unwinds a write it has already done. A store stubbed
 * to throw before touching the database would prove only that a thrown error
 * propagates, which was never in doubt.
 *
 * `schema` is this file's own, never the whole database. The constraint is a
 * DDL change on a server every other integration file shares under
 * DATABASE_URL, so the one thing it must never do is land on a table another
 * file is writing through.
 *
 * NOT VALID so it can be added while an alert's history already has rows in it:
 * existing rows go unchecked, and every new insert is refused. Dropped in
 * `finally`, so a failing case does not leave the constraint behind for the
 * cases after it.
 */
export async function withEventWritesRefused<T>(db: Database, schema: string, work: () => Promise<T>): Promise<T> {
  const table = await alertEventTable(db, schema);
  await db.$executeRawUnsafe(`ALTER TABLE ${table} ADD CONSTRAINT "${FORCED}" CHECK (false) NOT VALID`);
  try {
    return await work();
  } finally {
    // The refusal inside `work` may have dropped the connection — a measured
    // PGlite divergence, recorded in tests/integration/support/database.ts — so
    // the drop is issued on a connection that has been checked first.
    await db.$queryRawUnsafe("SELECT 1").catch(() => undefined);
    await db.$executeRawUnsafe(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS "${FORCED}"`);
  }
}
