// Task `module-deadlines-thresholds`, all five assertions of
// tasks/backlog.yaml#module-deadlines-thresholds:
//   1. "Severity is the maximum across breached windows, never the tightest one"
//   2. "A threshold is inclusive at its bound — exactly seven business days
//       remaining breaches a seven-day window"
//   3. "An overdue deadline, with negative days remaining, reports the highest
//       severity band the severity scale defines — not the highest band
//       configured for its type" (amended by node `overdue-severity`, Ahmed's
//       decision of 2026-08-16, reversing the earlier per-type reading)
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
// semantics: Ahmed's decisions of 2026-08-14 at :42-48, and the overdue
// reversal of 2026-08-16 at :50-52) or from docs/architecture/flows-alerting.md:34
// (the fingerprint's segments). The only thing taken from the module is the
// shape of the call — names, parameters and types, handed over in the task,
// which is its public surface.
//
// Node `overdue-severity` amended one of those rules after this file was first
// written. It was re-derived from the amended spec, again without reading
// `thresholds.ts` — including the two blocks that had picked the old rule up
// incidentally through negative-day inputs. That coupling is the reason the
// reversal was awkward: a rule restated in three places is three places to
// forget. Overdue is now pinned in exactly one describe, and the other blocks
// that happen to pass a negative distance defer to it by reference
// (`highestSeverity()`) rather than restating what it answers.
//
// Why these four functions are worth this much test: the failure they exist to
// prevent is silence. An under-warned deadline produces no output at all, so
// nothing on the surface distinguishes "not breached", "not watched" and "wrong
// answer". The three are pulled apart deliberately here — a `null` severity
// with `isConfigured` true is safe, a `null` severity with `isConfigured` false
// is a misconfiguration that must raise (spec:46).
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
 * The severity order, stated once. "Maximum" and "highest" in the spec are
 * claims about this order; `minor` < `major` is the whole of it, since
 * `Severity` has exactly two members.
 */
const RANK: Record<Severity, number> = { minor: 1, major: 2 };
const ALL_SEVERITIES: readonly Severity[] = ["minor", "major"];

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
    expect(severityFor(MISORDERED, "visa", 5)).toBe("major");
    expect(severityFor(MISORDERED, "visa", 5)).not.toBe("minor");
  });

  it("reports major at five days out however the rows are ordered", () => {
    // "Escalation is therefore a property of the data rather than of row
    // ordering" (spec:42). A Settings table has no guaranteed order — an admin
    // edit, a re-seed or a query without ORDER BY can hand these over either
    // way round — so the answer must be invariant under permutation, not merely
    // correct for the one order somebody happened to try.
    for (const ordering of permutations(MISORDERED)) {
      const shown = ordering.map((r) => `${r.businessDaysBefore}→${r.severity}`).join(", ");
      expect(severityFor(ordering, "visa", 5), `rows ordered {${shown}}`).toBe("major");
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
      const answers = new Set(orderings.map((ordering) => String(severityFor(ordering, "visa", days))));
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
      const answer = severityFor(rules, "visa", days);
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
      const answer = severityFor(rules, "filing", days);
      const rank = answer === null ? 0 : RANK[answer];
      expect(rank, `severity fell between ${days + 1} and ${days} days remaining`).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
    // Where the walk ends is the overdue rule's answer, not this block's, so it
    // is named by reference rather than as a literal severity.
    expect(previous, "the walk never reached a breach at all").toBe(RANK[highestSeverity()]);
  });

  it("reads only the rows for the type it was asked about", () => {
    // A major licence window must not make a visa major, and it must not make
    // an unbreached visa breach. Cross-type leakage is invisible in production:
    // it produces a plausible-looking severity for the wrong reason.
    const rules = [rule("visa", 7, "minor"), rule("trade-licence", 90, "major")];
    expect(severityFor(rules, "visa", 5)).toBe("minor");
    expect(severityFor(rules, "visa", 60)).toBeNull();
    expect(severityFor(rules, "trade-licence", 60)).toBe("major");
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
    expect(severityFor(SEVEN, "visa", days)).toBe(breached ? "minor" : null);
  });

  it("is still breached one day overdue, at whatever severity the overdue rule gives", () => {
    // Past the bound is still inside the window: the inclusive comparison does
    // not stop applying once the distance goes negative, and a lapsed visa must
    // not fall out of the breach set. WHICH severity comes back is the overdue
    // rule's business (spec:50) and not this block's, so it is asserted by
    // reference to the scale rather than written out as a severity here.
    expect(severityFor(SEVEN, "visa", -1)).not.toBeNull();
    expect(severityFor(SEVEN, "visa", -1)).toBe(highestSeverity());
  });

  it("is inclusive at the bound for a major window too", () => {
    // The rule is about the comparison, not about which severity sits on it.
    const rules = [rule("filing", 7, "major")];
    expect(severityFor(rules, "filing", 8)).toBeNull();
    expect(severityFor(rules, "filing", 7)).toBe("major");
  });

  it("escalates exactly at the wider bound, not a day late", () => {
    // {30 → major, 7 → minor}: at 31 days nothing is breached, at exactly 30 the
    // major window is. Inclusivity and "maximum across breached windows" meet
    // here — the day the escalation lands is the day the wider bound is reached.
    expect(severityFor(MISORDERED, "visa", 31)).toBeNull();
    expect(severityFor(MISORDERED, "visa", 30)).toBe("major");
    expect(severityFor(MISORDERED, "visa", 8)).toBe("major");
  });

  it("treats a zero-day window as breaching on the due date and not before", () => {
    // The boundary of the boundary: a window of 0 says "tell me the day it is
    // due". One day before is not that day; the day itself, and every day after
    // it, is.
    const rules = [rule("heartbeat", 0, "major")];
    expect(severityFor(rules, "heartbeat", 1)).toBeNull();
    expect(severityFor(rules, "heartbeat", 0)).toBe("major");
    // One day later it is overdue, and the overdue rule answers — by reference.
    expect(severityFor(rules, "heartbeat", -1)).toBe(highestSeverity());
  });

  it("holds at the bound of every window in a multi-row table", () => {
    // Each bound checked at bound+1, bound and bound-1, with the answer being
    // the maximum of everything breached at that distance.
    const rules = [rule("visa", 30, "minor"), rule("visa", 14, "minor"), rule("visa", 5, "major")];
    expect(severityFor(rules, "visa", 31)).toBeNull();
    expect(severityFor(rules, "visa", 30)).toBe("minor");
    expect(severityFor(rules, "visa", 15)).toBe("minor");
    expect(severityFor(rules, "visa", 14)).toBe("minor");
    expect(severityFor(rules, "visa", 6)).toBe("minor");
    expect(severityFor(rules, "visa", 5)).toBe("major");
    expect(severityFor(rules, "visa", 4)).toBe("major");
  });
});

// ---------------------------------------------------------------------------
// Assertion 3 — an overdue deadline takes the top of the SEVERITY SCALE.
// ---------------------------------------------------------------------------
//
// This is the one place the overdue rule is stated. Every other block that
// passes a negative distance defers to `highestSeverity()` rather than naming a
// band, so this rule can be changed again in one file and one describe.

describe("an overdue deadline reports the highest severity band the scale defines", () => {
  // spec:48,50 — "an **overdue** deadline, with negative days remaining, reports
  // the **highest severity band the severity scale defines**, not the highest
  // band configured for its type... A type whose Settings rows are all `minor`
  // still reports the **highest** band once it is past due; the ceiling comes
  // from the severity scale, not from which windows an admin happened to write
  // for that type."
  //
  // Ahmed's decision of 2026-08-16, REVERSING the earlier per-type reading that
  // this file previously pinned. The oracle is legacy, which has no per-type
  // severity at all: reference/legacy/lib/email.ts:174 buckets every item with
  // `daysLeft < 0` together, :238-239 renders that bucket as the red "🔴 Overdue
  // — action needed now" section ahead of critical, and :260 counts all of it
  // into the "⚠️ N urgent" subject line — for every item, regardless of type.
  // Read as a per-type ceiling, this build was quieter than the product it
  // replaces on exactly the deadlines that are already late.
  //
  // The band is written as `highestSeverity()` throughout and never as the
  // string "major": the claim is "the top of the scale", so a level added above
  // major must move these tests with it rather than leave them passing against
  // the old ceiling.

  /** All-minor rows: the case where the two readings disagree. */
  const MINOR_ONLY: readonly ThresholdRule[] = [
    rule("stationery-order", 14, "minor"),
    rule("stationery-order", 3, "minor"),
  ];

  it("has a scale whose top outranks minor, so the cases below can discriminate", () => {
    // A guard, not a rule. If `Severity` ever collapsed to a single band, every
    // "top of the scale" assertion below would pass without proving anything —
    // the old per-type reading would satisfy them too. This fails loudly in that
    // case instead of letting the block go quietly vacuous.
    expect(RANK[highestSeverity()], "the scale has no band above minor").toBeGreaterThan(RANK.minor);
  });

  it("reports the top of the scale for a type whose only configured windows are minor", () => {
    // THE discriminating case, and the one this node flips. Nothing here is
    // configured major. The old reading answered `minor` — a lapsed item sitting
    // below the urgent band forever because of which rows an admin wrote — and
    // legacy would have had it in the red section. Under-warning is the silence
    // this module exists to prevent (spec:42).
    expect(severityFor(MINOR_ONLY, "stationery-order", -5)).toBe(highestSeverity());
    expect(RANK[severityFor(MINOR_ONLY, "stationery-order", -5) as Severity]).toBeGreaterThan(RANK.minor);
  });

  it("reports the top of the scale for a type that does configure a major window", () => {
    // The other polarity: where the two readings agree, the answer is unchanged.
    // A reversal that only moved the disagreeing case and broke this one would
    // be a different rule again.
    expect(severityFor(MISORDERED, "visa", -1)).toBe(highestSeverity());
    expect(severityFor(MISORDERED, "visa", -40)).toBe(highestSeverity());
  });

  it.each([-1, -2, -7, -30, -365, -3650])("is at the top of the scale %i days overdue, whatever the rows say", (days) => {
    // Long overdue is not less serious than newly overdue. An expired visa stops
    // an engineer working (spec:7) for as long as it stays expired, and legacy
    // counts it as urgent on day 3650 exactly as on day 1.
    expect(severityFor(MINOR_ONLY, "stationery-order", days)).toBe(highestSeverity());
    expect(severityFor(MISORDERED, "visa", days)).toBe(highestSeverity());
  });

  it("answers the same band for two types configured completely differently", () => {
    // Legacy's actual behaviour, stated as an equality rather than as a value:
    // one overdue bucket for every item regardless of type (email.ts:174). If a
    // type's own rows still capped it, these two would differ.
    const minorOverdue = severityFor(MINOR_ONLY, "stationery-order", -9);
    const majorOverdue = severityFor(MISORDERED, "visa", -9);
    expect(minorOverdue).toBe(majorOverdue);
    expect(minorOverdue).toBe(highestSeverity());
  });

  it("does not vary with which windows the type happens to have", () => {
    // Four tables for one type — minor-only, major-only, mixed, and a single
    // zero-day row — all overdue by the same distance. The rows decide WHETHER a
    // non-overdue deadline is breached; once it is past due they no longer
    // decide how serious it is.
    const tables: readonly (readonly ThresholdRule[])[] = [
      [rule("filing", 1, "minor")],
      [rule("filing", 90, "major")],
      [rule("filing", 30, "major"), rule("filing", 7, "minor"), rule("filing", 2, "minor")],
      [rule("filing", 0, "minor")],
    ];
    const answers = tables.map((table) => severityFor([...table, ...OTHER_TYPE], "filing", -3));
    for (const [index, answer] of answers.entries()) {
      expect(answer, `table ${index} answered differently: ${JSON.stringify(tables[index])}`).toBe(highestSeverity());
    }
    expect([...new Set(answers.map(String))], "the answer depended on the type's rows").toHaveLength(1);
  });

  it("treats zero days remaining as not overdue, and minus one as overdue", () => {
    // The boundary of the rule, on the table where the two rules disagree: due
    // TODAY is not late, so the window rule still answers and the answer is the
    // row's own minor. One day later it is late, and the scale answers. Reading
    // 0 as overdue would report every deadline due today at the top band —
    // over-warning on the one day the thing can still be done on time.
    expect(severityFor(MINOR_ONLY, "stationery-order", 1)).toBe("minor");
    expect(severityFor(MINOR_ONLY, "stationery-order", 0)).toBe("minor");
    expect(severityFor(MINOR_ONLY, "stationery-order", 0)).not.toBe(highestSeverity());
    expect(severityFor(MINOR_ONLY, "stationery-order", -1)).toBe(highestSeverity());
  });

  it("does not escalate a type whose windows are not yet breached", () => {
    // Overdue is about the DISTANCE, not about the type. A minor-only type well
    // outside every window stays silent; the top band is not a default.
    expect(severityFor(MINOR_ONLY, "stationery-order", 40)).toBeNull();
    expect(severityFor(MINOR_ONLY, "stationery-order", 15)).toBeNull();
    expect(severityFor(MINOR_ONLY, "stationery-order", 14)).toBe("minor");
  });

  it("is the top of the scale for every overdue distance, whatever the table", () => {
    // The property, with the expectation held CONSTANT. The old version of this
    // test computed its expectation as the maximum over the configured rows,
    // which made it a second copy of the business rule — and a copy that agreed
    // with the implementation by construction, so the reversal had to be made in
    // two places. There is nothing to re-derive now: overdue is the top band.
    const next = random(20260816);
    for (let trial = 0; trial < 200; trial += 1) {
      const rules: ThresholdRule[] = [...OTHER_TYPE];
      const windows = 1 + Math.floor(next() * 4);
      // Half the trials are deliberately minor-only — the discriminating shape,
      // which a uniform draw would produce in barely a tenth of them.
      const minorOnly = next() < 0.5;
      for (let i = 0; i < windows; i += 1) {
        const severity = minorOnly ? "minor" : ALL_SEVERITIES[Math.floor(next() * 2)];
        rules.push(rule("visa", Math.floor(next() * 41), severity));
      }
      const days = -1 - Math.floor(next() * 90);
      const shown = JSON.stringify({ rules, days });
      expect(severityFor(rules, "visa", days), shown).toBe(highestSeverity());
      expect(severityFor(rules, "visa", days), `overdue answered nothing: ${shown}`).not.toBeNull();
    }
  });

  it("does not invent a severity for an overdue deadline of an unconfigured type", () => {
    // The two decisions meet here, and the reversal did NOT touch this one
    // (spec:52): "Absence of a row is a hole, not a severity, and overdue is not
    // a licence to score a type nobody configured." It raises as a
    // misconfiguration (spec:46) instead of being silently scored — and a type
    // scored at the top band would never raise at all.
    expect(severityFor(OTHER_TYPE, "visa", -30)).toBeNull();
    expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);
  });

  it.each([-1, -2, -7, -30, -365, -3650])("leaves an unconfigured type unscored %i days overdue", (days) => {
    // At EVERY negative distance, not just the one a table happened to pick: an
    // implementation that short-circuits to the top band on `days < 0` before it
    // looks for a row passes the single case and fails here.
    expect(severityFor(OTHER_TYPE, "visa", days), "a type with no row was scored").toBeNull();
    expect(severityFor([], "visa", days), "an empty table scored a type").toBeNull();
    expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);
  });

  it("scores an overdue type as soon as one row exists, and not before", () => {
    // The two sides of the same boundary, one row apart. This is what makes the
    // unconfigured hole a hole rather than a quiet band: adding any row at all —
    // even a minor one-day window — turns silence into the top band.
    const withoutRow: readonly ThresholdRule[] = [...OTHER_TYPE];
    const withOneRow = [...OTHER_TYPE, rule("visa", 1, "minor")];
    expect(severityFor(withoutRow, "visa", -2)).toBeNull();
    expect(severityFor(withOneRow, "visa", -2)).toBe(highestSeverity());
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

  it("distinguishes not-breached from not-configured", () => {
    // Both answer `null` from severityFor, and they are opposite facts: the
    // first is "I looked, it is fine", the second is "nobody is looking". If a
    // caller cannot tell them apart, an unwatched visa reads as a healthy one.
    const configured = [rule("visa", 7, "minor")];
    expect(severityFor(configured, "visa", 40)).toBeNull();
    expect(isConfigured(configured, "visa")).toBe(true);

    expect(severityFor(OTHER_TYPE, "visa", 40)).toBeNull();
    expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);

    expect(isConfigured(configured, "visa")).not.toBe(isConfigured(OTHER_TYPE, "visa"));
  });

  it.each([120, 30, 7, 1, 0, -1, -90])("stays unconfigured at %i days remaining", (days) => {
    // Distance cannot configure a type. There is no number of days at which a
    // missing row starts answering, in either direction.
    expect(isConfigured(OTHER_TYPE, "visa")).toBe(false);
    expect(severityFor(OTHER_TYPE, "visa", days)).toBeNull();
  });

  it("returns null, not a falsy severity, when nothing is breached", () => {
    // `""`, `undefined` and `false` would all read as "no breach" at a call
    // site written with `if (severity)`, and all three would then be reported
    // to the Alert Manager as a severity if written with `severity ?? …`.
    // The absence has to be exactly null.
    const answer = severityFor([rule("visa", 7, "minor")], "visa", 40);
    expect(answer).toBeNull();
    expect(answer).not.toBeUndefined();
    expect(ALL_SEVERITIES).not.toContain(answer);
  });

  it("does not treat an empty table as a clean bill of health for any type", () => {
    for (const type of ["visa", "filing", "trade-licence", "passport"]) {
      expect(isConfigured([], type), `${type} reported as configured against an empty table`).toBe(false);
      expect(severityFor([], type, 3), `${type} scored against an empty table`).toBeNull();
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
    const early = severityFor(rules, "expiry", 20);
    const late = severityFor(rules, "expiry", 5);
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
    expect(severityFor(before, "expiry", 10)).toBeNull();
    expect(severityFor(after, "expiry", 10)).toBe("major");
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
      const answer = severityFor(rules, "visa", days);
      if (answer === null) continue;
      expect(RANK[answer], `${days} days remaining exceeded the maximum severity`).toBeLessThanOrEqual(
        RANK[highestSeverity()],
      );
    }
  });
});
