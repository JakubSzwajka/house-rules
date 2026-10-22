# @house-rules/call-audit: notes for agents

## What it does

Call-audit records one row per feature through application's lower `CallWatch`, including closure and approval refusals. Inner operation and feature calls do not add rows. It keeps service, storage, read, erasure and retention APIs. Version 0.7.0 peers on exact application 0.2.0 and Effect 4.0.3. There is no domain peer. SQL imports use `effect/sql`; published packages load built `dist/`.

## Mount the Record socket

1. [ ] Create `CallAudit.record.postgres({ who, policy: CallAudit.presets.strict })`. Provide its `.layer` with the app's SQL client in composition. It returns `RecordSocket<never, SqlClient>` and outputs only `CallWatch`. The memory form is `CallAudit.record.memory(log, options?)`, where `log = memoryAuditLog()`. No export is named `Record`.
2. [ ] Register `{ "package": "@house-rules/call-audit" }` in `migrations.json`. In this repo use `{ "workspace": "packages/call-audit" }`.
3. [ ] `who` is an Effect with no requirements returning the caller id or null. It runs once before feature execution. `Effect.serviceOption(CurrentActor)` can read a person without requiring one. Root-owned hook wiring must capture the watch too, so new-login features are recorded.
4. [ ] Use the same root watch for all ways and hooks. Application supplies channel/request facts. Custom runners may supply `CallChannel`; the default is `unknown`.
5. [ ] For erasure, provide `AuditStore` too and call `CallAudit.erase(viewerId)` in account deletion. The socket exposes only `CallWatch`; `CallAudit.layerPostgres(options)` still exposes `CallWatch | AuditStore` when both are wanted. App code never queries this table directly.

## Mount a captured reader

Provide `CallAudit.reader.postgres` with the shared SQL client, or `CallAudit.reader.memory(log)` with the same `memoryAuditLog()` used by Record. Both layers export `AuditReader`. Capture that service during composition; its `readRows({ viewerId?, limit? })` has no requirements. The reader filters before limiting. It grants no permission: the calling feature must gate access and supply the person's id for private reads. Memory logs keep timestamped `rows()` alongside unchanged `entries()`.

## Feature facts and migrations

`AuditRecord` and `AuditRow` require `target: string`. Both `capability` and `target` are the feature's name. Permission is the feature's permission or the empty string for null, never an invented permission. `kind` comes from the lifted feature readOnly flag. `targetId` is a distinct optional object id, null by default; no input field or operation audit option selects it. Columns, migrations and stored text values stay unchanged. Other fields remain viewerId, outcome, ms, channel, requestId and recordedAt on rows.

Migration `0003_call_audit_target.sql` adds target, backfills it from capability, then makes it required. The previous migrations remain unchanged. Optional facts from `0002` remain nullable on old rows. Memory and Postgres store suites verify target persistence, and a real Postgres upgrade test seeds the old schema before applying `0003`.

`AuditReadFailed` and `AuditStoreUnavailable` declare unavailable kind with `Schema.tag`, the same constructor-default field used by domain's kind helper, without adding a domain peer.

## Policy and lower APIs

| Preset | Keeps | Retention | Write failure |
| --- | --- | --- | --- |
| `minimal` | writes and failures | 90 days | ignore |
| `agentAware` | writes, failures, MCP reads | 365 days | log |
| `strict` | every feature, refusals included | 365 days | log |

Postgres options require `who` and `policy`. Optional `log: true` writes one line per kept record. Retention defaults to one hour between runs and batches of 1000, starting when the layer builds. `CallAudit.policy(overrides)` starts from minimal; retention has read/write/failure windows, `Infinity` keeps a class forever, and erasure is delete.

Lower layers remain `layer(options)` over `AuditStore`, `layerPostgres(options)`, `layerLog({ who })`, `layerMemory(log, options?)`, and `layerTable({ who, log? })`. The last three record every feature without policy retention. `readRows({ limit?, viewerId? })` needs SqlClient and returns newest first; `runRetention` and `erase` need AuditStore. Both memory and Postgres adapters stay public.

## Fixed rules

- Never store input values or error messages. Ids, names and error tags only. Feature targets never depend on input text.
- Module user-facing errors keep their messages; unavailable and plumbing errors use fixed public text, with diagnostic details kept in separate fields or causes.
- Capture caller identity before execution. A broken who becomes null. Recording runs after the exit and never changes it, even if a recorder, logger or insert fails.
- Only policy decides retention. A throwing keep function keeps the row. Strict retains refusals.
- One retention run at a time; Postgres uses a session advisory lock. Retention/erasure SQL stays in this package.
- `recorded_at` and retention cutoffs use the app Clock. Replicas need synchronized clocks. Pre-0002 rows used the database clock.

Run package `typecheck`, `test` and `build`. Store and target-upgrade suites use real Postgres as well as memory.
