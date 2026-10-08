import { expect } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { NoOpenUnit, UnitOfWork } from "../../index.ts";
import {
  causeShape,
  contents,
  reset,
  Stores,
  WorkFailed,
  writeBoth,
} from "./unit-of-work-fixtures.ts";
import { onBothAdapters } from "./unit-of-work-suite.ts";

onBothAdapters("UnitOfWork", (it) => {
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
});
