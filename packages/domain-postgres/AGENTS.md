# Agent guide: @house-rules/domain-postgres

A Postgres `Platform` for Alchemy Domain (`@alchemy.run/domain` 2.0.0-beta.85, Effect 4.1.2). Swap it in where an app would use `Domain.InMemory`; the model does not change.

## Wiring

```ts
import { fromEnv } from "@house-rules/domain-postgres";

const Hosted = App.layer(AppHandlers).pipe(Layer.provide(fromEnv({ schema: "app" })));
```

- `fromEnv({ schema })` reads `DOMAIN_STORE` (`postgres` by default, or `memory`) and `DATABASE_URL`. Declare both in the app's `.env.schema`.
- `layer({ schema })` is the same store without the env switch; provide a `PgClient` yourself.
- Tests provide `platformForTests`: a fresh `test_<uuid>` schema per test, dropped after. Run the suite again with `DOMAIN_STORE=memory` to cover `Domain.InMemory`.

## Fixed rules

- Run one replica per schema. Two processes would both run the outbox loop and the schedules, so a policy could fire twice.
- No projections, streams or sagas. Building a model with them fails.
- No backfill. A new view, or a view whose `version` changes, fills from new events only.
- Pin `@alchemy.run/domain`, `alchemy` and `effect` to this package's peer versions. The `Platform` contract is beta; rerun the tests on every Alchemy bump.
- A policy command id comes from its event, so a redelivered event is deduplicated by its receipt. A call to an outside provider inside a policy is not; make it idempotent.
