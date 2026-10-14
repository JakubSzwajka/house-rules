import { expect, layer } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import { memoryUnitOfWork, NoOpenUnit, UnitOfWork } from "../../index.ts";

class WorkFailed extends Schema.TaggedError<WorkFailed>()("WorkFailed", {}) {}

const store = () => {
  const rows: Array<string> = [];
  return {
    put: (id: string) =>
      Effect.gen(function* put() {
        yield* UnitOfWork.onRollback(Effect.sync(() => void rows.splice(rows.indexOf(id), 1)));
        rows.push(id);
      }),
    rows: Effect.sync(() => [...rows]),
  };
};

layer(memoryUnitOfWork)("memoryUnitOfWork", (it) => {
  it.effect("a write outside a unit fails with NoOpenUnit", () =>
    Effect.gen(function* outside() {
      const rows = store();
      expect(yield* Effect.flip(rows.put("a"))).toBeInstanceOf(NoOpenUnit);
      expect(yield* Effect.flip(UnitOfWork.required)).toBeInstanceOf(NoOpenUnit);
      expect(yield* rows.rows).toEqual([]);
    }),
  );

  it.effect("a unit keeps its writes when it succeeds", () =>
    Effect.gen(function* commits() {
      const rows = store();
      yield* UnitOfWork.atomic(Effect.andThen(rows.put("a"), rows.put("b")));
      expect(yield* rows.rows).toEqual(["a", "b"]);
    }),
  );

  it.effect("a failed unit runs its undo hooks and keeps the typed error", () =>
    Effect.gen(function* rollsBack() {
      const rows = store();
      const exit = yield* UnitOfWork.atomic(
        rows.put("a").pipe(Effect.andThen(Effect.fail(new WorkFailed()))),
      ).pipe(Effect.exit);
      expect(exit).toEqual(Exit.fail(new WorkFailed()));
      expect(yield* rows.rows).toEqual([]);
    }),
  );

  it.effect("a nested unit joins the open one, so an outer failure undoes the inner write", () =>
    Effect.gen(function* nested() {
      const rows = store();
      const exit = yield* UnitOfWork.atomic(
        UnitOfWork.atomic(rows.put("a")).pipe(Effect.andThen(Effect.fail(new WorkFailed()))),
      ).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(yield* rows.rows).toEqual([]);
    }),
  );
});
