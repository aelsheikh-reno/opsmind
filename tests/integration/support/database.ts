// The engine every repository integration test obtains, and the rule it obeys
// (ADR-038): DATABASE_URL when present, an in-process PGlite over a socket when
// not, and a failure naming why when neither can be had. Never a skip.
//
// The same `prisma migrate deploy` runs on both engines, so an engine that
// disagrees with production surfaces as a migration failure rather than as a
// silent behaviour difference. A test that passes on one and fails on the other
// is an engine-divergence finding, never a retry.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeEach } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The client the repositories under test hold, typed without importing it. */
type Database = (typeof import("@/lib/db"))["db"];

// 8.5 s per file to boot and migrate PGlite on 14 cores, 3.1 s against a server
// already running; the truncate is 46-155 ms and the teardown 33-54 ms with all
// six files at once. The bounds are ~14x and ~200x those (ADR-033).
const ENGINE_BUDGET_MS = 120_000;
const HOOK_BUDGET_MS = 30_000;

interface Engine {
  url: string;
  named: string;
  stop: () => Promise<void>;
}

/** Fails with the label rather than with a bare duration (ADR-033). */
async function withDeadline<T>(label: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not finish within ${ENGINE_BUDGET_MS}ms`)),
      ENGINE_BUDGET_MS,
    );
    timer.unref();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * PGlite behind a TCP socket, so Prisma reaches it through an ordinary
 * `postgresql://` URL — no driver adapter, no preview feature, no schema change.
 */
async function pgliteEngine(schema: string): Promise<Engine> {
  const [{ PGlite }, { PGLiteSocketServer }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite-socket"),
  ]);
  const pglite = await PGlite.create();
  const server = new PGLiteSocketServer({
    db: pglite,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 8,
  });
  await server.start();
  const address = server.getServerConn();
  return {
    url: `postgresql://postgres:postgres@${address}/postgres?schema=${schema}&connection_limit=1`,
    named: `an in-process PGlite on ${address}`,
    stop: async () => {
      await server.stop();
      await pglite.close();
    },
  };
}

/**
 * DATABASE_URL wins when it is set, and an unreachable one is a failure rather
 * than a reason to fall back: silently swapping engines is how a broken CI
 * database reads as green against something production never runs.
 */
async function resolveEngine(schema: string): Promise<Engine> {
  const configured = process.env.DATABASE_URL ?? "";
  if (configured !== "") {
    const url = new URL(configured);
    url.searchParams.set("schema", schema);
    return { url: url.toString(), named: `DATABASE_URL (${url.host}${url.pathname})`, stop: async () => {} };
  }
  try {
    return await pgliteEngine(schema);
  } catch (cause) {
    throw new Error(
      `No database engine for schema ${schema}: DATABASE_URL is unset and PGlite could not be ` +
        `started (${causeText(cause)}). A repository test never skips and never passes without an ` +
        "engine (ADR-038) — set DATABASE_URL, or install @electric-sql/pglite and " +
        "@electric-sql/pglite-socket.",
      { cause },
    );
  }
}

/** Whatever the failure carried, in one line, so the refusal names its cause. */
function causeText(cause: unknown): string {
  const parts = cause as { stderr?: string; stdout?: string; message?: string };
  const text = parts?.stderr || parts?.stdout || parts?.message || String(cause);
  return text.trim().split("\n").slice(-6).join(" | ");
}

/** The migrations production runs, on whichever engine answered. */
async function migrate(engine: Engine, schema: string): Promise<void> {
  try {
    await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
      cwd: REPO_ROOT,
      // The advisory lock is per DATABASE, and six files migrate six disjoint
      // schemas at once: on one shared PostgreSQL they would queue behind each
      // other and the last could exceed the lock's own acquisition timeout.
      env: { ...process.env, DATABASE_URL: engine.url, PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1" },
    });
  } catch (cause) {
    throw new Error(
      `prisma migrate deploy failed against ${engine.named} in schema ${schema}: ` +
        `${causeText(cause)}. The engine could not be prepared, so nothing below ran — this is a ` +
        "failure, not a skip (ADR-038).",
      { cause },
    );
  }
}

let current: Database | undefined;
let recoveries = 0;

/**
 * A MEASURED ENGINE DIVERGENCE (ADR-038). PGlite behind a socket drops the
 * connection on any error response, and multiplexes every connection onto one
 * backend, so the reconnected session re-prepares names the dead one still owns.
 */
async function afterARefusal(): Promise<void> {
  await current?.$queryRawUnsafe("SELECT 1").catch(async () => {
    // Only on the engine that dropped the connection, and only on the fresh one,
    // whose statement cache is empty. Numbered, because Prisma caches by text.
    await current?.$executeRawUnsafe(`DEALLOCATE ALL -- reconnect ${(recoveries += 1)}`);
  });
}

/**
 * A connection that is good again after the engine answered with an error.
 *
 * Exported as well as used by `refusalFrom` below, because a case may need the
 * recovery without the refusal being the thing it asserts on — a call whose
 * REJECTION is incidental and whose assertion is about the rows left behind.
 */
export { afterARefusal };

/** The message a refusal carried, and a connection that is good afterwards. */
export async function refusalFrom(work: Promise<unknown>): Promise<string> {
  const outcome = await work.then(
    () => null,
    (error: unknown) => String(error),
  );
  await afterARefusal();
  if (outcome === null) throw new Error("the call was accepted; a refusal was expected");
  return outcome;
}

/**
 * Obtains an engine, migrates a schema of this file's own, and hands back the
 * client the repositories hold. Registers the truncate and the teardown itself,
 * so a caller cannot forget either.
 */
export async function integrationDatabase(name: string): Promise<Database> {
  const schema = `itest_${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
  const engine = await withDeadline(`obtaining a database engine for ${schema}`, resolveEngine(schema));
  await withDeadline(`applying the migrations to ${schema}`, migrate(engine, schema));

  // A schema per test file, on both engines: files run in parallel, truncation
  // is not scoped to a transaction, and a shared schema would have them wiping
  // each other's rows — read afterwards as flakiness. It also keeps the suite
  // off the tables of whatever DATABASE_URL happens to name.
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = engine.url;
  const cache = globalThis as { db?: unknown };
  delete cache.db; // lib/db.ts caches its client here outside production
  const { db } = await import("@/lib/db");
  current = db;

  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = '${schema}' AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length === 0) {
    throw new Error(`${schema} carries no table after migration on ${engine.named}; refusing to test nothing.`);
  }
  const targets = tables.map((table) => `"${schema}"."${table.tablename}"`).join(", ");

  // Truncate, not a transaction rolled back: the repositories call the shared
  // client directly (CLAUDE.md rule 3), so there is no transaction handle to
  // route them through without changing lib/ to suit its tests.
  // Both bounds are per hook rather than global, so no other hook is relaxed.
  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${targets} RESTART IDENTITY CASCADE`);
  }, HOOK_BUDGET_MS);

  afterAll(async () => {
    await db.$disconnect();
    await engine.stop();
    delete cache.db;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }, HOOK_BUDGET_MS);

  return db;
}
