// Assertions 5 and 6 of tasks/backlog.yaml#service-alerts-raise, driven by the
// MERGED deadline monitor against a real engine and a real store (ADR-038).
//
//   5 "The deadline monitor's misconfiguration alerts are accepted verbatim —
//      an unconfigured policyId, raised again on every run — and produce one
//      open alert per subject rather than one per run"
//   6 "An alert raised on registration and the same fingerprint later reported
//      by a run are one alert throughout"
//
// WHY NOTHING HERE IS FAKED. The node's whole claim is that a call the merged
// module already makes now lands somewhere: "until this exists every one of
// those calls goes to nothing — an unwatched deadline type and a jurisdiction
// with no calendar are detected, correctly, and then discarded." A fake store
// or a hand-rolled caller would agree with itself and prove none of that. So
// `runDeadlineSweep` and `registerDeadline` are the merged functions, unmodified,
// `prismaDeadlineStore` is the real one, and the only thing constructed here is
// a CalendarSource — the Kernel's table, which this module reaches through a
// port and which no node has filled yet.
//
// Dedupe spans the two verbs deliberately (the node's note): registerDeadline
// raises through `raiseAlert` while the sweep reports the identical fingerprint
// through `reportRun`, and "tonight's sweep either confirms this alert or
// resolves it". If the verbs held separate identities the user would see the
// same breach twice — so every count below is BY FINGERPRINT, never by
// (sourceId, fingerprint): a raise filed under one source and a report under
// another is exactly the two rows this assertion forbids, and asking by the
// pair would hide it.
//
// WRITTEN FROM THE SPECIFICATION; the sources are listed at the top of engine.ts.
import { describe, expect, it } from "vitest";

import type { BusinessCalendar, DeadlineDeps, DeadlineInput } from "@/lib/modules/deadlines";

import { integrationDatabase } from "../../support/database";
import { alertCountFor, alertEngine, alertFor, areasOf, bag, SOURCE_ID } from "./engine";

// Order is load-bearing: integrationDatabase swaps DATABASE_URL and evicts the
// cached client, so everything reaching the database is imported AFTER it.
const db = await integrationDatabase("alerts_dedupe");
const engine = await alertEngine(db);
const deadlines = await import("@/lib/modules/deadlines");

const {
  fingerprintFor,
  MISSING_CALENDAR_POLICY,
  NO_THRESHOLD_POLICY,
  prismaDeadlineStore,
  registerDeadline,
  runDeadlineSweep,
} = deadlines;

const TENANT = "reno";

/** 2026-08-16 is a Sunday — the first working day of the Gulf week — at 10:00
 *  in Dubai, so the civil date is unambiguous and is not the UTC day's edge. */
const NOW = new Date("2026-08-16T06:00:00Z");

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Thursday, four working days out under a Sunday–Thursday week. */
const DUE = day("2026-08-20");
/** Friday: a real statutory date landing on a Gulf weekend. It is SURFACED,
 *  never shifted (calendar.ts; CLAUDE.md rule 9). */
const DUE_ON_FRIDAY = day("2026-08-21");

/** The Gulf working week: Friday and Saturday are the weekend. */
const gulf = (jurisdictionId: string): BusinessCalendar => ({
  jurisdictionId,
  weekendMask: [5, 6],
  holidays: [],
  timeZone: "Asia/Dubai",
});

/** The Kernel's calendars, behind the port the module reads them through. A
 *  jurisdiction missing from the list has NO calendar, which is the sweep's
 *  misconfiguration case and registerDeadline's refusal case. */
const calendarsFor = (present: readonly string[]) => ({
  forJurisdiction: (jurisdictionId: string) =>
    Promise.resolve(present.includes(jurisdictionId) ? gulf(jurisdictionId) : null),
});

let runCounter = 0;

function depsFor(present: readonly string[]): DeadlineDeps {
  return {
    tenant: TENANT,
    store: prismaDeadlineStore,
    calendars: calendarsFor(present),
    // The real engine, bound to the module's own port. No adapter: a
    // structural disagreement between the two halves is meant to be a red
    // typecheck rather than a surprise at 02:00.
    alerts: engine,
    now: () => NOW,
    runId: () => `run-${(runCounter += 1)}`,
  };
}

const registration = (over: Partial<DeadlineInput> = {}): DeadlineInput => ({
  entityType: "document",
  entityId: "doc-1",
  deadlineType: "visa-expiry",
  dueDate: DUE,
  jurisdictionId: "AE",
  ...over,
});

/** ThresholdTable is read by the port and never written by it, so it is seeded
 *  through `db` — the same convention the module's own repository test states. */
const threshold = (deadlineType: string, businessDaysBefore: number, severity: "minor" | "major") =>
  db.thresholdTable.create({ data: { deadlineType, businessDaysBefore, severity } });

/** The row, or a failure naming the call that should have produced it. */
async function stored(fingerprint: string, what: string) {
  const row = await alertFor(db, fingerprint);
  if (row === null) {
    const all = await db.alert.findMany({ select: { fingerprint: true, policyId: true } });
    throw new Error(
      `${what} raised no Alert row for ${fingerprint} (engine wired by ${engine.how}). ` +
        "The merged module made the call; this node is what makes it land. Rows present: " +
        (all.map((row) => `${row.policyId} ${row.fingerprint}`).join(" | ") || "none at all"),
    );
  }
  return row;
}

// --------------------------------------------------------------- assertion 5 --

describe("the deadline monitor's misconfiguration alerts: one open alert per subject, not one per run", () => {
  // Four registrations across three jurisdictions and two deadline types, with
  // NO ThresholdTable row for either type and NO calendar for KW. That is both
  // misconfigurations the module raises, at once, and both are raised again on
  // every run: the sweep is stateless by construction and "remembers nothing
  // about yesterday".
  const seed = async () => {
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "doc-1", jurisdictionId: "AE" }));
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "doc-2", jurisdictionId: "EG" }));
    await prismaDeadlineStore.upsertRegistration(registration({ entityId: "doc-4", jurisdictionId: "KW" }));
    await prismaDeadlineStore.upsertRegistration(
      registration({ entityId: "doc-3", deadlineType: "trade-licence", jurisdictionId: "AE" }),
    );
  };

  const sweep = () => runDeadlineSweep(depsFor(["AE", "EG"]));

  const visaTypeAlert = () => fingerprintFor(TENANT, "deadline-type", "visa-expiry", NO_THRESHOLD_POLICY);
  const licenceTypeAlert = () => fingerprintFor(TENANT, "deadline-type", "trade-licence", NO_THRESHOLD_POLICY);
  const missingCalendarAlert = () => fingerprintFor(TENANT, "jurisdiction", "KW", MISSING_CALENDAR_POLICY);

  it("lands both misconfigurations the first run detects, rather than discarding them", async () => {
    // The floor, and the exact sentence the node was written for. The module
    // detects these correctly today and they go nowhere.
    await seed();
    const report = await sweep();

    expect(report.unconfiguredTypes.sort()).toEqual(["trade-licence", "visa-expiry"]);
    expect((await stored(visaTypeAlert(), "the sweep")).policyId).toBe(NO_THRESHOLD_POLICY);
    expect((await stored(licenceTypeAlert(), "the sweep")).policyId).toBe(NO_THRESHOLD_POLICY);
    expect((await stored(missingCalendarAlert(), "the sweep")).policyId).toBe(MISSING_CALENDAR_POLICY);
    expect(await db.alert.count()).toBe(3);
  });

  it("does not grow the alert count when the same run is repeated, twice or three times", async () => {
    // THE ASSERTION. "Raised again on every run" is the input; "one open alert
    // per subject rather than one per run" is the required output. A count that
    // grows is 1,095 rows a year for one missing ThresholdTable row.
    await seed();

    await sweep();
    const afterOne = await db.alert.count();
    await sweep();
    const afterTwo = await db.alert.count();
    await sweep();
    const afterThree = await db.alert.count();

    expect(afterOne).toBe(3);
    expect(afterTwo).toBe(afterOne);
    expect(afterThree).toBe(afterOne);
    expect(await alertCountFor(db, visaTypeAlert())).toBe(1);
    expect(await alertCountFor(db, licenceTypeAlert())).toBe(1);
    expect(await alertCountFor(db, missingCalendarAlert())).toBe(1);
  });

  it("leaves all three OPEN after three runs, because nothing has fixed them", async () => {
    // "one OPEN alert per subject". Nothing in these three runs configured a
    // threshold or supplied a calendar, so an alert that closed would be the
    // engine deciding a compliance gap was over on its own.
    //
    // The sweep also calls reportRun on each run. At this node that verb
    // records the run and resolves nothing — resolution by absence is
    // service-alerts-report-run, whose note records that whether a completed
    // report may resolve an alert raised OUT of band is still Ahmed's to
    // settle. If this case ever goes red, that is the question arriving, and it
    // is a decision to record rather than a test to relax.
    await seed();
    await sweep();
    await sweep();
    await sweep();

    for (const fingerprint of [visaTypeAlert(), licenceTypeAlert(), missingCalendarAlert()]) {
      const row = await stored(fingerprint, "three sweeps");
      expect(row.state, `${fingerprint} is ${row.state}`).toBe("firing");
      expect(row.resolvedAt).toBeNull();
    }
  });

  it("accepts the unconfigured policyId verbatim, at the severity the source chose", async () => {
    // "accepted verbatim". The engine holds no rule book: neither policy below
    // appears in any configuration, and refusing one would mean the condition
    // is detected and then discarded — the failure the caller exists to
    // prevent, moved one layer down (ADR-040, data-model.md Alert.policyId).
    await seed();
    await sweep();

    expect((await stored(visaTypeAlert(), "the sweep")).policyId).toBe(NO_THRESHOLD_POLICY);
    expect((await stored(missingCalendarAlert(), "the sweep")).policyId).toBe(MISSING_CALENDAR_POLICY);
    // `highestSeverity()` is what the module sends for a misconfiguration, and
    // the engine records severity and never judges it.
    expect((await stored(visaTypeAlert(), "the sweep")).severity).toBe(deadlines.highestSeverity());
  });

  it("scopes the one type alert by every jurisdiction it affects, and the calendar alert by one", async () => {
    // ADR-044: the areas name where the IMPACT is, not where the fault is. One
    // missing ThresholdTable row is ONE global fault leaving `visa-expiry`
    // unscorable in AE, EG and KW at once — so one alert with three areas,
    // never three alerts. A missing calendar is the other shape: fault and
    // impact coincide, and it names one.
    await seed();
    await sweep();

    expect(areasOf(await stored(visaTypeAlert(), "the sweep"))).toEqual(new Set(["AE", "EG", "KW"]));
    expect(areasOf(await stored(licenceTypeAlert(), "the sweep"))).toEqual(new Set(["AE"]));
    expect(areasOf(await stored(missingCalendarAlert(), "the sweep"))).toEqual(new Set(["KW"]));
  });

  it("keeps the caller's own diagnostic bag whole, and its scope keys out of the scoping", async () => {
    // The missing-calendar context the merged module sends literally contains
    // `jurisdictionId`. ADR-040: the engine must never dig a scope out of
    // `context`, and a caller spelling the key differently must not lose its
    // scoping silently. Here the argument and the bag agree, so the case that
    // discriminates is the TYPE alert: its bag names `deadlineType` and carries
    // no area at all, while the alert is scoped by three.
    await seed();
    await sweep();

    expect((await stored(missingCalendarAlert(), "the sweep")).context).toEqual({
      jurisdictionId: "KW",
      unscoredRegistrations: 1,
      runId: expect.any(String),
    });
    expect((await stored(visaTypeAlert(), "the sweep")).context).toEqual({
      deadlineType: "visa-expiry",
      registrations: 3,
      runId: expect.any(String),
    });
  });

  it("carries the LATEST run's bag on the one row, rather than the first run's", async () => {
    // One row across runs is only useful if it says what tonight found. The
    // module puts its runId in the bag, so the stored bag names the last run
    // that carried the alert — which is also what `lastSeenAt` means.
    await seed();
    const first = await sweep();
    await engine.tick();
    const second = await sweep();

    expect(second.runId).not.toBe(first.runId);
    const row = await stored(visaTypeAlert(), "two sweeps");
    expect(bag(row).runId).toBe(second.runId);
    expect(await alertCountFor(db, visaTypeAlert())).toBe(1);
  });

  it("keeps the first sighting across runs, so an old misconfiguration does not read as new", async () => {
    await seed();
    await sweep();
    const first = await stored(visaTypeAlert(), "the first sweep");
    await engine.tick();
    await sweep();
    const second = await stored(visaTypeAlert(), "the second sweep");

    expect(second.id).toBe(first.id);
    expect(second.firstSeenAt).toEqual(first.firstSeenAt);
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });

  it("does not take an area incomplete, because the engine accepted every raise", async () => {
    // ADR-040's derived constraint read backwards, and the cost the node's
    // corrected note prices: a throw is survivable, but "an area whose alert
    // could not be raised was NOT fully checked", so it is reported incomplete
    // and nothing in it resolves for the night. An engine that rejects a call
    // it must accept is visible right here.
    await seed();
    const report = await sweep();

    for (const scope of report.scopes) {
      expect(scope.reason ?? "", `${scope.area}: ${scope.reason}`).not.toContain("could not be raised");
    }
    const ae = report.scopes.find((scope) => scope.area === "AE");
    expect(ae?.complete, "AE went incomplete, which only an engine failure can cause here").toBe(true);
  });
});

// --------------------------------------------------------------- assertion 6 --

describe("an alert raised on registration and the same fingerprint reported by a run are one alert", () => {
  const FP = () => fingerprintFor(TENANT, "document", "doc-1", "visa-expiry");

  /** A configured type, breaching at four business days out. */
  const seed = async () => {
    await threshold("visa-expiry", 10, "minor");
  };

  const register = (over: Partial<DeadlineInput> = {}) =>
    registerDeadline(registration(over), depsFor(["AE"]));

  it("raises on registration, through raiseAlert, and the alert lands", async () => {
    // Evaluate-on-register: "a document ingested when it is already inside a
    // threshold is alerted on NOW, not left for tonight's sweep." The floor for
    // everything below, and the half that goes out through raiseAlert.
    await seed();
    const result = await register();

    expect(result.verdict).toEqual({ status: "breached", severity: "minor" });
    const row = await stored(FP(), "registerDeadline");
    expect(row.state).toBe("firing");
    expect(row.severity).toBe("minor");
    expect(row.policyId).toBe("visa-expiry");
    expect(areasOf(row)).toEqual(new Set(["AE"]));
    expect(await db.alert.count()).toBe(1);
  });

  it("stays ONE alert once a run reports the identical fingerprint", async () => {
    // THE ASSERTION. The module's own comment: "The fingerprint is the same
    // either way, so tonight's sweep either confirms this alert or resolves
    // it." If the two verbs held separate identities the user would see one
    // breach twice — which is why the count below is by fingerprint and the
    // total is checked as well.
    await seed();
    await register();
    const raised = await stored(FP(), "registerDeadline");

    await engine.tick();
    const report = await runDeadlineSweep(depsFor(["AE"]));

    // Non-vacuous: the run really did carry this fingerprint to the engine.
    expect(report.breaches.map((breach) => breach.fingerprint)).toContain(FP());
    expect(report.scopes).toEqual([expect.objectContaining({ area: "AE", complete: true })]);

    const afterRun = await stored(FP(), "the sweep");
    expect(await alertCountFor(db, FP())).toBe(1);
    expect(await db.alert.count()).toBe(1);
    expect(afterRun.id).toBe(raised.id);
    expect(afterRun.firstSeenAt).toEqual(raised.firstSeenAt);
    expect(afterRun.state).toBe("firing");
    expect(afterRun.resolvedAt).toBeNull();
  });

  it("stays one alert across a registration, two runs and a re-registration", async () => {
    // Every path that carries this fingerprint, in the order a real day
    // produces them: ingested, swept, swept again, re-ingested when its date
    // was corrected. One fact, one row, throughout.
    await seed();
    await register();
    await engine.tick();
    await runDeadlineSweep(depsFor(["AE"]));
    await engine.tick();
    await runDeadlineSweep(depsFor(["AE"]));
    await engine.tick();
    await register();

    expect(await alertCountFor(db, FP())).toBe(1);
    expect(await db.alert.count()).toBe(1);
    expect((await stored(FP(), "the whole day")).state).toBe("firing");
  });

  it("stays one alert when the run's report is handed to the engine directly", async () => {
    // The same claim without the module in the way, so a failure here names the
    // engine rather than the caller. `reportRun` carries the source id
    // explicitly and `raiseAlert` does not, which is precisely where a second
    // identity for one fact would be created.
    await seed();
    await register();
    await engine.tick();
    await engine.reportRun(SOURCE_ID, "run-direct", [{ fingerprint: FP(), severity: "minor", area: "AE" }], [
      { area: "AE", complete: true },
    ]);

    expect(await alertCountFor(db, FP())).toBe(1);
    expect(await db.alert.count()).toBe(1);
  });

  it("raises the severity in place when a re-registration finds a worse window", async () => {
    // Assertion 2 through the real caller. Rows of {10 -> minor, 30 -> major}
    // both breach at four days out and the MAXIMUM severity wins, so the second
    // registration carries `major` for the fingerprint the first carried
    // `minor` for. Monotonic, in place, one row.
    await seed();
    await register();
    expect((await stored(FP(), "registerDeadline")).severity).toBe("minor");

    await threshold("visa-expiry", 30, "major");
    await engine.tick();
    const again = await register();

    expect(again.verdict).toEqual({ status: "breached", severity: "major" });
    expect((await stored(FP(), "the second registration")).severity).toBe("major");
    expect(await alertCountFor(db, FP())).toBe(1);
  });

  it("lands one alert for a deadline that falls on a Friday, and never shifts the date", async () => {
    // The Gulf working week, on the boundary that matters: Friday and Saturday
    // are the weekend here, and a statutory date landing on one is SURFACED
    // rather than moved (calendar.ts; CLAUDE.md rule 9). The engine's part is
    // to record the caller's bag whole, `dueOnNonWorkingDay` and all.
    await seed();
    const result = await register({ entityId: "doc-1", dueDate: DUE_ON_FRIDAY });

    expect(result.dueOnNonWorkingDay).toBe(true);
    const row = await stored(FP(), "registerDeadline for a Friday due date");
    expect(await alertCountFor(db, FP())).toBe(1);
    expect(bag(row).dueOnNonWorkingDay).toBe(true);
    // The whole registration travels in the bag, so its own id is in there —
    // stored, and never read for anything.
    expect(bag(row).id).toBe(result.registration.id);
  });

  it("keeps two registrations of different documents as two alerts", async () => {
    // The discriminating half: an engine collapsing everything into one row
    // would satisfy every "one alert" case above. Two documents are two facts.
    await seed();
    await register({ entityId: "doc-1" });
    await register({ entityId: "doc-2" });

    expect(await db.alert.count()).toBe(2);
    expect(await alertCountFor(db, fingerprintFor(TENANT, "document", "doc-2", "visa-expiry"))).toBe(1);
  });
});
