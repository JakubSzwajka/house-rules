# @house-rules/domain-postgres

A Postgres `Platform` for Alchemy Domain (`@alchemy.run/domain` 2.0.0-beta.85). It keeps a model's events, state, receipts, views, schedules and outbox in your own Postgres, so a model runs on Node in a container and survives a restart. It is its own package so it can be deleted when Alchemy ships its own Postgres host. [AGENTS.md](AGENTS.md) holds the wiring and fixed rules for agents.

```ts
import { layer } from "@house-rules/domain-postgres";
import * as PgClient from "@effect/sql-pg/PgClient";

const Hosted = App.layer(AppHandlers).pipe(
  Layer.provide(layer({ schema: "app" })),
  Layer.provide(PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })),
);
```

`fromEnv({ schema })` picks the store from `DOMAIN_STORE`: `postgres` (default, needs `DATABASE_URL`) or `memory` (`Domain.InMemory`). Swapping the Layer is the whole move; the model does not change.

## What it stores

`layer` creates its tables in `schema` on start (`CREATE ... IF NOT EXISTS`), unless you pass `createTables: false` (see [A runtime role that cannot create](#a-runtime-role-that-cannot-create)):

| Table | Holds |
| --- | --- |
| `instances` | each aggregate instance's state and version; its row lock is the single writer |
| `events` | every committed event, keyed `(model, aggregate, id, seq)` so two writers can never commit the same seq |
| `receipts` | the reply to each command id, so a retried command returns the first receipt |
| `schedules`, `cancellations` | scheduled commands and the ones cancelled |
| `views`, `view_keys`, `view_entries` | each view key's snapshot, with per-source checkpoints, and what it emitted |
| `outbox` | deliveries to views and policies, written in the same transaction as the commit |
| `backfills` | each view generation's replay cursor and completion marker |

A command commits its events, state, receipt and outbox rows in one transaction. Schedule firing locks the aggregate instance before deleting its schedule token, matching schedule and unschedule lock order. One loop per model delivers the outbox in order. A view commits its snapshot, emitted entries, downstream deliveries and outbox deletion in one transaction, including when a checkpoint rejects a duplicate. This uses one WAL flush per view delivery instead of a second flush for the deletion. Subscribers receive notifications after the transaction commits.

A policy keeps its separate outbox deletion after its handler succeeds. Handler failures retry before later rows and park after `maxAttempts` (5) by setting `failed_at`. SQL failures do not consume attempts or park rows. A parked view delivery blocks later rows for the same target identity and key partition. Target identity includes kind, name, generation and `inPlace`. This prevents a checkpoint from passing a failed row. Other partitions can proceed. Repair the cause and unpark the row to resume that partition in order. Policy parking keeps its existing behavior. Delivery remains at least once; view checkpoints drop duplicates, and policy commands use receipt deduplication.

The drain loop logs database failures and defects, waits with capped exponential backoff and jitter, then tries again. Commit kicks cannot bypass a database or handler retry delay. Handler retries start at 50 to 100 ms, with no `pollInterval` floor, and grow to a 15 to 30 second cap. A handler that interrupts itself or joins an interrupted fiber counts as a handler failure. Closing the host scope interrupts the worker promptly without consuming an attempt.

All SQL failures, including typed errors and defects, leave attempts unchanged. This includes persistent SQLSTATE classes `22`, `23`, `42` and `54`. Such a fault blocks the model's drain at that row until repaired; it never parks. Alert on `available: false`, inspect the logged SQL failure and repair its cause. The worker retries without a host restart.

## A runtime role that cannot create

Postgres checks the CREATE privilege before it checks whether a schema or table exists. So the default start, which runs `CREATE ... IF NOT EXISTS`, fails with `permission denied` for a role that may only read and write rows, even when every table is there.

Split the two jobs. The schema owner runs `migrate(schema)` in the deploy's migration step, with a `PgClient` that connects as the owner. `migrate` is idempotent. It checks the catalog before adding `view_keys.filled_generation` or `views.catch_up`, avoiding repeated owner-only `ALTER TABLE` on migrated tables. The app runs `layer({ schema, createTables: false })` or `fromEnv({ schema, createTables: false })` as the runtime role. With `createTables: false`, start reads `pg_catalog` instead of creating anything. If the schema or any table is missing, the layer dies with `TablesMissing`, which names the schema and the missing tables. It never creates them.

The runtime role needs these grants, run once by the owner:

```sql
GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
  GRANT USAGE ON SEQUENCES TO app_runtime;
```

The sequence grant covers `outbox.position`, a `bigserial`. The default privileges cover tables a later version of this package adds when the owner runs `migrate` again. The runtime role needs no CREATE on the database or the schema.

## View history and generation changes

New or bumped eager views replay their source history during model startup, including single-source views at generation zero. An eager view has no `kit.catchUp`. On the first 0.2.0 boot, an unchanged legacy generation without a `backfills` record adopts a completed baseline. Adoption leaves its snapshots and entries unchanged, so untouched old streams do not become new feed entries. Existing replay records resume normally.

The nullable `views.catch_up` column records each view's last observed mode. A known lazy-to-eager transition at the same generation creates or re-arms pending replay without clearing snapshots or entries. This also covers a target changing from `@n` to `#n` when it gains another aggregate source. Repeated transitions rescan history and dedupe existing checkpoints. Ordinary eager restarts preserve pending cursors and counts.

NULL means the prior mode is unknown. An unknown same-generation eager baseline still adopts without replay. Switching from an unrecorded lazy declaration during the first upgrade therefore requires an explicit generation bump. The platform cannot infer that old mode or detect source-plan changes against an unrecorded plan.

The platform uses Alchemy's source plan and `ViewKit.history` to route stored events to current keys. Views that read other views replay their stored entries after source views finish. Startup completes pending replay before the host accepts commands or starts schedules and outbox delivery.

A source-keyed view with `kit.catchUp` fills one key at a time, on demand. Ordinary reads and receives fill the key before reading entries or applying a live batch. This includes `read`, `list`, `tail` and `changes`. A filled key checks its persisted generation without a transaction or row lock. A key needing history takes a row lock, replays that aggregate id's events in `seq` order through `kit.history`, then records its filled generation. Unknown ids without source events do not persist empty keys. Views without `kit.catchUp` keep one-query, non-transactional reads. Lazy fills notify subscribers and wake downstream delivery after the read or receive transaction commits. A live event cannot pass the key's history. A downstream startup scan enumerates and reads all stored ids of its lazy source, even when the downstream replay is already complete. Standalone lazy views do not run a whole-view startup replay.

A poison event in a key's history fails its reads rather than serving a stale snapshot.

Eager replay orders source views before their consumers. Within a view, it orders source names and source ids bytewise, then each stream's `seq`. It does not sort by event time. Across streams, this order can differ from the original live interleaving. A fold that depends on cross-stream interleaving must account for that difference.

The `backfills` table stores eager generation plans, cursors and completion. View initialization persists pending replay intent atomically with new or bumped metadata and snapshot resets. A JSON `null` plan remains unbound until startup binds the actual source plan under the progress lock. A crash before the first replay cannot turn pending work into a legacy adoption.

Fresh empty-model eager jobs bind plans and complete in one startup transaction. The guard requires no model events, view entries, view keys or prior replay progress. Initialization commits pending intents first, so an aborted batch leaves them pending. Nonempty history retains separate pages of at most 128 source rows.

Each page commits snapshots, emitted entries, downstream deliveries and its cursor together. An interrupted page rolls back, and the next startup resumes after the last committed cursor. Completion checks each delivery's persisted checkpoint, verifies history exhaustion and requires a key when any delivery was routed. `routed = applied + deduped` is an accounting sanity check, not proof of gap-free history. The `view_keys.filled_generation` column records per-key source-view fills.

History does not run policy effects. During eager replay or lazy fill, a pending live delivery for the current generation is promoted and applied with its historical row. This preserves queued live view-policy effects. Old-generation history policies stay suppressed. The original live delivery is later checkpoint-deduplicated and acknowledged.

Adopted completion means no replay is pending for an unchanged legacy baseline. It does not prove that pre-0.2.0 history was gap-free. Old holes need an explicit generation bump for a clean rebuild. Replay cannot repair holes below existing checkpoints. Do not blindly reset same-generation view logs: pending deliveries and downstream consumers may still reference their old sequence numbers.

Bump the consumer's version when its replay plan changes. Changing `from` or an upstream view generation can change that plan. At the same consumer generation, a changed persisted plan raises `BackfillPlanChanged` during startup, even when its record is complete. Alchemy propagates upstream generations into consumer generations, but plan changes must still have a new consumer generation. Never delete progress or reset same-generation logs to bypass this check.

`ModelHost.history` reports eager replay completion, including adopted legacy baselines, and checks source-keyed keys individually. The pinned Alchemy beta.85 kernel derives the public self-filled `View.history` result from per-key callbacks with `complete: true`. That result guarantees full history when a key is accessed. It does not report global fill progress. This package does not patch Alchemy or add a dependency.

## Outbox health

Pass an optional callback to `layer` or `fromEnv` to keep a read-only monitor for each model:

```ts
import { fromEnv, type OutboxStatus } from "@house-rules/domain-postgres";

const monitors = new Map<string, OutboxStatus.Monitor>();
const Store = fromEnv({
  schema: "app",
  outboxStatus: (model, monitor) => {
    monitors.set(model, monitor);
  },
});
```

Read `monitor.snapshot` from the app's Effect runtime. The read uses cached worker observations, not a new SQL count query. It reports worker `alive`, database `available`, `observedAt`, `lastSuccessfulPass`, `pendingCount`, `parkedCount` and `oldestPendingAgeMillis`. Counts and age describe the last completed database pass. Use `observedAt` to detect stale observations. A failed SQL pass clears availability and counts, but keeps the observation and last successful pass times. The oldest pending age comes from `delivery.envelope.at`, so it measures event age, not time since insertion into the outbox. It advances between reads from the oldest event time observed by the last completed pass.

Treat `parkedCount > 0` as unhealthy. An app can also return an unhealthy response when the worker is absent or stopped, SQL is unavailable, observations are stale, or pending events are too old. Choose freshness and age thresholds for the app's poll interval and delivery latency. Also check the database directly with a bounded `SELECT 1`; a cached worker observation is not a fresh connection test. Apply a request timeout to health checks.

Without an `outboxStatus` callback, the worker skips status-observation count queries. Delivery selection, error logging and retry behavior stay unchanged. The callback runs when the drain starts. Closing the host scope makes its monitor report `alive: false`. `DOMAIN_STORE=memory` does not create a Postgres monitor. This package does not add or change an HTTP health route.

## Upgrade to 0.2.0

Existing `fromEnv` and `layer` call sites remain valid. Existing declarations can stay unchanged for this upgrade. The first startup replays new or bumped eager targets and adopts unchanged legacy generations without modifying their snapshots or entries. Measure startup against production-sized history before deployment. Each page queries stored history in bytewise order; large histories can increase startup cost. A source-keyed `kit.catchUp` view fills each key lazily when a read or receive needs it.

1. Stop the old host. Keep one host per schema during the upgrade.
2. Run `migrate(schema)` as the schema owner if the app uses `createTables: false`. The default startup runs this idempotent migration itself.
3. Give the runtime role access to the new `backfills` table. The migration also adds nullable `view_keys.filled_generation` and `views.catch_up`. Existing default privileges may already cover the table.
4. Start the new host and allow time for replay before declaring it ready. An interrupted replay resumes at the next startup.
5. Wire the optional monitor into the app's health route in a separate app change.

An app with `createTables: false` must finish the owner migration and grants before its server starts. Custom hosts must preserve that ordering.

## Limits

- One replica per database schema. Two processes would both run the outbox loop and each other's schedules, and live reads (`watch`) only see commits made in their own process.
- No projections, streams or sagas: building a model with them fails.
- New or bumped eager views replay at startup before the host serves commands or starts schedules and outbox delivery. Unchanged legacy generations adopt without replay. Source-keyed `kit.catchUp` views fill keys lazily on read or receive. Large eager histories increase startup time. Run one host per schema throughout the upgrade.
- The `Platform` contract is beta. `Platform.ts` changed 308 lines between beta.84 and beta.85, so pin Alchemy exactly and rerun these tests on every bump.

## Tests

Tests run against real Postgres. Start it with `pnpm db:up` (docker compose, `127.0.0.1:55432`); CI runs the same image as a service. `platformForTests` gives each test its own schema and drops it after. Set `DOMAIN_STORE=memory` to run the same tests on `Domain.InMemory`; this package's `test` script runs both, and the restart test runs on Postgres only.
