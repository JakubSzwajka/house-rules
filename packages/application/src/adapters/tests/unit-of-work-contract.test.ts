import { featureFixture } from "../../tests/feature-fixtures.ts";
import { expect } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { defineOperation, NoOpenUnit } from "@house-rules/domain";
import { Approval, CallWatch, May } from "../../index.ts";
import { bindFixture, runFixture } from "../../tests/execution-fixtures.ts";
import {
  Opens,
  reset,
  contents,
  writeBoth,
  writeBothEntry,
  writeEntry,
  WorkFailed,
} from "./unit-of-work-fixtures.ts";
import { onBothAdapters } from "./unit-of-work-suite.ts";
onBothAdapters("UnitOfWork with features", (it) => {
  it.effect("a transactional feature runs all callables inside one unit", () =>
    Effect.gen(function* () {
      yield* reset;
      yield* runFixture(writeBothEntry, { fail: false });
      expect(yield* contents).toEqual({ alpha: ["a1"], beta: ["b1"] });
      yield* reset;
      const error = yield* Effect.flip(runFixture(writeBothEntry, { fail: true }));
      expect(error).toBeInstanceOf(WorkFailed);
      expect(yield* contents).toEqual({ alpha: [], beta: [] });
      expect((yield* Opens).calls).toEqual(["atomic"]);
    }),
  );
  it.effect("a transactional NoOpenUnit is a defect and rolls all writes back", () =>
    Effect.gen(function* () {
      yield* reset;
      const broken = bindFixture(writeEntry(true), () =>
        writeBoth.pipe(Effect.andThen(new NoOpenUnit())),
      );
      const exit = yield* Effect.exit(runFixture(broken, { fail: false }));
      expect(exit).toEqual(Exit.die(new NoOpenUnit()));
      if (Exit.isFailure(exit)) expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(yield* contents).toEqual({ alpha: [], beta: [] });
    }),
  );
  it.effect("a refused closure opens no unit", () =>
    Effect.gen(function* () {
      yield* reset;
      const error = yield* Effect.flip(
        runFixture(writeBothEntry, { fail: false }, May.fixed([writeBothEntry], [])),
      );
      expect(error._tag).toBe("Forbidden");
      expect((yield* Opens).calls).toEqual([]);
      expect(yield* contents).toEqual({ alpha: [], beta: [] });
    }),
  );
  it.effect("a nontransactional feature has no open unit", () =>
    Effect.gen(function* () {
      yield* reset;
      const plain = bindFixture(writeEntry(false), () => writeBoth);
      expect(yield* Effect.flip(runFixture(plain, { fail: false }))).toBeInstanceOf(NoOpenUnit);
      expect((yield* Opens).calls).toEqual([]);
    }),
  );
  it.effect("a denied approval opens no unit", () =>
    Effect.gen(function* () {
      yield* reset;
      const approved = bindFixture(
        featureFixture(
          defineOperation("approved_write", { ...writeEntry(true), needsApproval: true }),
        ),
        () => writeBoth,
      );
      const error = yield* Effect.flip(
        runFixture(approved, { fail: false }).pipe(Effect.provide(Approval.denyAll)),
      );
      expect(error._tag).toBe("ApprovalDenied");
      expect((yield* Opens).calls).toEqual([]);
      expect(yield* contents).toEqual({ alpha: [], beta: [] });
    }),
  );
  it.effect("CallWatch encloses the feature gates and its unit", () =>
    Effect.gen(function* () {
      yield* reset;
      const { calls } = yield* Opens;
      const record = (step: string) =>
        Effect.sync(() => {
          calls.push(step);
        });
      const watched = bindFixture(
        featureFixture(
          defineOperation("watched_write", { ...writeEntry(true), needsApproval: true }),
        ),
        () => record("handler").pipe(Effect.andThen(writeBoth)),
      );
      yield* runFixture(watched, { fail: false }).pipe(
        Effect.provideService(Approval, { approve: () => record("approval") }),
        Effect.provideService(CallWatch, {
          around: (_feature, _input, run) =>
            record("watch-before").pipe(
              Effect.andThen(run),
              Effect.ensuring(record("watch-after")),
            ),
        }),
      );
      expect(calls).toEqual(["watch-before", "approval", "atomic", "handler", "watch-after"]);
      expect(yield* contents).toEqual({ alpha: ["a1"], beta: ["b1"] });
    }),
  );
});
