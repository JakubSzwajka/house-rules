import { expect } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { CurrentUnit, NoOpenUnit, UnitOfWork } from "../../index.ts";
import {
  causeShape,
  contents,
  outliveUnit,
  raceUnitEnd,
  reset,
  Stores,
  WorkFailed,
  writeBoth,
} from "./unit-of-work-fixtures.ts";
import { onBothAdapters } from "./unit-of-work-suite.ts";

onBothAdapters("UnitOfWork lifecycle", (it) => {
  it.effect("a fiber that outlives its unit cannot write against it", () =>
    Effect.gen(function* staleUnit() {
      yield* reset;
      const { alpha } = yield* Stores;
      const { go, daemon } = yield* outliveUnit(
        Effect.all([
          UnitOfWork.required.pipe(Effect.flip),
          UnitOfWork.onRollback(Effect.void).pipe(Effect.flip),
          alpha.put("late").pipe(Effect.flip),
        ]),
      );
      yield* Deferred.succeed(go, undefined);
      const errors = yield* Fiber.join(daemon);
      expect(errors.map((error) => error._tag)).toEqual(["NoOpenUnit", "NoOpenUnit", "NoOpenUnit"]);
      expect(yield* contents).toEqual({ alpha: [], beta: [] });
    }),
  );

  it.effect("onRollback on a closed unit fails with a typed NoOpenUnit instead of dying", () =>
    Effect.gen(function* closedUnitHook() {
      yield* reset;
      const { go, daemon } = yield* outliveUnit(
        // The daemon still holds its closed unit, so it can call the unit's own onRollback.
        Effect.gen(function* holdsClosedUnit() {
          const unit = yield* CurrentUnit;
          if (unit === undefined) return yield* Effect.die("the daemon holds no unit");
          return yield* Effect.exit(unit.onRollback(Effect.void));
        }),
      );
      yield* Deferred.succeed(go, undefined);
      expect(yield* Fiber.join(daemon)).toEqual(Exit.fail(new NoOpenUnit()));
    }),
  );

  it.effect("a fiber that outlives its unit opens a new unit with atomic", () =>
    Effect.gen(function* freshUnit() {
      yield* reset;
      // Joined to the closed unit, the failed write would stay; a new unit rolls it back.
      const { go, daemon } = yield* outliveUnit(
        UnitOfWork.atomic(writeBoth.pipe(Effect.andThen(Effect.fail(new WorkFailed())))).pipe(
          Effect.exit,
          Effect.andThen(contents),
        ),
      );
      yield* Deferred.succeed(go, undefined);
      expect(yield* Fiber.join(daemon)).toEqual({ alpha: [], beta: [] });
      const second = yield* outliveUnit(UnitOfWork.atomic(writeBoth));
      yield* Deferred.succeed(second.go, undefined);
      yield* Fiber.join(second.daemon);
      expect(yield* contents).toEqual({ alpha: ["a1"], beta: ["b1"] });
    }),
  );

  it.effect(
    "a fiber racing its unit's rollback gets NoOpenUnit and writes in a unit of its own",
    () =>
      Effect.gen(function* racesRollback() {
        yield* reset;
        const { alpha } = yield* Stores;
        const race = yield* raceUnitEnd(
          alpha.put("a1"),
          UnitOfWork.atomic(alpha.put("daemon")),
          () => Effect.void,
        );
        expect(race.exit).toEqual(Exit.fail(new WorkFailed()));
        expect(race.checked).toEqual(Exit.fail(new NoOpenUnit()));
        yield* Fiber.join(race.daemon);
        expect(yield* contents).toEqual({ alpha: ["daemon"], beta: [] });
      }),
  );

  it.effect("rollback runs every undo hook when one dies, and keeps every cause", () =>
    Effect.gen(function* everyUndo() {
      yield* reset;
      const { alpha, beta } = yield* Stores;
      const undone: Array<string> = [];
      const undo = (name: string) =>
        UnitOfWork.onRollback(Effect.sync(() => void undone.push(name)));
      const exit = yield* UnitOfWork.atomic(
        Effect.gen(function* badUndo() {
          yield* undo("first");
          yield* alpha.put("alpha");
          yield* UnitOfWork.onRollback(Effect.die("bad-undo"));
          yield* beta.put("beta");
          yield* UnitOfWork.onRollback(Effect.die("worse-undo"));
          yield* undo("last");
          return yield* new WorkFailed();
        }),
      ).pipe(Effect.exit);
      expect(causeShape(exit)).toEqual([
        { fail: new WorkFailed() },
        { die: "worse-undo" },
        { die: "bad-undo" },
      ]);
      expect(undone).toEqual(["last", "first"]);
      expect(yield* contents).toEqual({ alpha: [], beta: [] });
    }),
  );

  it.effect("an interruption inside a unit rolls back and runs the undo hooks inner first", () =>
    Effect.gen(function* interrupted() {
      yield* reset;
      const undone: Array<string> = [];
      const ready = yield* Deferred.make<void>();
      const fiber = yield* UnitOfWork.atomic(
        Effect.gen(function* outer() {
          yield* UnitOfWork.onRollback(Effect.sync(() => void undone.push("outer")));
          yield* writeBoth;
          yield* UnitOfWork.atomic(
            UnitOfWork.onRollback(Effect.sync(() => void undone.push("inner"))),
          );
          yield* Deferred.succeed(ready, undefined);
          return yield* Effect.never;
        }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(undone).toEqual(["inner", "outer"]);
      expect(yield* contents).toEqual({ alpha: [], beta: [] });
    }),
  );
});
