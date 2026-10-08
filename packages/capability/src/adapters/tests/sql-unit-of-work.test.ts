import { expect, layer } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { UnitOfWork, UnitOfWorkFailed } from "../../index.ts";
import {
  causeShape,
  outliveUnit,
  raceUnitEnd,
  sqlWorld,
  WorkFailed,
} from "./unit-of-work-fixtures.ts";

layer(sqlWorld, { excludeTestServices: true, timeout: "30 seconds" })(
  "UnitOfWork, sql adapter only",
  (it) => {
    it.effect("a nested atomic runs on the same transaction", () =>
      Effect.gen(function* sameTransaction() {
        const sql = yield* SqlClient;
        const txid = sql<{ id: string }>`select txid_current()::text as id`.pipe(
          Effect.map((rows) => rows[0]?.id),
        );
        const [outer, inner] = yield* UnitOfWork.atomic(
          Effect.all([txid, UnitOfWork.atomic(txid)]),
        );
        expect(outer).toBeDefined();
        expect(inner).toBe(outer);
        expect(yield* txid).not.toBe(outer);
      }),
    );

    it.effect(
      "a daemon of a closed unit opens its own transaction, which outlives another's rollback",
      () =>
        Effect.gen(function* daemonOwnTransaction() {
          const sql = yield* SqlClient;
          const txid = sql<{ id: string }>`select txid_current()::text as id`.pipe(
            Effect.map((rows) => rows[0]?.id),
          );
          const insert = (id: string) => sql`insert into parent_rows (id) values (${id})`;
          const parentTx = yield* Deferred.make<string | undefined>();
          const go = yield* Deferred.make<void>();
          // The daemon holds the parent's connection, which went back to the pool at COMMIT.
          const daemon = yield* UnitOfWork.atomic(
            Effect.gen(function* parent() {
              yield* Deferred.succeed(parentTx, yield* txid);
              return yield* Deferred.await(go).pipe(
                Effect.andThen(UnitOfWork.atomic(Effect.all([txid, insert("daemon"), txid]))),
                Effect.forkDetach,
              );
            }),
          );
          const aWrote = yield* Deferred.make<string | undefined>();
          const failA = yield* Deferred.make<void>();
          const a = yield* UnitOfWork.atomic(
            Effect.gen(function* unitA() {
              yield* insert("a");
              yield* Deferred.succeed(aWrote, yield* txid);
              yield* Deferred.await(failA);
              return yield* new WorkFailed();
            }),
          ).pipe(Effect.forkChild);
          const aTx = yield* Deferred.await(aWrote);
          yield* Deferred.succeed(go, undefined);
          const [first, , second] = yield* Fiber.join(daemon);
          yield* Deferred.succeed(failA, undefined);
          expect(yield* Fiber.await(a)).toEqual(Exit.fail(new WorkFailed()));
          expect(first).toBe(second);
          expect([yield* Deferred.await(parentTx), aTx]).not.toContain(first);
          expect(yield* sql`select id from parent_rows`).toEqual([{ id: "daemon" }]);
          yield* sql`delete from parent_rows`;
        }),
    );

    it.effect(
      "a daemon released after ROLLBACK runs in a new transaction, not the closed one",
      () =>
        Effect.gen(function* daemonAfterRollback() {
          const sql = yield* SqlClient;
          const txid = sql<{ id: string }>`select txid_current()::text as id`.pipe(
            Effect.map((rows) => rows[0]?.id),
          );
          const insert = (id: string) => sql`insert into parent_rows (id) values (${id})`;
          let unitTx: string | undefined;
          // The undo hook waits for the daemon, so a daemon that joined the closed unit writes there.
          const race = yield* raceUnitEnd(
            insert("a").pipe(
              Effect.andThen(txid),
              Effect.map((id) => void (unitTx = id)),
            ),
            UnitOfWork.atomic(Effect.all([txid, insert("daemon"), txid])),
            Fiber.await,
          );
          expect(race.exit).toEqual(Exit.fail(new WorkFailed()));
          expect(Exit.isSuccess(race.held)).toBe(true);
          if (Exit.isFailure(race.held)) return;
          const [first, , second] = race.held.value;
          expect(first).toBeDefined();
          expect(first).toBe(second);
          expect(first).not.toBe(unitTx);
          expect(yield* sql`select id from parent_rows`).toEqual([{ id: "daemon" }]);
          yield* sql`delete from parent_rows`;
        }),
    );

    it.effect("a COMMIT that fails yields UnitOfWorkFailed, not a defect", () =>
      Effect.gen(function* commitFails() {
        const sql = yield* SqlClient;
        // The deferred foreign key is only checked at COMMIT.
        const exit = yield* UnitOfWork.atomic(
          sql`insert into child_rows (id, parent_id) values ('c1', 'missing')`,
        ).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) return;
        expect(Cause.hasDies(exit.cause)).toBe(false);
        expect(Cause.findErrorOption(exit.cause)).toEqual(
          expect.objectContaining({ value: expect.any(UnitOfWorkFailed) }),
        );
        const rows = yield* sql<{ id: string }>`select id from child_rows`;
        expect(rows).toEqual([]);
      }),
    );

    it.effect("a defect in the work stays a defect, and its typed error passes through", () =>
      Effect.gen(function* defectStays() {
        const sql = yield* SqlClient;
        const insert = sql`insert into parent_rows (id) values ('p1')`;
        const died = yield* UnitOfWork.atomic(insert.pipe(Effect.andThen(Effect.die("boom")))).pipe(
          Effect.exit,
        );
        expect(died).toEqual(Exit.die("boom"));
        const failed = yield* UnitOfWork.atomic(
          insert.pipe(Effect.andThen(Effect.fail(new WorkFailed()))),
        ).pipe(Effect.exit);
        expect(failed).toEqual(Exit.fail(new WorkFailed()));
        expect(yield* sql`select id from parent_rows`).toEqual([]);
      }),
    );
  },
);

layer(sqlWorld, { excludeTestServices: true, timeout: "30 seconds" })(
  "UnitOfWork, sql adapter with a lost connection",
  (it) => {
    it.effect("a ROLLBACK that fails yields UnitOfWorkFailed beside the work's own error", () =>
      Effect.gen(function* rollbackFails() {
        const sql = yield* SqlClient;
        // Its own layer: killing the connection fails the work, then its ROLLBACK, then the pool.
        const exit = yield* UnitOfWork.atomic(
          sql`select pg_terminate_backend(pg_backend_pid())`,
        ).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) return;
        expect(Cause.hasDies(exit.cause)).toBe(false);
        const errors = exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error);
        expect(errors.map((error) => (error as { _tag: string })._tag)).toEqual([
          "UnitOfWorkFailed",
          "SqlError",
        ]);
      }),
    );
  },
);

const killedConnection = Effect.gen(function* killedConnection() {
  const sql = yield* SqlClient;
  // The ROLLBACK fails with the very SqlError the work died with, so identity cannot tell them apart.
  const died: Array<unknown> = [];
  const kill = sql`select pg_terminate_backend(pg_backend_pid())`.pipe(
    Effect.catch((error) =>
      Effect.sync(() => died.push(error)).pipe(Effect.andThen(Effect.die(error))),
    ),
  );
  return { died, kill };
});

layer(sqlWorld, { excludeTestServices: true, timeout: "30 seconds" })(
  "UnitOfWork, sql adapter with a lost connection and a work defect",
  (it) => {
    it.effect("a failed ROLLBACK is reported even when the work died with the same error", () =>
      Effect.gen(function* rollbackFailsSameDefect() {
        const { died, kill } = yield* killedConnection;
        const exit = yield* UnitOfWork.atomic(kill).pipe(Effect.exit);
        expect(died).toHaveLength(1);
        expect(causeShape(exit)).toEqual([
          { fail: expect.any(UnitOfWorkFailed) },
          { die: died[0] },
        ]);
      }),
    );
  },
);

layer(sqlWorld, { excludeTestServices: true, timeout: "30 seconds" })(
  "UnitOfWork, sql adapter with a lost connection and a mixed cause",
  (it) => {
    it.effect("a failed ROLLBACK keeps every reason of the work's cause beside it", () =>
      Effect.gen(function* rollbackFailsMixedCause() {
        const { died, kill } = yield* killedConnection;
        const work = Effect.fail(new WorkFailed()).pipe(
          Effect.ensuring(kill),
          Effect.ensuring(Effect.interrupt),
        );
        const exit = yield* UnitOfWork.atomic(work).pipe(Effect.exit);
        expect(died).toHaveLength(1);
        expect(causeShape(exit)).toEqual([
          { fail: expect.any(UnitOfWorkFailed) },
          { fail: new WorkFailed() },
          { die: died[0] },
          { interrupt: true },
        ]);
      }),
    );
  },
);
