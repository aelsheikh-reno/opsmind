# Integrations runbook

> Per integration: how it breaks, how you notice, what to do. "How you notice" is always an alert — never a user report.

### Context

**The business problem.** Every integration will fail: tokens expire, providers go down, webhook channels lapse. The failures are predictable; being surprised by them is a choice.

**Why this exists as its own component.** A runbook belongs in the architecture document because the answer to "how do you notice" is an architectural property, not an operational habit. If noticing depends on a user complaining, the design is wrong.

**What it does.** It lists each integration's failure modes, the signal that surfaces each one, and the action to take.

**How it works.** Every row's "you notice via" is an alert rather than a report from a user — unpushed settlements exceeding a threshold, a source failing to report on schedule, a rate older than a day. Most recoveries are automatic: sweeps re-run, retries drain, watch channels are recreated by their renewal job. The rows needing a human are the ones where credentials must be re-authorised.

**Where it sits.** Depends on the alerting design being correct: source liveness is what turns "an integration stopped working" into a signal rather than a silence. The one external dependency is a dead-man's check on the Alert Manager itself, since it cannot alert on its own death.

| Integration | Failure mode | You notice via | Action |
|---|---|---|---|
| Zoho Books | Token expiry · API limits · mapping rejects | Unpushed-settlements alert (count > 0 for > 1h) | Reconnect in /integrations/zoho; retries drain the queue; rejects land in work items |
| Google Drive | Watch channel expired · webhook missed | Sweep picks up the gap; source-dark if the sweep itself dies | Renewal job recreates the channel; nothing manual for missed webhooks |
| Postmark inbound | Signature config drift · sender rejected | Rejected-webhook counter alert | Verify signature secret; check sender policy |
| WhatsApp | Token expiry (long-lived) · template rejection | Send-failure alerts from Notifications | Refresh token; re-approve templates |
| Asana | OAuth revoked per tenant | Adapter reportRun goes dark → source-dark | Tenant reconnects via Connection Manager |
| FX provider | Provider down | Heartbeat deadline breach (rate age > 24h) | Fallback chain first; snapshots mean processed months are never wrong retroactively |
| IdP (SSO) | Outage | Login failures spike | Break-glass local admin; users wait — sessions already issued keep working until TTL |
| Alert Manager itself | The engine dies | **External dead-man's check** — the one outside dependency | Restart; sources re-report and STALE alerts re-confirm on the next runs |

