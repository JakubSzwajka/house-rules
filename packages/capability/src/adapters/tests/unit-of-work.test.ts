import { expect, layer } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { Approval, CallWatch, Grant, implement, NoOpenUnit, UnitOfWork } from "../../index.ts";
import {
  causeShape,
  contents,
  memoryWorld,
  Opens,
  outliveUnit,
  raceUnitEnd,
  reset,
  sqlWorld,
  Stores,
  WorkFailed,
  writeBoth,
  writeBothCapability,
  writeContract,
} from "./unit-of-work-fixtures.ts";

const suite = <E>(name: string, world: Layer.Layer<UnitOfWork | Stores | Opens, E>) =>
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(name, (it) => {
    it.effect("a module write with no open unit fails with NoOpenUnit", () =>
      Effect.gen(function* noOpenUnit() {
        yield* reset;
        const { alpha } = yield* Stores;
        const error = yield* Effect.flip(alpha.put("a1"));
        expect(error).toBeInstanceOf(NoOpenUnit);
        expect(yield* contents).toEqual({ alpha: [], beta: [] });
      }),
    );

    it.effect("one unit commits the writes of two modules", () =>
      Effect.gen(function* commits() {
        yield* reset;
        yield* UnitOfWork.atomic(writeBoth);
        expect(yield* contents).toEqual({ alpha: ["a1"], beta: ["b1"] });
      }),
    );

    it.effect("a failure inside one unit rolls back the writes of two modules", () =>
      Effect.gen(function* rollsBack() {
        yield* reset;
        const exit = yield* UnitOfWork.atomic(
          writeBoth.pipe(Effect.andThen(Effect.fail(new WorkFailed()))),
        ).pipe(Effect.exit);
        expect(exit).toEqual(Exit.fail(new WorkFailed()));
        expect(yield* contents).toEqual({ alpha: [], beta: [] });
      }),
    );

    it.effect("a defect inside one unit rolls back too", () =>
      Effect.gen(function* rollsBackOnDefect() {
        yield* reset;
        const exit = yield* UnitOfWork.atomic(
          writeBoth.pipe(Effect.andThen(Effect.die("boom"))),
        ).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* contents).toEqual({ alpha: [], beta: [] });
      }),
    );

    const failing = Effect.fail(new WorkFailed());
    const mixed = [
      [
        "a handler finalizer defect",
        failing.pipe(Effect.ensuring(Effect.die("handler-finalizer"))),
        [{ fail: new WorkFailed() }, { die: "handler-finalizer" }],
      ],
      [
        "a scope finalizer defect",
        Effect.scoped(
          Effect.addFinalizer(() => Effect.die("scope-finalizer")).pipe(Effect.andThen(failing)),
        ),
        [{ fail: new WorkFailed() }, { die: "scope-finalizer" }],
      ],
      [
        "a nested unit's finalizer defect",
        UnitOfWork.atomic(failing.pipe(Effect.ensuring(Effect.die("nested-finalizer")))),
        [{ fail: new WorkFailed() }, { die: "nested-finalizer" }],
      ],
      [
        "an interruption",
        failing.pipe(Effect.ensuring(Effect.interrupt)),
        [{ fail: new WorkFailed() }, { interrupt: true }],
      ],
    ] as const;
    for (const [name, work, expected] of mixed) {
      it.effect(`a typed failure plus ${name} keeps every reason of the cause`, () =>
        Effect.gen(function* mixedCause() {
          yield* reset;
          expect(causeShape(yield* Effect.exit(work))).toEqual(expected);
          const exit = yield* UnitOfWork.atomic(writeBoth.pipe(Effect.andThen(work))).pipe(
            Effect.exit,
          );
          expect(causeShape(exit)).toEqual(expected);
          expect(yield* contents).toEqual({ alpha: [], beta: [] });
        }),
      );
    }

    it.effect("a nested atomic joins the open unit instead of opening its own", () =>
      Effect.gen(function* nestedJoins() {
        yield* reset;
        const { alpha, beta } = yield* Stores;
        // Joined, a failed inner unit undoes nothing on its own; the outer unit decides.
        yield* UnitOfWork.atomic(
          Effect.gen(function* outer() {
            yield* alpha.put("a1");
            yield* UnitOfWork.atomic(
              beta.put("b1").pipe(Effect.andThen(Effect.fail(new WorkFailed()))),
            ).pipe(Effect.ignore);
          }),
        );
        expect(yield* contents).toEqual({ alpha: ["a1"], beta: ["b1"] });

        yield* reset;
        const exit = yield* UnitOfWork.atomic(
          alpha
            .put("a1")
            .pipe(
              Effect.andThen(UnitOfWork.atomic(beta.put("b1"))),
              Effect.andThen(Effect.fail(new WorkFailed())),
            ),
        ).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* contents).toEqual({ alpha: [], beta: [] });
      }),
    );

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
        expect(errors.map((error) => error._tag)).toEqual([
          "NoOpenUnit",
          "NoOpenUnit",
          "NoOpenUnit",
        ]);
        expect(yield* contents).toEqual({ alpha: [], beta: [] });
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

    it.effect("transactional: true runs the handler inside one unit", () =>
      Effect.gen(function* transactionalHandler() {
        yield* reset;
        const caller = Grant.layerFromPermissions(["rows:write"]);
        yield* writeBothCapability.handler({ fail: false }).pipe(Effect.provide(caller));
        expect(yield* contents).toEqual({ alpha: ["a1"], beta: ["b1"] });

        yield* reset;
        const error = yield* Effect.flip(
          writeBothCapability.handler({ fail: true }).pipe(Effect.provide(caller)),
        );
        expect(error).toBeInstanceOf(WorkFailed);
        expect(yield* contents).toEqual({ alpha: [], beta: [] });
        expect((yield* Opens).calls).toEqual(["atomic"]);
      }),
    );

    it.effect("transactional: true opens no unit when a gate refuses the call", () =>
      Effect.gen(function* gatesFirst() {
        yield* reset;
        const error = yield* Effect.flip(
          writeBothCapability.handler({ fail: false }).pipe(Effect.provide(Grant.denyAll)),
        );
        expect(error._tag).toBe("Forbidden");
        expect((yield* Opens).calls).toEqual([]);
        expect(yield* contents).toEqual({ alpha: [], beta: [] });
      }),
    );

    it.effect("without transactional, the handler runs with no unit open", () =>
      Effect.gen(function* notTransactional() {
        yield* reset;
        const plain = implement(writeContract(false), () => writeBoth);
        const error = yield* Effect.flip(
          plain.handler({ fail: false }).pipe(Effect.provide(Grant.allowAll)),
        );
        expect(error).toBeInstanceOf(NoOpenUnit);
        expect((yield* Opens).calls).toEqual([]);
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

    it.effect("transactional: true opens no unit when Approval is denied", () =>
      Effect.gen(function* approvalFirst() {
        yield* reset;
        const approved = implement(
          { ...writeContract(true), needsApproval: true as const },
          () => writeBoth,
        );
        const error = yield* Effect.flip(
          approved
            .handler({ fail: false })
            .pipe(Effect.provide(Layer.merge(Grant.allowAll, Approval.denyAll))),
        );
        expect(error._tag).toBe("ApprovalDenied");
        expect((yield* Opens).calls).toEqual([]);
        expect(yield* contents).toEqual({ alpha: [], beta: [] });
      }),
    );

    it.effect("CallWatch encloses the gates and the unit", () =>
      Effect.gen(function* watchEncloses() {
        yield* reset;
        const { calls } = yield* Opens;
        const record = (step: string) => Effect.sync(() => void calls.push(step));
        const watched = implement({ ...writeContract(true), needsApproval: true as const }, () =>
          record("handler").pipe(Effect.andThen(writeBoth)),
        );
        const gates = Layer.merge(
          Layer.succeed(Grant, {
            holds: () => record("grant").pipe(Effect.as(true)),
          }),
          Layer.succeed(Approval, { approve: () => record("approval") }),
        );
        yield* watched.handler({ fail: false }).pipe(
          Effect.provide(gates),
          Effect.provideService(CallWatch, {
            around: (_contract, _input, run) =>
              record("watch-before").pipe(
                Effect.andThen(run),
                Effect.ensuring(record("watch-after")),
              ),
          }),
        );
        expect(calls).toEqual([
          "watch-before",
          "grant",
          "approval",
          "atomic",
          "handler",
          "watch-after",
        ]);
        expect(yield* contents).toEqual({ alpha: ["a1"], beta: ["b1"] });
      }),
    );
  });

suite("UnitOfWork, memory adapter", memoryWorld);
suite("UnitOfWork, sql adapter on Postgres", sqlWorld);
