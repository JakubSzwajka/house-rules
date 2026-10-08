import { expect, layer } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { memoryUnitOfWork, UnitOfWork } from "../../index.ts";
import { outliveUnit, raceUnitEnd, WorkFailed } from "./unit-of-work-fixtures.ts";

const wholeStateUndoStore = () => {
  let rows: ReadonlyArray<string> = [];
  return {
    put: (id: string) =>
      Effect.gen(function* put() {
        const before = rows;
        yield* UnitOfWork.onRollback(Effect.sync(() => void (rows = before)));
        rows = [...rows, id];
      }),
    rows: Effect.sync(() => rows),
  };
};

const afterTrying = (tried: Deferred.Deferred<void>) =>
  Deferred.await(tried).pipe(Effect.andThen(Effect.yieldNow), Effect.andThen(Effect.yieldNow));

layer(memoryUnitOfWork)("memoryUnitOfWork runs units one at a time", (it) => {
  it.effect("two concurrent top-level units run one after another", () =>
    Effect.gen(function* oneAfterAnother() {
      const log: Array<string> = [];
      const aOpen = yield* Deferred.make<void>();
      const releaseA = yield* Deferred.make<void>();
      const bTried = yield* Deferred.make<void>();
      const a = yield* UnitOfWork.atomic(
        Effect.gen(function* unitA() {
          log.push("A open");
          yield* Deferred.succeed(aOpen, undefined);
          yield* Deferred.await(releaseA);
          log.push("A done");
        }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(aOpen);
      const b = yield* Deferred.succeed(bTried, undefined).pipe(
        Effect.andThen(UnitOfWork.atomic(Effect.sync(() => void log.push("B ran")))),
        Effect.forkChild,
      );
      yield* afterTrying(bTried);
      expect(log).toEqual(["A open"]);
      yield* Deferred.succeed(releaseA, undefined);
      yield* Fiber.join(a);
      yield* Fiber.join(b);
      expect(log).toEqual(["A open", "A done", "B ran"]);
    }),
  );

  it.effect(
    "a nested unit joins the open unit and does not wait, in its fiber or a forked one",
    () =>
      Effect.gen(function* nestedJoins() {
        const result = yield* UnitOfWork.atomic(
          Effect.gen(function* outer() {
            const inner = yield* UnitOfWork.atomic(Effect.succeed(1));
            const forked = yield* UnitOfWork.atomic(Effect.succeed(2)).pipe(Effect.forkChild);
            return inner + (yield* Fiber.join(forked));
          }),
        );
        expect(result).toBe(3);
      }),
  );

  it.effect("a failed unit does not undo the commit of a unit that started while it was open", () =>
    Effect.gen(function* noLostCommit() {
      const store = wholeStateUndoStore();
      const aWrote = yield* Deferred.make<void>();
      const failA = yield* Deferred.make<void>();
      const bTried = yield* Deferred.make<void>();
      const a = yield* UnitOfWork.atomic(
        Effect.gen(function* unitA() {
          yield* store.put("a");
          yield* Deferred.succeed(aWrote, undefined);
          yield* Deferred.await(failA);
          return yield* new WorkFailed();
        }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(aWrote);
      const b = yield* Deferred.succeed(bTried, undefined).pipe(
        Effect.andThen(UnitOfWork.atomic(store.put("b"))),
        Effect.forkChild,
      );
      yield* afterTrying(bTried);
      yield* Deferred.succeed(failA, undefined);
      expect(yield* Fiber.await(a)).toEqual(Exit.fail(new WorkFailed()));
      yield* Fiber.join(b);
      expect(yield* store.rows).toEqual(["b"]);
    }),
  );

  it.effect(
    "a daemon of a closed unit waits for the open unit, so its rollback keeps the commit",
    () =>
      Effect.gen(function* daemonWaits() {
        const store = wholeStateUndoStore();
        const daemonTried = yield* Deferred.make<void>();
        const { go, daemon } = yield* outliveUnit(
          Deferred.succeed(daemonTried, undefined).pipe(
            Effect.andThen(UnitOfWork.atomic(store.put("daemon"))),
          ),
        );
        const aWrote = yield* Deferred.make<void>();
        const failA = yield* Deferred.make<void>();
        const a = yield* UnitOfWork.atomic(
          Effect.gen(function* unitA() {
            yield* store.put("a");
            yield* Deferred.succeed(aWrote, undefined);
            yield* Deferred.await(failA);
            return yield* new WorkFailed();
          }),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(aWrote);
        yield* Deferred.succeed(go, undefined);
        yield* afterTrying(daemonTried);
        expect(yield* store.rows).toEqual(["a"]);
        yield* Deferred.succeed(failA, undefined);
        expect(yield* Fiber.await(a)).toEqual(Exit.fail(new WorkFailed()));
        yield* Fiber.join(daemon);
        expect(yield* store.rows).toEqual(["daemon"]);
      }),
  );

  it.effect("a daemon released during rollback waits for the unit's cleanup to end", () =>
    Effect.gen(function* daemonAfterCleanup() {
      const store = wholeStateUndoStore();
      const race = yield* raceUnitEnd(
        store.put("a"),
        UnitOfWork.atomic(store.put("daemon")),
        // Joined to the closing unit, the daemon would write here, inside the failed unit.
        () => Effect.yieldNow.pipe(Effect.andThen(Effect.yieldNow), Effect.andThen(store.rows)),
      );
      expect(race.exit).toEqual(Exit.fail(new WorkFailed()));
      expect(race.held).toEqual([]);
      yield* Fiber.join(race.daemon);
      expect(yield* store.rows).toEqual(["daemon"]);
    }),
  );
});
