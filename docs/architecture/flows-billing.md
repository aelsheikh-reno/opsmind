# Billing

> OpsMind decides; Zoho and the accredited provider issue. The flow stops at handoff because a PDF is not a legal tax invoice in the UAE — only structured e-invoices transmitted through an Accredited Service Provider qualify.

### Context

**The business problem.** Turning delivered work into money involves a judgement (is this ready?), a legal act (issuing a tax invoice), and a financial record (what is now owed) — three things done by three different parties.

**Why this exists as its own component.** Drawing this as a flow makes the handoff visible. The single most consequential fact about billing in OpsMind is where the system stops, and that is easier to see as a sequence than as a component description.

**What it does.** It follows one milestone from completion to an aged receivable.

**How it works.** A project manager marks the position ready — a human step deliberately not automated, because only delivery knows whether the client accepted the work. Handoff sends the position's data to Zoho; the accredited provider transmits the legal invoice; the reference comes back and the position becomes issued. Finance then owns the open item and reads settlement status back from Zoho.

**Where it sits.** Spans Projects, Billing, the Zoho adapter and Finance. The legal background for the boundary is [ADR-016](decisions.md#adr-016).

## Who moves what

| Transition | Actor |
|---|---|
| pending → ready | The PM — only delivery knows whether the client accepted the milestone |
| ready → handed off | The system, on handoff to Zoho with the position's data |
| handed off → issued | Read back from Zoho with the external reference |
| chasing | The deadline monitor — "completed 21 days, still unbilled" is the silent revenue leak this catches |


Regulatory background and the build-vs-buy closure: [ADR-016](decisions.md#adr-016).
