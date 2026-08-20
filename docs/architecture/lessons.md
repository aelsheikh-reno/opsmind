# What this build has already got wrong

> Read this before writing code or tests. Every line is a defect that actually
> happened here, with the shape that produced it — not general advice.
>
> It exists because every agent starts cold. The knowledge was in ninety backlog
> nodes and forty ADRs, which nobody reads in full, so the same mistakes arrived
> twice. Distilled, and short on purpose: a list nobody finishes is a list that
> does not work.

## Code that cannot be covered should not be written

- **An unreachable branch is not untested code.** `markUnchecked` gained a
  create-if-absent arm every caller had already made dead. `diff-cov` refused at
  88.89% and no test could ever have reached it. Route the other caller through
  the same helper instead, so both arms are live.
- **A reader nothing calls is dead too.** `createMemoryAlertStore` shipped
  `listAlerts`/`listAlertEvents` that no test and no production path invoked.
  Removed, not tested — a test for a function nothing calls is a test of the test.

## A reusable component must not import its caller

- Binding against `AlertManager` imported from `lib/modules/deadlines` would have
  put the word *deadline* inside a package whose whole point is portability, and
  made it depend on one of its callers. TypeScript is structural: declare your own
  types and put the assignability check in a test.

## One-directional checks look bidirectional

- **`const bound: Port = client()` proves "no narrower", never "no wider".**
  TypeScript lets an implementation with fewer parameters satisfy a wider
  signature, so dropping `scopes` from `reportRun` compiled clean and passed all
  81 cases — while the comment claimed that exact mutation was caught. A second
  binding in the other direction is what makes it *exact*.

## Matching by substring is not matching by name

- `grep -qi "$model"` let a repository declaring `AlertEvent` touch `Alert`,
  because `alert` occurs inside `alertevent`. Every table here is a prefix pair.
  Compare whole tokens.
- **A pattern that matches nothing looks identical to a rule that passes.**
  `@/lib/modules/*/!(index)` never fired — eslint 9 uses gitignore syntax, not
  extglob. It had never fired, and nothing noticed.

## Read what the code does, not what it is spelled

- `grep -oE 'db\.[a-zA-Z]+\.'` cannot see `tx.alert` inside
  `db.$transaction(async (tx) => ...)`, so a repository could touch an undeclared
  table invisibly. **And do not hardcode `tx`** — the handle is a name the author
  chooses; read it from the source or a rename evades you.

## Derive a list from its criterion; never write it from memory

- The suite-scoping trigger list was wrong **twice**. First it omitted
  `tests/gates/`, so the PR changing the pipeline's own tests was the one PR not
  running them. Then it omitted `tsconfig.json`, so a diff disabling `strict`
  skipped the only test that would notice and `tsc --noEmit` passed trivially with
  every gate green. The criterion — *does changing this file change what these
  tests should say?* — was answerable by grep the whole time.

## A verdict must describe the run it came from

- `test-count` read `numTotalTests` from a **different** invocation than the one
  whose pass/fail it printed, and reported "1064 tests, floor is 1111" on a
  docs-only commit. A suite that fails to collect contributes no tests *and no
  complaint*, so refuse the count rather than reading it.
- **State what you measured.** `ALL GATES PASS` was once printed from a run made
  before the commit it described (ADR-031).

## Assert the distinction, not the spelling

- `AlertEventKind` has nine members and no document fixes which a reassert
  carries. Assert that a first sighting, a re-raise and an escalation are three
  *different* things; pin a literal only where a document fixes it.

## Executing is not being asserted about

- `raiseKind` decides what every audit-log entry says happened. Two mutations of
  it survived all 188 cases while `diff-cov` read **100%** — the lines ran, they
  were never asserted about. Coverage cannot see this; a mutation run can.

## Noticing a gap is not closing it

- A gap named in this file and reproduced in your own diff is **closed in that
  diff**, or the node does not merge. `prismaAlertStore` gained a port method
  while being bound to that port in neither direction — the exact shape recorded
  two entries above. The test-author found it, wrote it down, and it shipped to
  review anyway. The analysis was done; the loop from *noted* to *taken* was not.
- **The one-directional trap survived its own fix.** The first reverse probe used
  the same mapped type on both sides, so TypeScript compared the two source types
  rather than the mapped results and fell back into the bivariance the probe
  existed to defeat — compiling clean with the parameter dropped. Check that a
  guard bites by breaking the thing it guards, even when the guard is the fix for
  a guard.
- **`satisfies` is not the tool for a port.** On an object literal it applies
  excess-property checking, so a store legitimately carrying more members than
  the port requires is rejected. The relationship is *assignability*: assign an
  existing variable, not a fresh literal.

## Measure, do not estimate

- A figure that cannot be reproduced is **withdrawn, not defended** — name the
  patch and the commit it came from.
- Plausible arguments that died on measurement: *"a lockfile changes constantly
  and would scope-bust everything"* (3 commits in all history touch it, 0
  lock-only) and *"`vitest.config.ts` must be a trigger"* (every reference is a
  fixture string).

## Verification is stubbed until it has to be real

- Testing a gate means running the gate. One node made **sixteen real gate runs**
  — 64 of its 83 minutes — before discovering a stubbed `npx` gave the same
  evidence in seconds. Stub from the first probe. Two real runs at the end, no
  more.
- **Do not produce wall-clock timings.** Three measurements of one change gave
  238→140s, 185→147s and 114→75s; all three were struck as unreproducible. State
  files, tests and invocations instead.

## Write down what you know you did not check

- Four consecutive reviews found this: a known gap recorded in a PR description,
  or one comment in one file, or a message to a reviewer — none of which survives
  a merge. Put it where the next reader already is: the script, the ADR, or
  `open-items.md`.

## A catalogue read is scoped, or it answers a different question per engine

- `pg_tables` and `information_schema` see the whole **database**, not your
  schema. PGlite gives each test file its own database; `DATABASE_URL` gives the
  whole suite one database with a schema apiece. So the identical query returns
  **one** row locally and **four** in CI, and a case that then bolts
  `CHECK (false)` onto "the" table it found would have poisoned another file's
  schema. Constrain on `schemaname`, from the harness's own naming rule rather
  than a second copy of it.
- Green on one engine is not green. When a case reaches past the ORM, run it
  under both before believing it.
- The reason this cost a red gate and not a corrupted suite: the lookup
  **refused when the answer was ambiguous** instead of taking the first row. A
  guard that stops on "more than one" is worth writing even when you are sure
  there can only be one.
