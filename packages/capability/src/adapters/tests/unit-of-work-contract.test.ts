import { expect } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Approval, CallWatch, Grant, implement, NoOpenUnit } from "../../index.ts";
import {
  Opens,
  reset,
  contents,
  writeBoth,
  writeBothCapability,
  writeContract,
  WorkFailed,
} from "./unit-of-work-fixtures.ts";
import { onBothAdapters } from "./unit-of-work-suite.ts";

onBothAdapters("UnitOfWork with contracts", (it) => {
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
