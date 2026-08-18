// Fixtures and plumbing for tasks/backlog.yaml#service-alerts-surface-and-lifecycle.
// Written from the specification alone: no file under lib/services/alerts/ was
// read by the author of these tests. Every expected value below comes from
//
//   · the node in tasks/backlog.yaml, including its note;
//   · docs/architecture/flows-alerting.md — the lifecycle, the three source
//     shapes, the resolution semantics;
//   · the "Alert Manager" section of docs/architecture/data-model.md — the
//     Alert, AlertArea, AlertEvent and AlertSource cards;
//   · ADR-020 (four states), ADR-039 (importable package), ADR-040 (areas
//     argument, failed alert), ADR-043 (`area`, not `jurisdictionId`),
//     ADR-044 (impact vs fault);
//   · lib/modules/deadlines/index.ts — the AlertManager port, which is already
//     merged and already calling.
//
// ---------------------------------------------------------------------------
// TOLERANT PLUMBING, STRICT ASSERTIONS — the same bargain
// tests/modules/deadlines/surface.ts struck, and for the same reason.
//
// The specification fixes the INFORMATION and, for most of this node, not its
// spelling. flows-alerting.md names five verbs and ADR-020 names four states;
// nothing anywhere says whether the severity ordering is `raiseSeverity`,
// `maxSeverity` or a rank function, or whether the open/closed predicate takes
// a state or a whole alert. So the resolvers below accept every spelling that
// carries exactly the required information and refuse everything else, and each
// one proves the binding is the right SHAPE before it is used — a candidate
// that returns something other than a severity, or something other than a
// boolean, is passed over rather than asserted against, so a mis-binding shows
// up as "the service exports none of […]" naming what it does export, and never
// as a green test that measured the wrong function.
//
// Nothing about WHAT is asserted is relaxed by that. The information the
// specification requires is still required, every resolver fails loudly when it
// is absent, and no case anywhere in this directory is skipped.
//
// Everything is reached through `@/lib/services/alerts` — its index.ts, and
// nothing deeper. That is CLAUDE.md rule 4 and eslint block 1, which names
// `@/lib/services/*/!(index)` explicitly: a seam anyone can reach around is not
// a seam. It also means a behaviour this node asserts and does not publish is a
// finding, not a gap in the tests.
// ---------------------------------------------------------------------------
import * as service from "@/lib/services/alerts";

import type { Severity } from "@/lib/modules/deadlines";
import type { TypeBlock } from "@/tests/kernel/kernel-source";

import { serviceDeclarations, serviceTypeBlocks, stringUnion } from "./service-source";

/** The public surface, as values, so a name can be looked for rather than assumed. */
const exported = service as unknown as Record<string, unknown>;

export const exportedNames = (): string[] => Object.keys(exported).sort();

interface Bound<T> {
  /** Which of the candidate spellings the service actually uses. */
  name: string;
  value: T;
}

/**
 * The first export that exists AND has the right shape.
 *
 * `ok` is what stops this from being a wish: a resolver that took the first
 * name it found could bind `isOpen(alert)` to a call passing a state string and
 * assert against `undefined`. Shape-checking each candidate means the wrong
 * shape is passed over, and the failure — when every candidate is wrong — names
 * every export the service has, which is the whole diagnostic.
 */
export function pick<T>(
  what: string,
  names: readonly string[],
  ok: (value: unknown) => boolean,
): Bound<T> {
  const rejected: string[] = [];
  for (const name of names) {
    const value = exported[name];
    if (value === undefined) continue;
    if (!ok(value)) {
      rejected.push(name);
      continue;
    }
    return { name, value: value as T };
  }
  throw new Error(
    `lib/services/alerts/index.ts publishes nothing usable as ${what}. ` +
      `Looked for: ${names.join(", ")}. ` +
      (rejected.length > 0 ? `Found but wrongly shaped: ${rejected.join(", ")}. ` : "") +
      `It exports: ${exportedNames().join(", ") || "nothing"}.`,
  );
}

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === "function";

// ------------------------------------------------------------- the client --

/** The five verbs of the contract (flows-alerting.md, components-services.md:24). */
export const CONTRACT_VERBS = [
  "reportRun",
  "raiseAlert",
  "resolveAlert",
  "acknowledge",
  "suppress",
] as const;

/** Two of the five are the merged port the deadline monitor already calls. */
export const PORT_VERBS = ["reportRun", "raiseAlert"] as const;

export type AlertClient = Record<string, unknown>;

const looksLikeClient = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  PORT_VERBS.every((name) => typeof (value as Record<string, unknown>)[name] === "function");

/**
 * An Alert Manager client.
 *
 * A factory is passed one argument — a deps object carrying an injectable
 * clock, the shape every module in this build takes (`DeadlineDeps.now`) — so
 * that a factory which wants deps gets an object and a factory which wants none
 * ignores it. There is no store: the node has none ("No persistence… the store
 * arrives in a later node"), which is also why nothing in this directory needs
 * a database.
 */
export function client(): AlertClient {
  const direct = ["alerts", "alertManager"].map((name) => exported[name]).find(looksLikeClient);
  if (direct !== undefined) return direct as AlertClient;

  const factory = pick<(deps: unknown) => unknown>(
    "a factory for the Alert Manager client",
    ["createAlertManager", "alertManager", "makeAlertManager", "createAlertEngine", "createAlerts"],
    isFunction,
  );
  const built = factory.value({ now: () => AT });
  if (!looksLikeClient(built)) {
    throw new Error(
      `${factory.name}() returned something that is not an Alert Manager: it has no ` +
        `${PORT_VERBS.join(" and no ")}. flows-alerting.md fixes the contract at ` +
        `${CONTRACT_VERBS.join(", ")}.`,
    );
  }
  return built as AlertClient;
}

/** One verb off the client, as a callable. The five names are the spec's. */
export function verb(name: (typeof CONTRACT_VERBS)[number]): (...args: unknown[]) => unknown {
  const found = client()[name];
  if (!isFunction(found)) {
    throw new Error(
      `the client has no ${name}(). flows-alerting.md, "The contract — three verbs", and ` +
        `components-services.md:24 name all five: ${CONTRACT_VERBS.join(" · ")}.`,
    );
  }
  return found as (...args: unknown[]) => unknown;
}

// ------------------------------------------------------------- the states --

/**
 * The four of ADR-020, in the data model's own order.
 *
 * "The engine owns a four-state lifecycle (firing, acknowledged, suppressed,
 * resolved)" — ADR-020. data-model.md's Alert card repeats it as
 * "firing | acknowledged | suppressed | resolved … The four of ADR-020, and only
 * those four". These are spec values, not values read out of the service.
 */
export const FIRING = "firing";
export const ACKNOWLEDGED = "acknowledged";
export const SUPPRESSED = "suppressed";
export const RESOLVED = "resolved";
export const FOUR_STATES = [FIRING, ACKNOWLEDGED, SUPPRESSED, RESOLVED] as const;

/** The three that are not closed. flows-alerting.md: acknowledgement "never closes". */
export const OPEN_STATES = [FIRING, ACKNOWLEDGED, SUPPRESSED] as const;

/** A union of string literals in the service's source that contains `member`. */
function declaredUnionContaining(member: string): { where: string; values: string[] } | undefined {
  for (const declaration of serviceDeclarations()) {
    const values = stringUnion(declaration);
    if (values !== undefined && values.includes(member)) {
      return { where: `${declaration.file}:${declaration.line} ${declaration.name}`, values };
    }
  }
  return undefined;
}

/**
 * The state vocabulary the service actually declares, from the runtime value if
 * it publishes one and from its own source otherwise.
 *
 * Both are read because ADR-020's four can be written either way — as a union
 * of string literals or as an `as const` array the union is derived from — and
 * "STALE is not a fifth state" is a claim about the vocabulary however it is
 * spelled. A type has no runtime representation at all, so for that spelling
 * the text is the only place it exists.
 */
export function declaredStates(): { where: string; values: string[] } {
  for (const name of ["ALERT_STATES", "AlertStates", "STATES", "alertStates"]) {
    const value = exported[name];
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return { where: `the exported ${name}`, values: [...(value as string[])] };
    }
  }
  const union = declaredUnionContaining(FIRING);
  if (union !== undefined) return union;
  throw new Error(
    "the service declares no alert state vocabulary: no exported array of state names, and " +
      'no exported union of string literals containing "firing". ADR-020 fixes the lifecycle ' +
      `at four states — ${FOUR_STATES.join(", ")} — and something has to say so. It exports: ` +
      `${exportedNames().join(", ") || "nothing"}.`,
  );
}

// ---------------------------------------------------------- the predicate --

/** An alert-shaped value, generous enough for a predicate over records. */
export function alertLike(state: string, stale = false): Record<string, unknown> {
  return {
    sourceId: SOURCE,
    fingerprint: FP_A,
    state,
    stale,
    severity: MAJOR,
    policyId: POLICY,
    context: {},
    areas: [AREA],
    firstSeenAt: AT,
    lastSeenAt: AT,
    resolvedAt: state === RESOLVED ? AT : null,
  };
}

/**
 * Is an alert in this state open?
 *
 * Two shapes are accepted because two are defensible and the specification
 * picks neither: a predicate over the state alone, and one over the whole
 * alert. `stale` is passed to the record form deliberately — assertion 4 is
 * that an alert can be firing AND stale at once, so a predicate that reads the
 * flag must be given it, and one that does not is unaffected.
 */
export function isOpen(state: string, stale = false): boolean {
  const bound = pick<(value: unknown) => unknown>(
    "the open/closed predicate",
    ["isOpen", "isOpenState", "isAlertOpen", "open"],
    isFunction,
  );
  const asState = bound.value(state);
  if (typeof asState === "boolean") return asState;
  const asRecord = bound.value(alertLike(state, stale));
  if (typeof asRecord === "boolean") return asRecord;
  throw new Error(
    `${bound.name}() answered neither a state nor an alert with a boolean. ` +
      'flows-alerting.md: acknowledgement "pauses paging but never closes", so something has ' +
      "to be able to say that acknowledged and suppressed are still open.",
  );
}

// ----------------------------------------------------------- the severity --

/**
 * The two severities the merged port sends.
 *
 * `Severity` in lib/modules/deadlines is `"minor" | "major"`, pinned by
 * tests/modules/deadlines/thresholds.test.ts ("`minor` < `major` is the whole
 * of it") and by prisma/schema.prisma's `enum AlertSeverity { minor major }`.
 * The engine may hold a wider vocabulary — it serves other sources — but it
 * cannot hold a narrower one and still satisfy the port.
 */
export const MINOR: Severity = "minor";
export const MAJOR: Severity = "major";

const isSeverityish = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

const MAX_NAMES = [
  "raiseSeverity",
  "raisedSeverity",
  "raisedTo",
  "higherSeverity",
  "maxSeverity",
  "highestSeverity",
  "escalateSeverity",
  "monotonicSeverity",
  "severityMax",
];

function tryMax(current: string, incoming: string): string | undefined {
  for (const name of MAX_NAMES) {
    const candidate = exported[name];
    if (!isFunction(candidate)) continue;
    const answer = (candidate as (a: unknown, b: unknown) => unknown)(current, incoming);
    if (isSeverityish(answer)) return answer;
  }
  return undefined;
}

const RANK_NAMES = ["severityRank", "rankOfSeverity", "severityOrder", "severityIndex"];

function tryRank(current: string, incoming: string): string | undefined {
  for (const name of RANK_NAMES) {
    const candidate = exported[name];
    if (!isFunction(candidate)) continue;
    const here = (candidate as (value: unknown) => unknown)(current);
    const there = (candidate as (value: unknown) => unknown)(incoming);
    if (typeof here !== "number" || typeof there !== "number") continue;
    return there > here ? incoming : current;
  }
  return undefined;
}

/**
 * The severity vocabulary, lowest first, from whatever the service publishes.
 * Falls back to the two the port sends, which every implementation must hold.
 */
export function declaredSeverities(): string[] {
  for (const name of ["SEVERITY_ORDER", "SEVERITIES", "ALERT_SEVERITIES", "severityOrder"]) {
    const value = exported[name];
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return [...(value as string[])];
    }
  }
  const union = declaredUnionContaining(MAJOR);
  return union?.values ?? [MINOR, MAJOR];
}

/**
 * Which of the three encodings the service actually publishes, if any.
 *
 * Named so that a case can assert the severity ordering is the SERVICE's
 * answer. Without it, a service publishing only an ordered vocabulary would
 * pass every monotonicity case in this directory against arithmetic performed
 * here, which proves nothing about the engine.
 */
export function severityOrderingName(): string | undefined {
  for (const name of [...MAX_NAMES, ...RANK_NAMES]) {
    if (isFunction(exported[name])) return name;
  }
  return undefined;
}

/**
 * The higher of two severities — "monotonic while an alert is open: it may rise
 * in place; a genuine downgrade is resolve-then-reopen" (data-model.md, Alert
 * card; flows-alerting.md:34).
 *
 * Three encodings carry that rule and all three are read: a max-style function,
 * a rank function, and an ordered vocabulary. Whichever the service publishes,
 * the assertion made against it is the same one.
 */
export function higherSeverity(current: string, incoming: string): string {
  const max = tryMax(current, incoming);
  if (max !== undefined) return max;

  const ranked = tryRank(current, incoming);
  if (ranked !== undefined) return ranked;

  const ordered = declaredSeverities();
  // The last resort, and the one `orderingIsTheService`'s case exists to keep
  // honest: from here on the answer is derived from a declared ORDER rather
  // than computed by the service, so the "never falls" property would be a
  // claim about this file. That is why one case asserts the ordering is
  // something the service publishes and can be called.
  const at = (value: string): number => ordered.indexOf(value);
  if (at(current) >= 0 && at(incoming) >= 0) {
    return at(incoming) > at(current) ? incoming : current;
  }
  throw new Error(
    "the service publishes no severity ordering: no max-style function, no rank function, " +
      `and no ordered vocabulary holding ${MINOR} and ${MAJOR}. Severity is "monotonic while ` +
      'open" (data-model.md), and nothing can enforce that without an order. It exports: ' +
      `${exportedNames().join(", ") || "nothing"}.`,
  );
}

// ---------------------------------------------------------- the fixtures --

/** The deadline monitor's own source id — the value it already passes. */
export const SOURCE = "deadline-monitor";

/** A caller's opaque scope key (ADR-043). Here, as it happens, a jurisdiction. */
export const AREA = "AE";

export const POLICY = "expiry";

/** Fixed so a run is reproducible; every module in this build injects its clock. */
export const AT = new Date("2026-08-19T02:00:00Z");

export const FP_A = "reno:opsmind:deadline-monitor:document:1:expiry";
export const FP_B = "reno:opsmind:deadline-monitor:document:2:expiry";

/**
 * A declared member's type, as text, normalised: `: string;` and `:string` are
 * the same declaration and neither spelling is the subject of any case here.
 */
export const typeText = (member: { type: string }): string =>
  member.type.replace(/\s/g, "").replace(/;$/, "");

const has = (block: TypeBlock, name: string): boolean =>
  block.members.some((declared) => declared.name === name);

/**
 * The alert record the data model describes: the block that carries the state
 * and the flag beside it.
 *
 * Found by shape rather than by name because the card fixes the fields and not
 * the type's spelling. Undefined when the service declares no such block, which
 * every caller reports as the finding it is.
 */
export function alertShape(): TypeBlock | undefined {
  const blocks = serviceTypeBlocks();
  return (
    blocks.find((block) => has(block, "state") && has(block, "stale")) ??
    blocks.find((block) => has(block, "state"))
  );
}

/**
 * Where the record's identity is declared.
 *
 * data-model.md gives `Alert` one row per (sourceId, fingerprint), which a
 * TypeScript record may carry inline or inherit from a separate identity type —
 * `interface AlertRecord extends AlertIdentity` says exactly the same thing as
 * one block with every field in it. Both are read: the record itself when it
 * declares a fingerprint, then a block the record's own declaration names, then
 * the one carrying source and fingerprint together.
 */
export function identityShape(): TypeBlock | undefined {
  const blocks = serviceTypeBlocks();
  const record = alertShape();
  if (record !== undefined && has(record, "fingerprint")) return record;

  const carriers = blocks.filter((block) => has(block, "fingerprint"));
  const inherited =
    record === undefined
      ? undefined
      : carriers.find((block) => new RegExp(`\\b${block.name}\\b`).test(record.raw));
  return inherited ?? carriers.find((block) => has(block, "sourceId")) ?? carriers[0];
}

/** What the service does declare, for a failure message worth reading. */
export const declaredShapes = (): string =>
  serviceTypeBlocks()
    .map((block) => `${block.name}(${block.members.map((member) => member.name).join(", ")})`)
    .join("; ") || "no exported type at all";
