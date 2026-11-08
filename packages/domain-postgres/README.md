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

`layer` creates its tables in `schema` on start (`CREATE ... IF NOT EXISTS`):

| Table | Holds |
| --- | --- |
| `instances` | each aggregate instance's state and version; its row lock is the single writer |
| `events` | every committed event, keyed `(model, aggregate, id, seq)` so two writers can never commit the same seq |
| `receipts` | the reply to each command id, so a retried command returns the first receipt |
| `schedules`, `cancellations` | scheduled commands and the ones cancelled |
| `views`, `view_keys`, `view_entries` | each view key's snapshot, with per-source checkpoints, and what it emitted |
| `outbox` | deliveries to views and policies, written in the same transaction as the commit |

A command commits its events, state, receipt and outbox rows in one transaction. One loop per model delivers the outbox in order, deletes each row after its view or policy succeeds, retries a failure, and parks a row after `maxAttempts` (5) by setting `failed_at`. Views drop duplicates by checkpoint, so delivery is at least once.

## Limits

- One replica per database schema. Two processes would both run the outbox loop and each other's schedules, and live reads (`watch`) only see commits made in their own process.
- No projections, streams or sagas: building a model with them fails.
- No backfill. A view added to a database that already has events starts empty and fills from new events only; bumping a view's `version` empties it the same way.
- The `Platform` contract is beta. `Platform.ts` changed 308 lines between beta.84 and beta.85, so pin Alchemy exactly and rerun these tests on every bump.

## Tests

Tests run against real Postgres. Start it with `pnpm db:up` (docker compose, `127.0.0.1:55432`); CI runs the same image as a service. `platformForTests` gives each test its own schema and drops it after. Set `DOMAIN_STORE=memory` to run the same tests on `Domain.InMemory`; this package's `test` script runs both, and the restart test runs on Postgres only.
