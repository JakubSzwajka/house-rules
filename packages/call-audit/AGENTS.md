# @house-rules/call-audit: notes for agents

## What it does

It records every capability call through the `CallWatch` hook of `@house-rules/capability`: who, which capability, outcome, duration, kind (read or write), target id, channel and request id. An `AuditPolicy` decides which calls it keeps and how long rows live. Retention runs inside the layer. `CallAudit.erase(viewerId)` deletes one viewer's rows. The full guide is `README.md` in this package.

## How an app mounts it

1. [ ] One layer line, beside the app's `SqlClient`:

   ```ts
   const audit = CallAudit.layerPostgres({ who, policy: CallAudit.presets.agentAware }).pipe(
     Layer.provide(database),
   );
   ```

   It provides `CallWatch` and `AuditStore`. `who` is an Effect with no requirements that yields the caller id or `null`, such as `Effect.serviceOption(Viewer)` mapped to the user id.

2. [ ] One line in the root `migrations.json`, and the package in the root `package.json` dependencies:

   ```json
   { "package": "@house-rules/call-audit" }
   ```

3. [ ] Set `CallChannel` to `"web"` in the web runner (see the capability package). Without it, web calls record `"unknown"`, and `agentAware` drops their reads.
4. [ ] Call `CallAudit.erase(viewerId)` where the app deletes a user. It needs `AuditStore`, which `layerPostgres` provides.

Tests use `CallAudit.layer({ who, policy })` with `memoryAuditStore()`, or `CallAudit.layerMemory(memoryAuditLog(), { who })` to see raw entries.

## Options

`CallAudit.layer` and `CallAudit.layerPostgres` take:

| Option | Meaning |
| --- | --- |
| `who` | the caller id, read once before the call |
| `policy` | an `AuditPolicy`, usually a preset |
| `log` | `true` also writes one log line per kept call |
| `retention.interval` | time between retention runs. Default 1 hour. The first run starts with the layer. |
| `retention.batchSize` | rows per delete statement. Default 1000. |

Presets:

| Preset | Keeps | Retention | Write failure |
| --- | --- | --- | --- |
| `minimal` | writes and failures | 90 days | ignore |
| `agentAware` | writes, failures, reads over MCP | 365 days | log |
| `strict` | every call | 365 days | log |

`CallAudit.policy({ ... })` starts from `minimal` and takes overrides: `keep(entry)`, `retention: { read, write, failure }` as durations (`"Infinity"` keeps a class forever), `onWriteFailure: "ignore" | "log"`, `erasure: "delete"`. A failure is any outcome other than `success`, whatever the kind.

## Fixed rules

- Never store input values or error messages. Ids and error tags only.
- A capability cannot opt out. Only the app's policy decides what is kept.
- Retention and erasure SQL live in this package. Apps give numbers and modes only.
- A failed audit write never changes the call's result.
- One retention run at a time: a Postgres advisory lock guards it, so only one replica deletes.
- App code never queries `call_audit`. Read it with `CallAudit.readRows` or `AuditStore.read`.
- Time comes from the app `Clock`, not the database: `recorded_at` at capture and the retention cutoffs. Replicas need synchronized clocks, or skew shortens or extends retention. Rows from before `0002` were stamped by the database clock.
- Older layers still work: `layerLog`, `layerMemory`, and `layerTable` (every call, no retention). Prefer `layerPostgres`.
