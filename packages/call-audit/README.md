# @house-rules/call-audit

An audit trail for every capability call. It plugs into the `CallWatch` hook of `@house-rules/capability`, so it sees calls from every surface, `Forbidden` and `ApprovalDenied` included.

An entry holds five fields and nothing else:

| Field | Meaning |
| --- | --- |
| `capability` | the contract name |
| `permission` | the contract permission, or `"public"` |
| `viewerId` | the caller id from `who`, or `null` |
| `outcome` | `success`, the typed failure `_tag` (`failure` when it has none), `defect`, or `interrupted` |
| `ms` | the duration of the whole call |

It never records the input, and never an error message. Input is often user data.

Outcome precedence: any defect wins (`defect`), then a typed failure, then `interrupted`.

## Three layers

```ts
import { CallAudit, memoryAuditLog } from "@house-rules/call-audit";

// Production: one physical log line per call.
// capability call {"capability":"read_trip","permission":"trips:read","viewerId":"user_ana","outcome":"success","ms":3}
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
| `recorded_at` | when the row was written, `now()` in the database |
| `capability`, `permission`, `viewer_id`, `outcome`, `ms` | the five entry fields |

The write is synchronous: it runs after the call, in the same `Effect.onExit` as the log line. `log: true` also writes the log line, so the table adds to the log instead of replacing it. Without it, only the row is written.

The table comes from this package's own migration, `migrations/0001_call_audit.sql`. The package declares the folder in its `package.json` as `"houseRules": { "migrations": "migrations" }` and ships it in `files`. An app runs it with `@house-rules/migrations` by adding one entry to its `migrations.json`:

```json
{ "package": "@house-rules/call-audit" }
```

The SQL lives in the package's Postgres adapter, `src/adapters/postgres/` (the insert and `readRows`), with its tests in `src/adapters/tests/`. No other file imports `effect/unstable/sql`, as the `adapter-imports-only-in-adapters` rule asks.

`house-rules-migrations` fails when an app depends on this package and its list leaves it out. App code never queries `call_audit` directly: the table belongs to this package. Read it with `CallAudit.readRows`. Rows stay until someone deletes them; there is no retention job yet.

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

Rows come back newest first, decoded with a `Schema`. An `AuditRow` has `capability`, `permission`, `viewerId` (`string | null`), `outcome`, `ms` and `recordedAt` (a `Date`). It needs the `SqlClient` the app already provides, and fails with the typed `AuditReadFailed` when the SQL fails. Use it in tests and in a future audit screen.

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
