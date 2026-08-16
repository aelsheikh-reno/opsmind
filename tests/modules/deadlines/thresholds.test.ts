// Task `module-deadlines-thresholds`, all five assertions of
// tasks/backlog.yaml#module-deadlines-thresholds:
//   1. "Severity is the maximum across breached windows, never the tightest one"
//   2. "A threshold is inclusive at its bound — exactly seven business days
//       remaining breaches a seven-day window"
//   3. "An overdue deadline, with negative days remaining, reports the highest
//       severity configured for its type — not the top band of the severity
//       scale" (node `overdue-severity`, Ahmed's decision of 2026-08-16,
//       withdrawing the reversal made the same day and restoring the per-type
//       ceiling)
//   4. "A deadline type with no ThresholdTable row is reported as unconfigured,
//       never scored as safe"
//   5. "A fingerprint is deterministic and carries no severity, so an escalation
//       does not change identity"
//
// Written from the specification alone. `lib/modules/deadlines/thresholds.ts`
// and `lib/modules/deadlines/index.ts` were NOT read: a test written after the
// code describes what the code does, bugs included, and then guards them with a
// green check. Every expected value below comes from
// docs/architecture/components-core-deadline-monitor.md (the settled threshold
// semantics: Ahmed's decisions of 2026-08-14 at :42-48, and the per-type ceiling
// on an overdue deadline at :50-54) or from docs/architecture/flows-alerting.md:34
// (the fingerprint's segments). The only thing taken from the module is the
// shape of the call — names, parameters and types, handed over in the task,
// which is its public surface.
//
// There is NO oracle for the overdue rule and none is cited. Legacy is silent
// on it rather than agreeing with either reading: its digest never collects an
// already-expired document, invoice or schedule, so on an expired visa it has
// no opinion at all. An overdue expectation below that cited legacy would be
// citing a query that never runs.
//
// The overdue rule moved twice while this file existed — to the top of the
// severity scale on 2026-08-16 and back to the per-type ceiling the same day,
// the second change being a withdrawal of the first. The shape that made the
// second change cheap is kept deliberately: the rule is pinned in exactly ONE
// describe, and every other block that happens to pass a negative distance
// defers to it by reference (`highestConfiguredFor`) rather than restating what
// it answers. Both property tests hold non-negative domains for the same
// reason — a generated negative day would make their expectations a tacit
// second copy of the overdue rule, which is how the first change came to break
// two describes that are not about overdue at all.
//
// Why these four functions are worth this much test: the failure they exist to
// prevent is silence. An under-warned deadline produces no output at all, so
// nothing on the surface distinguishes "not breached", "not watched" and "wrong
// answer". The three are pulled apart deliberately here — a safe answer with
// `isConfigured` true is safe, a non-answer with `isConfigured` false is a
// misconfiguration that must raise (spec:46).
//
// UPDATED BY `module-deadlines-sweep`, WITHOUT LOOSENING ANYTHING IT PINS.
// `severityFor` returned `Severity | null` when this file was written, which
// gave those last two the SAME answer and left it to each caller to remember to
// call `isConfigured` as well; the sweep node made it return a discriminated
// verdict — breached / safe / unconfigured — so the compiler asks instead. Every
// expectation below is unchanged: the local `scored()` collapses both
// non-breaching outcomes back to `null`, so each assertion still says exactly
// what it said. What changed is where the DISTINCTION is pinned — on the verdict
// itself, in "distinguishes not-breached from not-configured in its type", which
// is the assertion that could not be written against the old signature at all.
//
// No database, no fakes, no sweep: these are pure functions over values. The
// sweep-level pinning of the same rules belongs to a later node.
import { describe, expect, it } from "vitest";
import {
  APP_ID,
  SOURCE_ID,
  fingerprintFor,
  highestSeverity,
  isConfigured,
  severityFor,
  type Severity,
  type ThresholdRule,
} from "@/lib/modules/deadlines";

// ------------------------------------------------------------------ helpers --

const rule = (deadlineType: string, businessDaysBefore: number, severity: Severity): ThresholdRule => ({
  deadlineType,
  businessDaysBefore,
  severity,
});

/**
 * The severity a table reports for a distance, or `null` when it reports none.
 *
 * The adapter described in the header: it maps the verdict's two non-breaching
 * outcomes — `safe` and `unconfigured` — back onto the single `null` the
 * expectations in this file were written against, so none of them had to be
 * restated when the signature changed. Used everywhere a case is about WHICH
 * severity is reported; the cases about telling the two non-answers apart call
 * `severityFor` directly, because that is the whole of what they assert.
 */
function scored(
  rules: readonly ThresholdRule[],
  deadlineType: string,
  businessDaysRemaining: number,
): Severity | null {
  const verdict = severityFor(rules, deadlineType, businessDaysRemaining);
  return verdict.status === "breached" ? verdict.severity : null;
}

/**
 * The severity order, stated once. "Maximum" and "highest" in the spec are
 * claims about this order; `minor` < `major` is the whole of it, since
 * `Severity` has exactly two members.
 */
const RANK: Record<Severity, number> = { minor: 1, major: 2 };
const ALL_SEVERITIES: readonly Severity[] = ["minor", "major"];

/**
 * The highest severity CONFIGURED for a type — the ceiling an overdue deadline
 * reports from (spec:48,50). Stated once so that blocks which are not about the
 * overdue rule can name its answer by reference instead of writing out a band
 * and quietly becoming a second statement of the rule. `null` where the type has
 * no row at all, which is the unconfigured hole and not a severity (spec:54).
 *
 * Used only on the small fixed tables below, where the ceiling is obvious by
 * inspection. The overdue property test deliberately does NOT use it: an
 * expectation recomputed from the rules is a copy of the rule under test, so
 * that test picks its ceiling first and builds a table around it instead.
 */
function highestConfiguredFor(rules: readonly ThresholdRule[], deadlineType: string): Severity | null {
  const own = rules.filter((r) => r.deadlineType === deadlineType);
  if (own.length === 0) return null;
  return own.reduce<Severity>((top, r) => (RANK[r.severity] > RANK[top] ? r.severity : top), own[0].severity);
}

/** Every ordering of a rule set. Used to prove the answer is order-free. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

/** A deterministic generator, so a property failure is reproducible. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// The case the spec names, kept as one constant because three describes use it:
// spec:42 — "rows of `{30 days → major, 7 days → minor}` report **major** at
// five days out". Written in the misordered order the spec gives it in.
const MISORDERED: readonly ThresholdRule[] = [rule("visa", 30, "major"), rule("visa", 7, "minor")];

// Rules for a different type, present in every list that wants to prove no
// leakage. A licence window must never answer a question about a visa.
const OTHER_TYPE: readonly ThresholdRule[] = [
  rule("trade-licence", 90, "major"),
  rule("trade-licence", 60, "major"),
];

// ---------------------------------------------------------------------------
// Assertion 1 — severity is the maximum across breached windows.
// ---------------------------------------------------------------------------

describe("severity is the maximum across breached windows, never the tightest one", () => {
  // spec:42 — "Where several threshold windows are breached at once, the
  // reported severity is the highest of them, not the severity of the nearest
  // window... Over-warning is noisy and visible; under-warning is silent, and
  // silence is the failure this module exists to prevent."
  it("reports major at five days out for the spec's own {30 → major, 7 → minor} rows", () => {
    // The named case. Both windows are breached at 5 days remaining; the
    // NEAREST window is the 7-day minor one, and reporting minor here is the
    // exact downgrade the decision forbids.
    expect(scored(MISORDERED, "visa", 5)).toBe("major");
    expect(scored(MISORDERED, "visa", 5)).not.toBe("minor");
  });

  it("reports major at five days out however the rows are ordered", () => {
    // "Escalation is therefore a property of the data rather than of row
    // ordering" (spec:42). A Settings table has no guaranteed order — an admin
    // edit, a re-seed or a query without ORDER BY can hand these over either
    // way round — so the answer must be invariant under permutation, not merely
    // correct for the one order somebody happened to try.
    for (const ordering of permutations(MISORDERED)) {
      const shown = ordering.map((r) => `${r.businessDaysBefore}→${r.severity}`).join(", ");
      expect(scored(ordering, "visa", 5), `rows ordered {${shown}}`).toBe("major");
    }
  });

  it("is invariant under every permutation of a four-row table, at every distance", () => {
    // Four rows, deliberately misordered on entry, plus two rows for another
    // type. 24 orderings × 9 distances: if any answer depends on which row is
    // met first, one of these disagrees with the rest.
    const rules: readonly ThresholdRule[] = [
      rule("visa", 14, "minor"),
      rule("visa", 30, "major"),
      rule("visa", 7, "minor"),
      rule("visa", 3, "major"),
      ...OTHER_TYPE,
    ];
    const orderings = permutations(rules);
    expect(orderings.length, "the permutation helper produced nothing to compare").toBe(720);
    for (const days of [45, 31, 30, 20, 14, 8, 7, 3, -1]) {
      const answers = new Set(orderings.map((ordering) => String(scored(ordering, "visa", days))));
      expect([...answers], `distance ${days} answered differently depending on row order`).toHaveLength(1);
    }
  });

  it("never answers below the severity of a window it has breached", () => {
    // The anti-downgrade invariant, stated as a property rather than a table:
    // whatever else it does, the answer may not be less severe than any window
    // whose bound has been reached. Under-warning is the silent failure.
    //
    // Domain: NON-NEGATIVE distances only. This block is about the window rule,
    // and a deadline already past due is governed by a different rule (spec:50)
    // that answers from the severity scale rather than from the rows. Generating
    // negative days here would make the expectation below a second, tacit copy
    // of the overdue rule — which is exactly how the 2026-08-16 reversal came to
    // break two describes that are not about overdue at all. Overdue is pinned
    // once, in its own block.
    const next = random(20260814);
    for (let trial = 0; trial < 300; trial += 1) {
      const rules: ThresholdRule[] = [...OTHER_TYPE];
      const windows = 1 + Math.floor(next() * 4);
      for (let i = 0; i < windows; i += 1) {
        rules.push(rule("visa", Math.floor(next() * 41), ALL_SEVERITIES[Math.floor(next() * 2)]));
      }
      const days = Math.floor(next() * 46);
      const breached = rules.filter((r) => r.deadlineType === "visa" && r.businessDaysBefore >= days);
      const answer = scored(rules, "visa", days);
      const shown = JSON.stringify({ rules, days, answer });

      if (breached.length === 0) {
        expect(answer, `nothing breached, so nothing to report: ${shown}`).toBeNull();
        continue;
      }
      expect(answer, `a breached window must be reported: ${shown}`).not.toBeNull();
      for (const r of breached) {
        expect(RANK[answer as Severity], `downgraded below a breached ${r.severity} window: ${shown}`).toBeGreaterThanOrEqual(
          RANK[r.severity],
        );
      }
      // ...and it may not invent a severity nobody configured, which together
      // with the line above is exactly "the maximum of the breached windows".
      expect(breached.map((r) => r.severity), `severity not drawn from the breached rows: ${shown}`).toContain(answer);
    }
  });

  it("never downgrades as the deadline gets closer", () => {
    // Monotonicity: severity "is monotonic while an alert is open"
    // (flows-alerting.md:34). Walking a deadline in towards the due date and
    // past it, the reported severity may rise and may not fall — a table whose
    // tightest window is the mildest is precisely how it would fall.
    const rules = [rule("filing", 30, "major"), rule("filing", 7, "minor"), rule("filing", 2, "minor")];
    let previous = 0;
    for (let days = 40; days >= -5; days -= 1) {
      const answer = scored(rules, "filing", days);
      const rank = answer === null ? 0 : RANK[answer];
      expect(rank, `severity fell between ${days + 1} and ${days} days remaining`).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
    // Where the walk ends is the overdue rule's answer, not this block's, so it
    // is named by reference rather than as a literal severity.
    expect(previous, "the walk never reached a breach at all").toBe(
      RANK[highestConfiguredFor(rules, "filing") as Severity],
    );
  });

  it("reads only the rows for the type it was asked about", () => {
    // A major licence window must not make a visa major, and it must not make
    // an unbreached visa breach. Cross-type leakage is invisible in production:
    // it produces a plausible-looking severity for the wrong reason.
    const rules = [rule("visa", 7, "minor"), rule("trade-licence", 90, "major")];
    expect(scored(rules, "visa", 5)).toBe("minor");
    expect(scored(rules, "visa", 60)).toBeNull();
    expect(scored(rules, "trade-licence", 60)).toBe("major");
  });
});

// ---------------------------------------------------------------------------
// Assertion 2 — a threshold is inclusive at its bound.
// ---------------------------------------------------------------------------

describe("a threshold is inclusive at its bound", () => {
  // spec:48 — "A threshold is **inclusive at its bound** — exactly seven
  // business days remaining breaches a seven-day window". The off-by-one is the
  // whole of this block: an exclusive bound loses the first day of every window
  // silently, and the day it loses is a day of notice.
  const SEVEN: readonly ThresholdRule[] = [rule("visa", 7, "minor"), ...OTHER_TYPE];

  // Non-negative distances only: on or before the due date the window rule is
  // the whole answer, so the expected severity is the row's own. A deadline
  // already past due is scored by the overdue rule instead (spec:50), which is
  // pinned in its own block and referenced — not restated — in the case below.
  it.each([
    { days: 9, breached: false, why: "two days outside the window" },
    { days: 8, breached: false, why: "one day outside — the last quiet day" },
    { days: 7, breached: true, why: "the bound itself, inclusive" },
    { days: 6, breached: true, why: "one day inside" },
    { days: 1, breached: true, why: "due tomorrow" },
    { days: 0, breached: true, why: "due today — not yet overdue" },
  ])("$days business days remaining against a seven-day window: breached=$breached ($why)", ({ days, breached }) => {
    expect(scored(SEVEN, "visa", days)).toBe(breached ? "minor" : null);
  });

  it("is still breached one day overdue, at whatever severity the overdue rule gives", () => {
    // Past the bound is still inside the window: the inclusive comparison does
    // not stop applying once the distance goes negative, and a lapsed visa must
    // not fall out of the breach set. That non-null is what belongs to THIS
    // block. WHICH severity comes back is the overdue rule's business (spec:50)
    // and not this block's, so it is asserted by reference to that type's
    // configured ceiling rather than written out as a band here.
    expect(scored(SEVEN, "visa", -1)).not.toBeNull();
    expect(scored(SEVEN, "visa", -1)).toBe(highestConfiguredFor(SEVEN, "visa"));
  });

  it("is inclusive at the bound for a major window too", () => {
    // The rule is about the comparison, not about which severity sits on it.
    const rules = [rule("filing", 7, "major")];
    expect(scored(rules, "filing", 8)).toBeNull();
    expect(scored(rules, "filing", 7)).toBe("major");
  });

  it("escalates exactly at the wider bound, not a day late", () => {
    // {30 → major, 7 → minor}: at 31 days nothing is breached, at exactly 30 the
    // major window is. Inclusivity and "maximum across breached windows" meet
    // here — the day the escalation lands is the day the wider bound is reached.
    expect(scored(MISORDERED, "visa", 31)).toBeNull();
    expect(scored(MISORDERED, "visa", 30)).toBe("major");
    expect(scored(MISORDERED, "visa", 8)).toBe("major");
  });

  it("treats a zero-day window as breaching on the due date and not before", () => {
    // The boundary of the boundary: a window of 0 says "tell me the day it is
    // due". One day before is not that day; the day itself, and every day after
    // it, is.
    const rules = [rule("heartbeat", 0, "major")];
    expect(scored(rules, "heartbeat", 1)).toBeNull();
    expect(scored(rules, "heartbeat", 0)).toBe("major");
    // One day later it is overdue, and the overdue rule answers — by reference.
    expect(scored(rules, "heartbeat", -1)).toBe(highestConfiguredFor(rules, "heartbeat"));
  });

  it("holds at the bound of every window in a multi-row table", () => {
    // Each bound checked at bound+1, bound and bound-1, with the answer being
    // the maximum of everything breached at that distance.
    const rules = [rule("visa", 30, "minor"), rule("visa", 14, "minor"), rule("visa", 5, "major")];
    expect(scored(rules, "visa", 31)).toBeNull();
    expect(scored(rules, "visa", 30)).toBe("minor");
    expect(scored(rules, "visa", 15)).toBe("minor");
    expect(scored(rules, "visa", 14)).toBe("minor");
    expect(scored(rules, "visa", 6)).toBe("minor");
    expect(scored(rules, "visa", 5)).toBe("major");
    expect(scored(rules, "visa", 4)).toBe("major");
  });
});

// ---------------------------------------------------------------------------
// Assertion 3 — an overdue deadline takes the highest severity configured FOR
// ITS TYPE.
// ---------------------------------------------------------------------------
//
// This is the one place the overdue rule is stated. Every other block that
// passes a negative distance defers to `highestConfiguredFor` rather than
// naming a band, so this rule can be changed again in one file and one describe.

describe("an overdue deadline reports the highest severity configured for its type", () => {
  // spec:48,50 — "an **overdue** deadline, with negative days remaining,
  // breaches every window its type has and reports the **highest severity
  // configured for that type**... A type whose Settings rows are all `minor`
  // reports `minor` however far past due it runs. The ceiling is the type's own
  // rows, because the severity column in Settings is how an administrator says
  // *'this type is never urgent'* — and an overdue stationery order at the same
  // band as a lapsed visa empties the top band of meaning."
  //
  // Ahmed's decision of 2026-08-16, WITHDRAWING the same day's reversal that had
  // put every overdue item at the top band of the scale. That reversal is not
  // pinned anywhere in this file any more, and neither is a legacy citation for
  // it: legacy is silent on this case rather than agreeing with either reading
  // (spec:52), so there is no oracle here and nothing in this block is derived
  // from one. The expectations below are read off the tables by inspection.

  /** All-minor rows: the case where the withdrawn reading and this one differ. */
  const MINOR_ONLY: readonly ThresholdRule[] = [
    rule("stationery-order", 14, "minor"),
    rule("stationery-order", 3, "minor"),
  ];

  it("has a scale whose top outranks minor, so the cases below can discriminate", () => {
    // A guard, not a rule. If `Severity` ever collapsed to a single band, the
    // minor-only case below would pass without proving anything — the withdrawn
    // top-of-the-scale reading would satisfy it too, because minor would BE the
    // top. This fails loudly in that case instead of going quietly vacuous.
    expect(RANK[highestSeverity()], "the scale has no band above minor").toBeGreaterThan(RANK.minor);
  });

  it("reports minor for a type whose only configured windows are minor, and still reports it", () => {
    // THE discriminating case. Both rows are minor, so the type's ceiling is
    // minor, and it stays minor five days past due.
    //
    // A MINOR-ONLY TYPE REPORTING MINOR IS NOT SILENCE. The alert fires, appears
    // in the run and is reported — hence the `not.toBeNull()` beside the band.
    // Severity governs URGENCY, not VISIBILITY; a low band is not the absence of
    // an alert. Reading it as one is the misreading that produced the withdrawn
    // 2026-08-16 reversal, so the two halves are pinned together here: the thing
    // is reported, AND it is reported at the band its administrator chose. The
    // severity column in Settings is how that administrator says "this type is
    // never urgent" (spec:50), and an overdue stationery order sitting at the
    // same band as a lapsed visa empties the top band of meaning.
    expect(scored(MINOR_ONLY, "stationery-order", -5)).not.toBeNull();
    expect(scored(MINOR_ONLY, "stationery-order", -5)).toBe("minor");
    expect(scored(MINOR_ONLY, "stationery-order", -5)).not.toBe(highestSeverity());
  });

  it("reports major for a type that does configure a major window", () => {
    // The other polarity. MISORDERED carries a major row, so its ceiling is
    // major and an overdue visa reaches it — a per-type ceiling is a ceiling,
    // not a demotion. A rule that answered the TIGHTEST configured band would
    // give minor here: the nearest window of {30 → major, 7 → minor} is the
    // minor one, and that is the downgrade spec:42 forbids.
    expect(scored(MISORDERED, "visa", -1)).toBe("major");
    expect(scored(MISORDERED, "visa", -40)).toBe("major");
    expect(scored(MISORDERED, "visa", -1)).not.toBe("minor");
  });

  it.each([-1, -2, -7, -30, -365, -3650])("reports its type's own ceiling %i days overdue", (days) => {
    // Distance past due does not change the answer in either direction. Long
    // overdue is not less serious than newly overdue for the visa, and it is not
    // MORE serious than its rows for the stationery order: there is no distance
    // at which a minor-only type drifts up into the urgent band.
    expect(scored(MINOR_ONLY, "stationery-order", days)).toBe("minor");
    expect(scored(MISORDERED, "visa", days)).toBe("major");
  });

  it("answers different bands for two types configured differently", () => {
    // The per-type rule stated as a difference rather than as two values. If the
    // ceiling came from the scale instead of from the rows, these two would be
    // equal — one bucket for every overdue item regardless of type. They are not
    // equal, and which one is higher is decided by the Settings rows alone.
    const minorOverdue = scored(MINOR_ONLY, "stationery-order", -9);
    const majorOverdue = scored(MISORDERED, "visa", -9);
    expect(minorOverdue).not.toBe(majorOverdue);
    expect(minorOverdue).toBe("minor");
    expect(majorOverdue).toBe("major");
    expect(RANK[majorOverdue as Severity]).toBeGreaterThan(RANK[minorOverdue as Severity]);
  });

  it("varies with which windows the type happens to have", () => {
    // Four tables for one type — minor-only, major-only, mixed, and a single
    // zero-day minor row — all overdue by the same distance, all answering their
    // own ceiling. Each is paired with OTHER_TYPE's two major rows, which must
    // not lift the minor tables: a cross-type leak would make all four major and
    // is indistinguishable from the withdrawn rule on this table.
    const cases: readonly { table: readonly ThresholdRule[]; ceiling: Severity }[] = [
      { table: [rule("filing", 1, "minor")], ceiling: "minor" },
      { table: [rule("filing", 90, "major")], ceiling: "major" },
      {
        table: [rule("filing", 30, "major"), rule("filing", 7, "minor"), rule("filing", 2, "minor")],
        ceiling: "major",
      },
      { table: [rule("filing", 0, "minor")], ceiling: "minor" },
    ];
    const answers = cases.map(({ table }) => scored([...table, ...OTHER_TYPE], "filing", -3));
    for (const [index, answer] of answers.entries()) {
      expect(answer, `table ${index}: ${JSON.stringify(cases[index].table)}`).toBe(cases[index].ceiling);
    }
    expect([...new Set(answers.map(String))], "the answer did not depend on the type's rows").toHaveLength(2);
  });

  it("treats zero days remaining as not overdue, and minus one as overdue", () => {
    // The boundary, pinned in BOTH directions.
    //
    // Note what the per-type ceiling makes of it: on a configured type the two
    // sides agree by construction. Every window of a type has a non-negative
    // bound, so at 0 every window is already breached and the window rule's
    // maximum IS the type's ceiling — the same value the overdue rule gives at
    // -1. So the boundary cannot be pinned by the two sides differing in band;
    // it is pinned by what must NOT happen on either side.
    //
    // 0 is not overdue: due TODAY is not late, and nothing may be scored above
    // this type's rows on the one day the thing can still be done on time.
    expect(scored(MINOR_ONLY, "stationery-order", 1)).toBe("minor");
    expect(scored(MINOR_ONLY, "stationery-order", 0)).toBe("minor");
    expect(scored(MINOR_ONLY, "stationery-order", 0)).not.toBe(highestSeverity());
    // -1 IS overdue: it has not fallen out of the breach set, and it is still
    // capped by the same rows.
    expect(scored(MINOR_ONLY, "stationery-order", -1)).not.toBeNull();
    expect(scored(MINOR_ONLY, "stationery-order", -1)).toBe("minor");
    expect(scored(MINOR_ONLY, "stationery-order", -1)).not.toBe(highestSeverity());
    // The one table where 0 and -1 are observably a different STATE: a single
    // zero-day window. One day out, nothing is breached at all; on the day, and
    // every day after it, the window is breached. An implementation reading the
    // distance one day late breaches at 1, and one reading it a day early stops
    // breaching at -1.
    const dueToday = [rule("heartbeat", 0, "minor")];
    expect(scored(dueToday, "heartbeat", 1), "a day early is not due").toBeNull();
    expect(scored(dueToday, "heartbeat", 0), "due today breaches").toBe("minor");
    expect(scored(dueToday, "heartbeat", -1), "past due did not fall out").toBe("minor");
  });

  it("does not escalate a type whose windows are not yet breached", () => {
    // Overdue is about the DISTANCE, not about the type. A minor-only type well
    // outside every window stays silent; no band is a default.
    expect(scored(MINOR_ONLY, "stationery-order", 40)).toBeNull();
    expect(scored(MINOR_ONLY, "stationery-order", 15)).toBeNull();
    expect(scored(MINOR_ONLY, "stationery-order", 14)).toBe("minor");
  });

  it("reports its type's configured ceiling at every overdue distance, whatever the table", () => {
    // The property. Its expectation is NOT recomputed from the generated rules:
    // a maximum taken over the rows here would be a second copy of the rule
    // under test, agreeing with the implementation by construction. The ceiling
    // is drawn FIRST, and the table is then built to have exactly that ceiling —
    // one row carries it and no row may exceed it — so the expected value is
    // known before any rule is applied to it.
    const next = random(20260816);
    let minorCeilings = 0;
    for (let trial = 0; trial < 200; trial += 1) {
      const ceiling = ALL_SEVERITIES[Math.floor(next() * ALL_SEVERITIES.length)];
      const atOrBelow = ALL_SEVERITIES.filter((s) => RANK[s] <= RANK[ceiling]);
      if (ceiling === "minor") minorCeilings += 1;
      // OTHER_TYPE's rows are major throughout: on a minor-ceiling trial they
      // are the leak that would show up as an answer above the ceiling.
      const rules: ThresholdRule[] = [...OTHER_TYPE];
      const windows = 1 + Math.floor(next() * 4);
      const carriesCeiling = Math.floor(next() * windows);
      for (let i = 0; i < windows; i += 1) {
        const severity = i === carriesCeiling ? ceiling : atOrBelow[Math.floor(next() * atOrBelow.length)];
        rules.push(rule("visa", Math.floor(next() * 41), severity));
      }
      const days = -1 - Math.floor(next() * 90);
      const shown = JSON.stringify({ rules, days, ceiling });
      expect(scored(rules, "visa", days), shown).toBe(ceiling);
      expect(scored(rules, "visa", days), `overdue answered nothing: ${shown}`).not.toBeNull();
    }
    // The minor-ceiling trials are the discriminating ones; a generator drift
    // that stopped producing them would leave this test passing vacuously
    // against the withdrawn rule.
    expect(minorCeilings, "no minor-ceiling table was generated").toBeGreaterThan(50);
  });

  it("does not invent a severity for an overdue deadline of an unconfigured type", () => {
    // Unconfigured is untouched by any of this (spec:54): "Absence of a row is a
    // hole, not a severity, and overdue is not a licence to score a type nobody
    // configured." It raises as a misconfiguration (spec:46) instead of being
    // silently scored — and a type given a band would never raise at all.
    expect(scored(OTHER_TYPE, "visa", -30)).toBeNull();
    expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);
  });

  it.each([-1, -2, -7, -30, -365, -3650])("leaves an unconfigured type unscored %i days overdue", (days) => {
    // At EVERY negative distance, not just the one a table happened to pick: an
    // implementation that short-circuits to a band on `days < 0` before it looks
    // for a row passes the single case and fails here.
    expect(scored(OTHER_TYPE, "visa", days), "a type with no row was scored").toBeNull();
    expect(scored([], "visa", days), "an empty table scored a type").toBeNull();
    expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);
  });

  it("scores an overdue type as soon as one row exists, and not before", () => {
    // The two sides of the same boundary, one row apart. This is what makes the
    // unconfigured hole a hole rather than a quiet band: adding any row at all
    // turns silence into that row's band — into MINOR here, not into the top of
    // the scale and not into the major band the other type carries.
    const withoutRow: readonly ThresholdRule[] = [...OTHER_TYPE];
    const withOneRow = [...OTHER_TYPE, rule("visa", 1, "minor")];
    expect(scored(withoutRow, "visa", -2)).toBeNull();
    expect(scored(withOneRow, "visa", -2)).not.toBeNull();
    expect(scored(withOneRow, "visa", -2)).toBe("minor");
  });
});

// ---------------------------------------------------------------------------
// Assertion 4 — an unconfigured type is reported as unconfigured, never safe.
// ---------------------------------------------------------------------------

describe("a deadline type with no ThresholdTable row is unconfigured, never safe", () => {
  // spec:46 — "A registered deadline whose type has no `ThresholdTable` row is a
  // misconfiguration, not a quiet no-op: an unwatched deadline is exactly the
  // failure this module exists to prevent, and silence must never be
  // indistinguishable from 'nothing is wrong'."
  it("answers false for a type with no row at all", () => {
    expect(isConfigured([], "visa")).toBe(false);
  });

  it("answers false for a type absent from a table that has other rows", () => {
    // The realistic shape of the defect: Settings is populated, thoroughly, for
    // every type except the new one somebody just started registering.
    expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);
    expect(isConfigured([...OTHER_TYPE, rule("filing", 7, "minor")], "visa")).toBe(false);
  });

  it("answers true as soon as one row exists for the type", () => {
    expect(isConfigured([rule("visa", 7, "minor")], "visa")).toBe(true);
    expect(isConfigured([...OTHER_TYPE, rule("visa", 1, "minor")], "visa")).toBe(true);
  });

  it("distinguishes not-breached from not-configured in its type, so a caller cannot conflate them", () => {
    // tasks/backlog.yaml#module-deadlines-sweep, assertion 14. They are opposite
    // facts: the first is "I looked, it is fine", the second is "nobody is
    // looking". They used to be the same `null`, so a caller writing
    // `if (severityFor(...) === null) return;` dropped an unwatched visa
    // silently and read it as a healthy one — the failure spec:46 exists to
    // prevent. The verdict says which, and says it in the type.
    const configured = [rule("visa", 7, "minor")];
    expect(severityFor(configured, "visa", 40).status, "a configured type inside every window").toBe("safe");
    expect(isConfigured(configured, "visa")).toBe(true);

    expect(severityFor(OTHER_TYPE, "visa", 40).status, "a type with no row at all").toBe("unconfigured");
    expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);

    expect(severityFor(configured, "visa", 40).status).not.toBe(
      severityFor(OTHER_TYPE, "visa", 40).status,
    );
    expect(isConfigured(configured, "visa")).not.toBe(isConfigured(OTHER_TYPE, "visa"));
  });

  it("makes the distinction at every distance, and a breach a third answer again", () => {
    // The three outcomes over the whole range, so an implementation that
    // answers `unconfigured` only when the table is empty, or that forgets the
    // distinction once a deadline is overdue, fails here. `isConfigured` is
    // asserted alongside: the two must never disagree, or the sweep's per-type
    // misconfiguration count and the per-deadline score come from two different
    // opinions about the same table.
    const configured = [rule("visa", 7, "minor")];
    for (const days of [120, 30, 8, 7, 1, 0, -1, -90]) {
      const breached = days <= 7;
      expect(severityFor(configured, "visa", days).status, `${days} days, configured`).toBe(
        breached ? "breached" : "safe",
      );
      expect(severityFor(OTHER_TYPE, "visa", days).status, `${days} days, no row`).toBe("unconfigured");
      expect(severityFor([], "visa", days).status, `${days} days, empty table`).toBe("unconfigured");
      expect(isConfigured(configured, "visa")).toBe(true);
      expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);
    }
  });

  it.each([120, 30, 7, 1, 0, -1, -90])("stays unconfigured at %i days remaining", (days) => {
    // Distance cannot configure a type. There is no number of days at which a
    // missing row starts answering, in either direction.
    expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);
    expect(scored(OTHER_TYPE, "visa", days)).toBeNull();
  });

  it("carries no severity at all when nothing is breached", () => {
    // The same hazard this pinned against `Severity | null`: `""`, `undefined`
    // and `false` all read as "no breach" at a call site written with
    // `if (severity)`, and all three are then reported to the Alert Manager as a
    // severity if written with `severity ?? …`. Under the verdict the answer
    // must carry no severity field to reach for at all — neither a falsy one nor
    // an undefined one — so `verdict.severity` is a type error rather than a
    // value that flows on.
    const safe = severityFor([rule("visa", 7, "minor")], "visa", 40);
    expect(safe.status).toBe("safe");
    expect(safe).not.toHaveProperty("severity");
    expect(ALL_SEVERITIES).not.toContain((safe as { severity?: unknown }).severity);
    expect(scored([rule("visa", 7, "minor")], "visa", 40)).toBeNull();

    const hole = severityFor(OTHER_TYPE, "visa", 40);
    expect(hole.status).toBe("unconfigured");
    expect(hole).not.toHaveProperty("severity");
  });

  it("does not treat an empty table as a clean bill of health for any type", () => {
    for (const type of ["visa", "filing", "trade-licence", "passport"]) {
      expect(isConfigured([], type), `${type} reported as configured against an empty table`).toBe(false);
      expect(scored([], type, 3), `${type} scored against an empty table`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Assertion 5 — the fingerprint is deterministic and carries no severity.
// ---------------------------------------------------------------------------

describe("the fingerprint is deterministic and carries no severity", () => {
  // flows-alerting.md:34 — "Fingerprints are deterministic —
  // `{tenant}:{app}:{source}:{entity}:{policy}` — computed by the source from
  // its own data, so no source needs memory of what it raised. Severity is not
  // part of the fingerprint (escalation would break dedupe)."
  // components-core-deadline-monitor.md:28-29 shows the entity and policy
  // segments of one: `reportRun("deadline-monitor", …)` with a fingerprint
  // ending `…document:123:expiry`.
  const FP = () => fingerprintFor("reno", "document", "123", "expiry");

  it("reports under the source id the spec names", () => {
    // spec:28 — reportRun("deadline-monitor", …). The source id is how the
    // Alert Manager knows which source has gone dark; it is not a free choice.
    expect(SOURCE_ID).toBe("deadline-monitor");
  });

  it("has segments that cannot themselves contain the separator", () => {
    // A colon inside a segment makes the five-part identity ambiguous, so two
    // different deadlines can collide onto one fingerprint and one of them is
    // then silently deduplicated away.
    expect(APP_ID).not.toBe("");
    expect(APP_ID).not.toContain(":");
    expect(SOURCE_ID).not.toContain(":");
  });

  it("gives two deadlines differing only by a colon inside a segment distinct fingerprints", () => {
    // tasks/backlog.yaml#module-deadlines-sweep, assertion 13. The runtime half
    // of the case above, which only pinned the two segments the module chooses
    // itself. An entity id or a deadline type arrives from data — a document
    // reference, a type name someone typed into Settings — so a colon in one is
    // a value, not a bug, and joining on `:` made these two the same string.
    // Two deadlines, one identity: the Alert Manager dedupes the second away and
    // it is never seen, which is worse than a wrong alert because it is silent.
    const collidingOnId = fingerprintFor("reno", "document", "123:expiry", "renewal");
    const collidingOnType = fingerprintFor("reno", "document", "123", "expiry:renewal");
    expect(collidingOnId).not.toBe(collidingOnType);

    // Whichever way the separator is dealt with, the two must stay apart in the
    // tenant and entity-type segments too.
    expect(fingerprintFor("reno:x", "document", "123", "expiry")).not.toBe(
      fingerprintFor("reno", "x:document", "123", "expiry"),
    );
    expect(fingerprintFor("reno", "document:123", "expiry", "renewal")).not.toBe(
      fingerprintFor("reno", "document", "123:expiry", "renewal"),
    );
  });

  it("leaves a fingerprint with no colon in any segment byte for byte unchanged", () => {
    // The other half, and the reason the fix is escaping rather than rewriting:
    // a fingerprint IS the alert's identity. Changing the string an ordinary
    // registration produces would resolve every open alert and reopen it as a
    // new one — a fleet-wide false all-clear followed by a duplicate page.
    expect(FP()).toBe(["reno", APP_ID, SOURCE_ID, "document", "123", "expiry"].join(":"));
    expect(FP().split(":")).toHaveLength(6);
  });

  it("carries tenant, app, source, entity and policy, in that order", () => {
    // The order is the contract: the Alert Manager groups and suppresses on
    // prefixes of it. APP_ID and SOURCE_ID are read from the module rather than
    // written out here, so this pins the ORDER and the shape without asserting
    // what the module chose to call itself.
    expect(FP()).toBe(["reno", APP_ID, SOURCE_ID, "document", "123", "expiry"].join(":"));

    const segments = FP().split(":");
    expect(segments).toHaveLength(6);
    expect(segments[0], "tenant").toBe("reno");
    expect(segments[1], "app").toBe(APP_ID);
    expect(segments[2], "source").toBe(SOURCE_ID);
    expect(segments[3], "entity type").toBe("document");
    expect(segments[4], "entity id").toBe("123");
    expect(segments[5], "policy").toBe("expiry");
  });

  it("matches the entity and policy tail the spec prints", () => {
    // spec:29 — `{ fingerprint: "…document:123:expiry", severity: "major" }`.
    expect(FP().endsWith("document:123:expiry")).toBe(true);
  });

  it("is identical across repeated calls", () => {
    // "computed by the source from its own data, so no source needs memory of
    // what it raised": no counter, no clock, no run id may reach it, or last
    // night's alert is reopened as a new one every night.
    const first = FP();
    for (let call = 0; call < 50; call += 1) expect(FP()).toBe(first);
  });

  it.each([
    { label: "tenant", tenant: "other", entityType: "document", entityId: "123", deadlineType: "expiry" },
    { label: "entity type", tenant: "reno", entityType: "filing", entityId: "123", deadlineType: "expiry" },
    { label: "entity id", tenant: "reno", entityType: "document", entityId: "124", deadlineType: "expiry" },
    { label: "deadline type", tenant: "reno", entityType: "document", entityId: "123", deadlineType: "renewal" },
  ])("changes when the $label changes", ({ tenant, entityType, entityId, deadlineType }) => {
    // Determinism is only half of identity; the other half is that two
    // different deadlines are two different alerts. A fingerprint that ignores
    // an argument merges them, and one of the two is never seen.
    expect(fingerprintFor(tenant, entityType, entityId, deadlineType)).not.toBe(FP());
  });

  it("does not take a severity — the signature has no room for one", () => {
    // The structural pin. `@ts-expect-error` fails `tsc --noEmit` in BOTH
    // directions: if a fifth parameter is ever added the directive becomes
    // unused and the typecheck fails, and if the call ever legitimately takes a
    // severity the same happens. Identity cannot depend on an argument that
    // cannot be passed.
    expect(fingerprintFor.length).toBe(4);
    // @ts-expect-error — severity is not part of the fingerprint (flows-alerting.md:34).
    const withSeverity: string = fingerprintFor("reno", "document", "123", "expiry", "major");
    expect(withSeverity).toBe(FP());
  });

  it("is unchanged by an escalation from minor to major", () => {
    // The dedupe property, exercised the way the sweep meets it: the same
    // deadline scored twice as it approaches, once minor and once major. The
    // Alert Manager keys on the fingerprint, so if identity moved on escalation
    // the open alert would be abandoned and a second one raised beside it.
    const rules = [rule("expiry", 30, "minor"), rule("expiry", 7, "major")];
    const early = scored(rules, "expiry", 20);
    const late = scored(rules, "expiry", 5);
    expect(early).toBe("minor");
    expect(late).toBe("major");
    expect(RANK[late as Severity]).toBeGreaterThan(RANK[early as Severity]);
    expect(fingerprintFor("reno", "document", "123", "expiry")).toBe(
      fingerprintFor("reno", "document", "123", "expiry"),
    );
  });

  it("keeps the deadline type as the policy segment, so retuning a window does not reopen the alert", () => {
    // "the policy segment is the deadline type rather than a ThresholdTable row
    // id". An admin widening a 7-day window to 14 changes which row matched;
    // the alert is about the same document expiring on the same day, and must
    // keep its identity. Pinned by the segment being the type verbatim, and by
    // the rules not being an input at all.
    const before = [rule("expiry", 7, "minor")];
    const after = [rule("expiry", 14, "major")];
    expect(scored(before, "expiry", 10)).toBeNull();
    expect(scored(after, "expiry", 10)).toBe("major");
    expect(FP().split(":")[5]).toBe("expiry");
    expect(FP()).toBe(fingerprintFor("reno", "document", "123", "expiry"));
  });
});

// ---------------------------------------------------------------------------
// highestSeverity — the top of the scale the other three answers live on.
// ---------------------------------------------------------------------------

describe("highestSeverity", () => {
  it("is the top of the Severity scale", () => {
    // `Severity` is "minor" | "major" (the module's public type), so the maximum
    // of the order is major. Asserted by calling it rather than by restating the
    // union, so a third level added above major without updating this fails here.
    expect(highestSeverity()).toBe("major");
    for (const severity of ALL_SEVERITIES) {
      expect(RANK[highestSeverity()], `${severity} outranks the stated maximum`).toBeGreaterThanOrEqual(RANK[severity]);
    }
  });

  it("is stable across calls", () => {
    expect(highestSeverity()).toBe(highestSeverity());
  });

  it("bounds every severity the threshold table can report", () => {
    // Nothing severityFor produces may exceed the declared maximum — a severity
    // the Alert Manager has no routing policy for is an alert nobody is paged
    // for.
    const rules = [rule("visa", 30, "major"), rule("visa", 7, "minor")];
    for (let days = 40; days >= -10; days -= 1) {
      const answer = scored(rules, "visa", days);
      if (answer === null) continue;
      expect(RANK[answer], `${days} days remaining exceeded the maximum severity`).toBeLessThanOrEqual(
        RANK[highestSeverity()],
      );
    }
  });
});
