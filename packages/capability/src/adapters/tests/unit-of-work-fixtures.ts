import { PgClient } from "@effect/sql-pg";
import { MigrationsTesting } from "@house-rules/migrations";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import {
  defineContract,
  implement,
  memoryUnitOfWork,
  NoOpenUnit,
  sqlUnitOfWork,
  UnitOfWork,
} from "../../index.ts";

class StoreUnavailable extends Schema.TaggedError<StoreUnavailable>()("StoreUnavailable", {
  reason: Schema.String,
}) {}

export class WorkFailed extends Schema.TaggedError<WorkFailed>()("WorkFailed", {}) {}

type Store = Readonly<{
  put: (id: string) => Effect.Effect<void, NoOpenUnit | StoreUnavailable>;
  ids: Effect.Effect<ReadonlyArray<string>, StoreUnavailable>;
  clear: Effect.Effect<void, StoreUnavailable>;
}>;

export class Stores extends Context.Service<Stores, { alpha: Store; beta: Store }>()(
  "test/Stores",
) {}

export class Opens extends Context.Service<Opens, { calls: Array<string> }>()("test/Opens") {}

const memoryStore = (): Store => {
  const rows = new Set<string>();
  return {
    put: (id) =>
      Effect.gen(function* put() {
        yield* UnitOfWork.onRollback(Effect.sync(() => void rows.delete(id)));
        rows.add(id);
      }),
    ids: Effect.sync(() => [...rows].sort()),
    clear: Effect.sync(() => rows.clear()),
  };
};

const unavailable = (error: { readonly message: string }) =>
  new StoreUnavailable({ reason: error.message });

const sqlStore = (sql: SqlClient, table: string): Store => ({
  put: (id) =>
    UnitOfWork.required.pipe(
      Effect.andThen(
        sql`insert into ${sql(table)} (id) values (${id})`.pipe(Effect.mapError(unavailable)),
      ),
      Effect.asVoid,
    ),
  ids: sql<{ id: string }>`select id from ${sql(table)} order by id`.pipe(
    Effect.map((rows) => rows.map((row) => row.id)),
    Effect.mapError(unavailable),
  ),
  clear: sql`delete from ${sql(table)}`.pipe(Effect.asVoid, Effect.mapError(unavailable)),
});

const counted = <R>(adapter: Layer.Layer<UnitOfWork, never, R>) =>
  Layer.effect(
    UnitOfWork,
    Effect.gen(function* countedUnitOfWork() {
      const inner = yield* UnitOfWork;
      const { calls } = yield* Opens;
      return {
        atomic: (effect) =>
          Effect.sync(() => calls.push("atomic")).pipe(Effect.andThen(inner.atomic(effect))),
      };
    }),
  ).pipe(Layer.provide(adapter), Layer.provideMerge(Layer.sync(Opens, () => ({ calls: [] }))));

export const memoryWorld = Layer.merge(
  counted(memoryUnitOfWork),
  Layer.sync(Stores, () => ({ alpha: memoryStore(), beta: memoryStore() })),
);

const database = Layer.effectDiscard(
  SqlClient.use((sql) =>
    Effect.all([
      sql`create table alpha_rows (id text primary key)`,
      sql`create table beta_rows (id text primary key)`,
      sql`create table parent_rows (id text primary key)`,
      sql`create table child_rows (
        id text primary key,
        parent_id text not null references parent_rows (id) deferrable initially deferred
      )`,
    ]),
  ),
).pipe(
  Layer.provideMerge(
    MigrationsTesting.database({
      label: "unit",
      client: (url) => PgClient.layer({ url, maxConnections: 3 }),
    }),
  ),
);

export const sqlWorld = Layer.merge(
  counted(sqlUnitOfWork),
  Layer.effect(
    Stores,
    Effect.map(SqlClient, (sql) => ({
      alpha: sqlStore(sql, "alpha_rows"),
      beta: sqlStore(sql, "beta_rows"),
    })),
  ),
).pipe(Layer.provideMerge(database));

export const writeBoth = Effect.gen(function* writeBoth() {
  const { alpha, beta } = yield* Stores;
  yield* alpha.put("a1");
  yield* beta.put("b1");
});

export const reset = Effect.gen(function* reset() {
  const { alpha, beta } = yield* Stores;
  yield* alpha.clear;
  yield* beta.clear;
  const opens = yield* Opens;
  opens.calls.length = 0;
});

export const contents = Effect.gen(function* contents() {
  const { alpha, beta } = yield* Stores;
  return { alpha: yield* alpha.ids, beta: yield* beta.ids };
});

export const writeContract = <const Transactional extends boolean>(transactional: Transactional) =>
  defineContract("write_both", {
    description: "Write one row in each module.",
    input: Schema.Struct({ fail: Schema.Boolean }),
    output: Schema.Void,
    failure: Schema.Union([WorkFailed, NoOpenUnit, StoreUnavailable]),
    permission: "rows:write",
    transactional,
  });

export const writeBothCapability = implement(writeContract(true), ({ fail }) =>
  Effect.gen(function* writeBothHandler() {
    yield* writeBoth;
    if (fail) return yield* new WorkFailed();
  }),
);

export const causeShape = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isSuccess(exit)
    ? []
    : exit.cause.reasons.map((reason) =>
        Cause.isFailReason(reason)
          ? { fail: reason.error }
          : Cause.isDieReason(reason)
            ? { die: reason.defect }
            : { interrupt: true },
      );

export const outliveUnit = <A, E, R>(later: Effect.Effect<A, E, R>) =>
  Effect.gen(function* outliveUnit() {
    const go = yield* Deferred.make<void>();
    // The daemon keeps the closed unit in its context, and runs later once go completes.
    const daemon = yield* UnitOfWork.atomic(
      Deferred.await(go).pipe(Effect.andThen(later), Effect.forkDetach),
    );
    return { go, daemon };
  });

export const raceUnitEnd = <E1, R1, A, E2, R2, H>(
  write: Effect.Effect<void, E1, R1>,
  daemonWork: Effect.Effect<A, E2, R2>,
  hold: (daemon: Fiber.Fiber<A, E2>) => Effect.Effect<H>,
) =>
  Effect.gen(function* raceUnitEnd() {
    // The unit's last undo hook releases a daemon forked inside it, then runs hold on that daemon.
    const release = yield* Deferred.make<void>();
    const checked = yield* Deferred.make<Exit.Exit<void, NoOpenUnit>>();
    const forked = yield* Deferred.make<Fiber.Fiber<A, E2>>();
    const held = yield* Deferred.make<H>();
    const daemon = Deferred.await(release).pipe(
      Effect.andThen(Effect.exit(UnitOfWork.required)),
      Effect.flatMap((exit) => Deferred.succeed(checked, exit)),
      Effect.andThen(daemonWork),
    );
    const exit = yield* UnitOfWork.atomic(
      Effect.gen(function* failingUnit() {
        // Registered first, so it runs last: after the other undo hooks and the ROLLBACK.
        yield* UnitOfWork.onRollback(
          Effect.gen(function* releaseDaemon() {
            yield* Deferred.succeed(release, undefined);
            yield* Deferred.await(checked);
            yield* Deferred.succeed(held, yield* hold(yield* Deferred.await(forked)));
          }),
        );
        yield* write;
        yield* Deferred.succeed(forked, yield* Effect.forkDetach(daemon));
        return yield* new WorkFailed();
      }),
    ).pipe(Effect.exit);
    return {
      exit,
      checked: yield* Deferred.await(checked),
      held: yield* Deferred.await(held),
      daemon: yield* Deferred.await(forked),
    };
  });
