# @house-rules/call-audit

An audit trail for every capability call. It plugs into the `CallWatch` hook of `@house-rules/capability`, so it sees calls from every surface, `Forbidden` and `ApprovalDenied` included. An `AuditPolicy` decides which calls it keeps and how long their rows live. `AGENTS.md` in this package is the short mounting guide.

An entry holds these fields and nothing else:

| Field | Meaning |
| --- | --- |
| `capability` | the contract name |
| `permission` | the contract permission, or `"public"` |
| `viewerId` | the caller id from `who`, or `null` |
| `outcome` | `success`, the typed failure `_tag` (`failure` when it has none), `defect`, or `interrupted` |
| `ms` | the duration of the whole call |
| `kind` | `read` when the contract is `readOnly`, else `write` |
| `targetId` | the input field the contract names in `audit: { target }`, when it is a string, else `null` |
| `channel` | `mcp` or `mcp:<client>` for MCP calls, else the app's `CallChannel`, `unknown` by default |
| `requestId` | the app's `CallRequestId`, set by `withRequestId` from `@house-rules/capability`, or `null` |

It never records the input, and never an error message. Input is often user data.

Outcome precedence: any defect wins (`defect`), then a typed failure, then `interrupted`.

## The policy layer

```ts
import { CallAudit } from "@house-rules/call-audit";

const audit = CallAudit.layerPostgres({ who, policy: CallAudit.presets.agentAware }).pipe(
  Layer.provide(database),
);
```

`layerPostgres` is `CallAudit.layer(options)` over `postgresAuditStore`, and provides both `CallWatch` and `AuditStore`. `CallAudit.layer` needs an `AuditStore`: `postgresAuditStore` (needs a `SqlClient`) or `memoryAuditStore()` for tests.

| Option | Meaning |
| --- | --- |
| `who` | the caller id, see below |
| `policy` | an `AuditPolicy` |
| `log` | `true` also writes the log line for each kept call |
| `retention.interval` | time between retention runs, default 1 hour |
| `retention.batchSize` | rows per delete statement, default 1000 |

An `AuditPolicy` has four fields:

| Field | Meaning |
| --- | --- |
| `keep(entry)` | `true` keeps the call. A `keep` that throws keeps it. |
| `retention` | `{ read, write, failure }`, each a `Duration.Input`. `"Infinity"` never deletes that class. |
| `onWriteFailure` | `"ignore"`, or `"log"`: a warning with the capability and the error tag, never the message |
| `erasure` | `"delete"` |

A call's class is `failure` when its outcome is not `success`, whatever its kind. Otherwise it is its kind. Rows from before migration `0002` have no kind and count as writes.

| Preset | Keeps | Retention | Write failure |
| --- | --- | --- | --- |
| `minimal` | writes and failures | 90 days | ignore |
| `agentAware` | writes, failures, and reads over MCP | 365 days | log |
| `strict` | every call | 365 days | log |

`CallAudit.policy({ ... })` starts from `minimal` and takes overrides.

### Retention and erasure

The layer forks one fiber in its scope. It runs retention when the layer starts, then once per interval. A run deletes each class's rows older than its window, oldest first, in batches. On Postgres the run reserves one connection and takes the session advisory lock `pg_try_advisory_lock(hashtext('@house-rules/call-audit/retention'))`. When another replica holds it, the run skips. A failed run logs a warning and waits for the next tick. `CallAudit.runRetention(policy, { batchSize })` runs it once, for a script or a test, and returns `{ ran, deleted: { read, write, failure } }`.

Retention cutoffs and `recorded_at` both come from the app's `Clock`, never from the database's `now()`. Replicas must keep synchronized clocks: skew between them shortens or extends the window by the skew. Rows written before migration `0002` were stamped by the database clock, so their `recorded_at` can differ from the app clock by that offset.

`CallAudit.erase(viewerId)` deletes every row of one viewer and returns the count. It needs `AuditStore`. The app calls it where it deletes a user.

### The store port

`AuditStore` has `record`, `read`, `deleteExpired` and `erase`. Its Postgres adapter is in `src/adapters/postgres/`, its memory adapter in `src/adapters/memory/`, and one suite in `src/adapters/tests/audit-store.test.ts` runs every case on both.

## The older layers

These keep working and record every call, with no policy and no retention.

```ts
import { CallAudit, memoryAuditLog } from "@house-rules/call-audit";

// Production: one physical log line per call.
// capability call {"capability":"read_trip","permission":"trips:read","viewerId":"user_ana","outcome":"success","ms":3,"kind":"read","targetId":"t-1","channel":"web","requestId":null}
const production = CallAudit.layerLog({ who });

// Tests: the same entries, in memory.
const log = memoryAuditLog();
const test = CallAudit.layerMemory(log, { who });
log.entries(); // ReadonlyArray<AuditEntry>
log.clear();
```

`layerLog` writes through the default Effect logger, at info level, as one line. `layerMemory` takes `who` as an optional second argument; without it every `viewerId` is `null`.

## A stored log: `layerTable`

`layerTable` writes one row per call into `call_audit`, a table this package owns. It needs a `SqlClient` from the app.

```ts
// One row per call, and the same log line as layerLog.
const production = CallAudit.layerTable({ who, log: true }).pipe(Layer.provide(database));
```

| Column | Value |
| --- | --- |
| `id` | an identity, for ordering |
| `recorded_at` | when the call ended, from the app's `Clock` |
| `capability`, `permission`, `viewer_id`, `outcome`, `ms` | the first five entry fields |
| `kind`, `target_id`, `channel`, `request_id` | the call facts, added by `0002`, `null` on older rows |

The write is synchronous: it runs after the call, in the same `Effect.onExit` as the log line. `log: true` also writes the log line, so the table adds to the log instead of replacing it. Without it, only the row is written.

The table comes from this package's own migrations, `migrations/0001_call_audit.sql` and `migrations/0002_call_audit_policy.sql`. The package declares the folder in its `package.json` as `"houseRules": { "migrations": "migrations" }` and ships it in `files`. An app runs it with `@house-rules/migrations` by adding one entry to its `migrations.json`:

```json
{ "package": "@house-rules/call-audit" }
```

The SQL lives in the package's Postgres adapter, `src/adapters/postgres/` (the store and `readRows`), with its tests in `src/adapters/tests/`. No other file imports `effect/unstable/sql`, as the `adapter-imports-only-in-adapters` rule asks.

`house-rules-migrations` fails when an app depends on this package and its list leaves it out. App code never queries `call_audit` directly: the table belongs to this package. Read it with `CallAudit.readRows`. `layerTable` runs no retention: use the policy layer for that.

## Reading the audit: `readRows`

Apps never write SQL against `call_audit`. Read it through this package:

```ts
const latest = CallAudit.readRows({ limit: 50, viewerId: "user_ana" });
// Effect<ReadonlyArray<AuditRow>, AuditReadFailed, SqlClient>
```

| Option | Meaning |
| --- | --- |
| `limit` | rows to return. Default 100, at most 1000. A value below 1 gives 1. |
| `viewerId` | only the rows of this caller |

Rows come back newest first, decoded with a `Schema`. An `AuditRow` has `capability`, `permission`, `viewerId` (`string | null`), `outcome`, `ms`, `kind`, `targetId`, `channel`, `requestId` (each `null` on rows from before `0002`) and `recordedAt` (a `Date`). The four fact fields are optional in the type, so an old `AuditRow` or `AuditEntry` literal without them still compiles; a row read back always carries them. It needs the `SqlClient` the app already provides, and fails with the typed `AuditReadFailed` when the SQL fails. Use it in tests and in a future audit screen.

## The `who` option

The framework does not know an app's `Viewer`, so the app passes `who`: an Effect with no requirements that yields the caller id, or `null`.

```ts
import { Effect, Option } from "effect";

const who = Effect.serviceOption(Viewer).pipe(
  Effect.map((viewer) => (Option.isSome(viewer) ? viewer.value.userId : null)),
);
```

`Effect.serviceOption` keeps `who` free of requirements, and a call with no viewer logs `null`. `who` runs once, before the handler, in the context of the call, so the entry names the caller who entered the capability even if the handler swaps the `Viewer` later.

## A broken log cannot break a call

The recording runs in `Effect.onExit`, and its own failures are swallowed with `Effect.ignoreCause`. A logger that throws, a recorder that throws, a failed insert, or a `who` that throws cannot change the exit of the call. A broken `who` still leaves a line, with `viewerId: null`, and the call still runs. In `layerTable`, the log line and the insert are sandboxed apart, so a missing or locked table still leaves the line.
