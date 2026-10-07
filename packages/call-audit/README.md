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

## Two layers

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

The recording runs in `Effect.onExit`, and its own failures are swallowed with `Effect.ignoreCause`. A logger that throws, a recorder that throws, or a `who` that throws cannot change the exit of the call. A broken `who` still leaves a line, with `viewerId: null`, and the call still runs.

## Later: a stored log

A `layerTable`, which stores entries in a table, comes later, with the migration runner for many modules. It needs a module that owns its migrations.
