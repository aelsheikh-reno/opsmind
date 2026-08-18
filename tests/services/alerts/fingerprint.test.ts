// Assertion 2 of tasks/backlog.yaml#service-alerts-surface-and-lifecycle:
//
//   "A fingerprint is an opaque identity: the engine never splits it on the
//    separator, and two alerts differing anywhere in the string are two alerts"
//
// The node's note, verbatim: "THE FINGERPRINT MUST STAY OPAQUE.
// flows-alerting.md documents the pattern {tenant}:{app}:{source}:{entity}:{policy}
// — five segments, of which the entity is itself compound — while fingerprintFor
// emits six colon-joined parts and escapes both ':' and the backslash inside a
// segment. An engine that splits on the separator to group or route will
// mis-split every deadline alert and silently merge two identities, which is
// the exact failure the escaping was added to prevent."
//
// data-model.md's Alert card says the same about the column: "Opaque to the
// engine: never split, never parsed."
//
// WHY THIS FILE READS THE SOURCE AS WELL AS CALLING THE CLIENT. At this node
// the service has no store — "No persistence… no verbs with side effects" — so
// two identities merging is not observable from a return value: both calls
// return the same `Promise<void>` either way. The failure lives in the text, so
// the text is where it is looked for. The behavioural half of this rule, "two
// raises of the same fingerprint produce one open alert, not two", belongs to
// service-alerts-raise, which has a store to see it with.
//
// Written from the specification alone: no file under lib/services/alerts/ was
// read by the author. The fingerprints below are built by the deadline
// monitor's own public helper rather than spelled out here, because their
// encoding is the source's business and this file's subject is what the ENGINE
// does with the result.
import { describe, expect, it } from "vitest";

import { fingerprintFor } from "@/lib/modules/deadlines";

import { literals, serviceCode, serviceFiles } from "./service-source";
import { AREA, AT, MAJOR, POLICY, SOURCE, declaredShapes, identityShape, typeText, verb } from "./surface";

const TENANT = "reno";

/** The separator, and the whole of what the engine may not do with it. */
const SEPARATOR = ":";

describe("the engine never takes a fingerprint apart", () => {
  it("has files to read, so this sweep is clean rather than empty", () => {
    // Every case below asserts that a search found nothing, which is also what
    // a search over an empty directory returns. serviceFiles() throws when
    // index.ts or lifecycle.ts is missing; this states the guard as a case so
    // the reason is in the report rather than only in a stack trace.
    const files = serviceFiles();
    expect(files.map((file) => file.name)).toEqual(
      expect.arrayContaining(["index.ts", "lifecycle.ts"]),
    );
    for (const file of files) {
      expect(serviceCode(file).trim(), `${file.relative} is empty`).not.toBe("");
    }
  });

  it("splits no string, anywhere in the service", () => {
    // The mutation this is pointed at is the one the note names: an engine that
    // groups or routes by `fingerprint.split(":")`. Any split at all is flagged
    // rather than only a split on the separator, because the engine at this
    // node has exactly one string that matters and no reason to cut any string
    // up; a split on some other character that happens to land inside an
    // escaped segment is the same defect wearing a different argument.
    const offenders = serviceFiles().flatMap((file) => {
      const code = serviceCode(file);
      return [...code.matchAll(/\.split\s*\(/g)].map(
        (match) => `${file.relative}: ${code.slice(match.index, (match.index ?? 0) + 40).trim()}`,
      );
    });
    expect(
      offenders,
      'data-model.md, Alert.fingerprint: "Opaque to the engine: never split, never parsed"',
    ).toEqual([]);
  });

  it("uses the separator as a separator nowhere — no split argument, no join, no pattern", () => {
    // The other direction, and the reason it is here: an engine does not have
    // to split to merge two identities. Keying an in-memory map on
    // `${sourceId}:${fingerprint}` — the data model's `@@unique([sourceId,
    // fingerprint])` written as one string — collides ("a:b", "c") with ("a",
    // "b:c") exactly as the unescaped fingerprint did. The engine composes
    // identity from two values it holds separately, or it does not compose it
    // at all.
    //
    // NARROWED TO SEPARATOR TOKENS ON PURPOSE. A colon inside prose — "reportRun:
    // sourceId is required" — is punctuation, and failing on it would make the
    // error message worse to buy nothing. What is flagged is a literal that is
    // ONLY punctuation and contains a colon: `":"` as a split or join argument,
    // `/:/` as a pattern, and the `:` piece of a template such as
    // `` `${sourceId}:${fingerprint}` ``, which the parser hands back as its own
    // literal token sitting between two substitutions.
    //
    // Comments are already gone (see service-source.ts): an ADR quoted in a doc
    // comment carries colons and is not a finding. String CONTENTS are kept,
    // because a string is a value the engine computes with.
    const offenders = serviceFiles()
      .flatMap(literals)
      .filter((found) => found.text.includes(SEPARATOR) && !/[A-Za-z0-9]/.test(found.text))
      .map((found) => `${found.file}:${found.line} "${found.text}"`);
    expect(
      offenders,
      "the separator is the source's business. An engine that writes it is either splitting " +
        "on it or joining an identity around it, and both merge two alerts into one",
    ).toEqual([]);
  });

  it("models a fingerprint as one string, not as parts", () => {
    // The type-level half. data-model.md gives `fingerprint | string | The
    // source's deterministic identity`. A record that held `segments: string[]`,
    // or a fingerprint typed as anything structured, would have parsed it before
    // any code ran — and no amount of care downstream gets the identity back.
    const shape = identityShape();
    expect(
      shape,
      "the service declares nothing carrying a fingerprint, so it has no identity to key an " +
        `alert on (data-model.md, the Alert card). It declares: ${declaredShapes()}`,
    ).toBeDefined();
    const member = (shape as NonNullable<typeof shape>).members.find(
      (declared) => declared.name === "fingerprint",
    );
    expect(typeText(member as { type: string })).toBe(":string");
  });
});

// --------------------------------------------- two alerts, not one --------

/**
 * Two identities that differ ONLY inside an escape.
 *
 * The entity id is `1:2` in one and the three characters `1`, `\`, `:`, `2` in
 * the other. The node states the encoding — "fingerprintFor… escapes both ':'
 * and the backslash inside a segment" — so these two produce two different
 * strings, and every naive attempt to recover the segments from the result maps
 * them onto the same thing.
 */
const ESCAPED_COLON = fingerprintFor(TENANT, "document", "1:2", POLICY);
const LITERAL_BACKSLASH = fingerprintFor(TENANT, "document", "1\\:2", POLICY);

/**
 * The same characters, grouped into different segments — one deadline whose id
 * is `1:2` and another whose entity type is `document:1`. This is the collision
 * the escaping was added for (tests/modules/deadlines/thresholds.test.ts pins
 * the module's side of it); here it is the engine's turn not to undo it.
 */
const SPLIT_ON_TYPE = fingerprintFor(TENANT, "document:1", "2", POLICY);

describe("two fingerprints differing anywhere are two alerts", () => {
  it("keeps a pair apart that differs only inside an escape", () => {
    // "two alerts differing anywhere in the string are two alerts — including
    // strings that differ only inside an escape". This is the premise the whole
    // engine rests on: identity is the string, so distinct strings are distinct
    // alerts, and nothing downstream may normalise that difference away.
    expect(ESCAPED_COLON).not.toBe(LITERAL_BACKSLASH);
    expect(ESCAPED_COLON).not.toBe(SPLIT_ON_TYPE);
  });

  it("is a real trap: a naive splitter merges the pair that escaping keeps apart", () => {
    // The detector's own case. Every assertion above says a search found
    // nothing, which is also what a broken search returns — so here is the
    // engine those cases exist to reject, written out and shown doing the
    // damage. `split` then "tidy the escapes away" is not a strawman: it is what
    // an engine does the moment it wants `{tenant}:{app}:{source}` as a group
    // key and finds seven parts where the spec printed five.
    const naive = (fingerprint: string): string =>
      fingerprint
        .split(SEPARATOR)
        .map((part) => part.replace(/\\/g, ""))
        .join(" ");

    expect(naive(ESCAPED_COLON), "the two collapse onto one identity").toBe(
      naive(LITERAL_BACKSLASH),
    );
    expect(naive(ESCAPED_COLON), "and so do these two").toBe(naive(SPLIT_ON_TYPE));
    // And the whole strings, which is what the engine holds, do not.
    expect(new Set([ESCAPED_COLON, LITERAL_BACKSLASH, SPLIT_ON_TYPE]).size).toBe(3);
  });

  it("accepts both members of a colliding pair, through both port verbs", () => {
    // The client's half of it. An engine that parsed the fingerprint would have
    // to decide what to do with a segment count it did not expect, and the
    // honest failure modes are a throw and a silent merge. A throw is visible
    // here; the merge is what the source sweep above catches, and what
    // service-alerts-raise proves against a store.
    const raise = verb("raiseAlert");
    const report = verb("reportRun");
    return Promise.all([
      raise(ESCAPED_COLON, MAJOR, POLICY, [AREA], { at: AT }),
      raise(LITERAL_BACKSLASH, MAJOR, POLICY, [AREA], { at: AT }),
      report(
        SOURCE,
        "run-fingerprint",
        [
          { fingerprint: ESCAPED_COLON, severity: MAJOR, area: AREA },
          { fingerprint: SPLIT_ON_TYPE, severity: MAJOR, area: AREA },
        ],
        [{ area: AREA, complete: true }],
      ),
    ]);
  });
});
