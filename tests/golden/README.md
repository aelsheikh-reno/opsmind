# Golden dataset

Inputs for the differential harness (`tests/differential/harness.ts`). Each
golden case is one input that gets pushed through the legacy system and through
this build, with the two outputs diffed field by field.

## The anonymisation rule — read this before adding anything

**No real salary, no real passport number, no real Emirates ID. Ever. No
exceptions for "just this one case".**

A golden file is committed. Once it is pushed it is readable by everyone with
repository access, it is in every clone, it is in the reflog and in every CI
log that prints a failing diff, and it stays there after the person it describes
has left. A file deleted later is still in history. Treat anything you put here
as published.

Also excluded: real names, national IDs, IBANs, bank account numbers, addresses,
phone numbers, personal email addresses, visa and work-permit numbers, and the
client names on real engagements. If it identifies a person or a client, it does
not belong in a file that lives forever.

If a bug only reproduces on a real payload, do not paste the payload. Derive a
case from it using the recipes below and confirm it still reproduces.

### Deriving a case from a real one

- **Amounts.** Multiply every amount in the case by one factor, then check the
  scaled figure still falls on the same side of every threshold it touched:
  tax brackets, social-insurance ceilings and floors, VAT registration limits,
  the prorata boundaries. Scaling a 40,000 AED salary by 0.5 can move it into a
  different bracket and the case stops testing what it was added to test. Round
  to the currency's minor unit, and record which thresholds you checked in the
  case `note`.
- **Dates.** Shift by a whole number of years so weekday alignment and the
  Sunday–Thursday working week survive, and re-check month lengths and any
  Ramadan- or holiday-dependent rule.
- **Identifiers.** Use an obviously fake shape: keep the real prefix so a format
  check still exercises something, and make every remaining digit the same one.
  Emirates ID `784-0000-0000000-0`, passport `A0000000`, IBAN
  `AE000000000000000000000`, employee code `EMP-0000`. A run of identical digits
  reads as a placeholder at a glance and cannot collide with a real record. An
  identifier with varied digits looks invented but could belong to someone, so
  do not write one down — not even as an example of what not to write.
- **Names.** `Employee One`, `Client A`. Not a plausible-looking invented
  person — a reader must not have to guess whether it is real.

## Layout

```
tests/golden/<domain>/<case-set>.json
```

`<domain>` is the business area: `payroll`, `prorata`, `tax`, `vat`, `fx`,
`deadlines`, `billing`. One file may hold many cases.

## File shape

```json
{
  "domain": "prorata",
  "note": "why this set exists and what it is meant to catch",
  "options": {
    "minorUnitScale": 100,
    "toleranceMinorUnits": 0,
    "ignorePaths": ["generatedAt"]
  },
  "cases": [
    {
      "name": "mid-month leaver, 21 of 30 days, AED",
      "note": "scaled x2 from a real case; still below the pension ceiling",
      "input": { "monthlySalary": 24000, "currency": "AED", "leaveDate": "2025-06-21" }
    }
  ]
}
```

A case carries an **input only**. There is no `expected` field, because the
expected value is whatever the legacy system computes at run time — that is the
whole point of a differential test. Pinning an expected value here would make
the file agree with itself.

`options` is a `DiffOptions` from `tests/differential/diff-fields.ts` and is
passed straight through.

- **`minorUnitScale` must be set per jurisdiction.** The default is 100, which
  is **wrong for KWD and BHD** — both are three-decimal currencies and need
  `1000`. At scale 100 a genuine one-fils gap (1234.567 vs 1234.568) is finer
  than a minor unit, so the difference is reported under its own cause,
  `sub-minor-unit`. The harness still fails the case — at every tolerance,
  because no tolerance can suppress that cause — and it still prints both raw
  values and the exact gap: `sub-minor-unit` means precisely and only that the
  two values are strictly less than one minor unit apart, and the detail says by
  how much ("they are 0.1 minor units apart"). A pair exactly one minor unit
  apart never lands here: `0.135` vs `0.145` at scale 100 is a gap of 1 and
  reports `value-mismatch`. So the cause does tell you how far apart the two
  sides are — but in hundredths of a dinar, not in the fils the payslip is
  written in. Set the scale.
- **`toleranceMinorUnits`** is a count of minor units, not a fraction. Leave it
  at 0 unless a divergence has been approved.
- **`ignorePaths`** is the escape hatch for values that are not comparable
  across the two systems — a generated timestamp, a database id, an ordering
  key. Use it for noise, never to hide a money or date field that disagrees.
  Every entry is an exact path and takes its whole subtree with it, so list the
  narrowest path that does the job and say in `note` why it is not comparable.

## Adding a case

1. Pick the domain directory, or create it.
2. Derive the case from real data using the recipes above, or invent it outright.
3. Give it a `name` that says what makes it interesting — the name is what a
   failing gate prints.
4. Run the differential suite. A new case that matches on the first run is
   evidence for this build; a new case that differs is a question for Ahmed
   before either side is changed, because the legacy behaviour is not
   automatically correct.
5. Re-read the file for anything real that survived the derivation.

## What a case is worth

Cases earn their keep at boundaries: the first and last day of a month, a
bracket edge and one unit either side, a leaver on a non-working day, a
three-decimal currency, a zero, a negative, an amount that rounds two ways.
A hundred cases in the middle of a range prove less than three on an edge.
