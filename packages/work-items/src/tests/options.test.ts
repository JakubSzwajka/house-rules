import { expect, it } from "@effect/vitest";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  DepthExceeded,
  WorkItemAccess,
  WorkItemAccessUnavailable,
  WorkItemEvent,
  WorkItemInputInvalid,
  WorkItems,
  WorkItemsOptions,
  WorkItemStoreUnavailable,
} from "../index.js";
const actor = Actor.make({ id: ActorId.make("a") });
const access = Layer.succeed(WorkItemAccess, {
  access: () => Effect.succeed("write"),
  visibleContainers: () =>
    Effect.succeed({ containers: [{ kind: "project", id: "p" }], inbox: true }),
});
const options = WorkItems.presets.board;
it.effect("rejects inconsistent workflows and invalid limits at acquisition", () =>
  Effect.gen(function* () {
    const invalid: ReadonlyArray<WorkItemsOptions> = [
      { ...options, states: [] },
      { ...options, states: [...options.states, options.states[0]] },
      { ...options, initial: "missing" },
      { ...options, transitions: { missing: "any" } },
      { ...options, transitions: { todo: ["missing"] } },
      { ...options, claim: { ...options.claim, toState: "missing" } },
      { ...options, claim: { ...options.claim, toState: "done" } },
      { ...options, claim: { ...options.claim, holderKind: "missing" } },
      { ...options, release: { from: "missing", to: "todo" } },
      { ...options, release: { from: "doing", to: "missing" } },
      { ...options, containerKinds: ["project", "project"] },
      { ...options, holderKinds: [] },
      { ...options, holderKinds: ["person", "person"] },
      { ...options, maxDepth: -1 },
      { ...options, maxDepth: 0.5 },
      { ...options, maxTitleLength: 0 },
      { ...options, maxBodyLength: 0 },
      { ...options, maxPageSize: -1 },
      { ...options, maxTreeSize: 0 },
      { ...options, maxTreeSize: -1 },
      { ...options, maxTreeSize: 0.5 },
    ];
    for (const settings of invalid)
      expect(
        yield* Effect.flip(
          Layer.build(WorkItems.layerMemory(settings).pipe(Layer.provide(access))).pipe(
            Effect.scoped,
          ),
        ),
      ).toBeInstanceOf(WorkItemInputInvalid);
    expect(options.maxTreeSize).toBe(500);
    expect(
      yield* Schema.decodeEffect(WorkItemsOptions)({ ...options, maxDepth: 0, containerKinds: [] }),
    ).toMatchObject({ maxDepth: 0 });
  }),
);
const world = WorkItems.layerMemory({
  ...options,
  maxTitleLength: 4,
  maxBodyLength: 5,
  maxDepth: 0,
  holderKinds: ["agent"],
  claim: { toState: "doing", holderKind: "agent" },
}).pipe(Layer.provide(access), Layer.provideMerge(memoryUnitOfWork));
it.layer(world)("WorkItems input bounds", (test) => {
  test.effect("checks text bounds, references, JSON and zero depth without losing state", () =>
    Effect.gen(function* () {
      const work = yield* WorkItems;
      for (const input of [
        { title: "" },
        { title: "large" },
        { title: "okay", body: "123456" },
        { title: "okay", container: { kind: "unknown", id: "p" } },
        { title: "okay", holder: { kind: "person", id: "a" } },
        { title: "okay", attributes: Number.NaN },
      ])
        expect(yield* Effect.flip(UnitOfWork.atomic(work.create(actor, input)))).toBeInstanceOf(
          WorkItemInputInvalid,
        );
      const made = yield* UnitOfWork.atomic(
        work.create(actor, { title: "okay", body: "12345", attributes: true }),
      );
      for (const event of made.events)
        expect(yield* Schema.decodeEffect(WorkItemEvent)(event)).toEqual(event);
      expect(
        yield* Effect.flip(
          UnitOfWork.atomic(work.create(actor, { title: "kid", parent: made.item.id })),
        ),
      ).toBeInstanceOf(DepthExceeded);
      expect(
        yield* Effect.flip(UnitOfWork.atomic(work.edit(actor, made.item.id, { title: "long!" }))),
      ).toBeInstanceOf(WorkItemInputInvalid);
      expect(
        yield* Effect.flip(UnitOfWork.atomic(work.edit(actor, made.item.id, { body: "123456" }))),
      ).toBeInstanceOf(WorkItemInputInvalid);
      expect(
        yield* Effect.flip(
          UnitOfWork.atomic(work.assign(actor, made.item.id, { kind: "bad", id: "a" })),
        ),
      ).toBeInstanceOf(WorkItemInputInvalid);
      const claimed = yield* UnitOfWork.atomic(work.claim(actor, made.item.id));
      expect(claimed.item.holder).toEqual({ kind: "agent", id: "a" });
      expect(claimed.item.body).toBe("12345");
      expect((yield* work.get(actor, made.item.id)).title).toBe("okay");
      expect(yield* Effect.flip(work.list(actor, { size: 0 }))).toBeInstanceOf(
        WorkItemInputInvalid,
      );
    }),
  );
});
it.effect("maps port failures to fixed unavailable text with no internal details", () =>
  Effect.gen(function* () {
    const cause = "private driver details";
    const failed = Layer.succeed(WorkItemAccess, {
      access: () => Effect.fail(new WorkItemAccessUnavailable({ cause })),
      visibleContainers: () => Effect.fail(new WorkItemAccessUnavailable({ cause })),
    });
    const work = yield* WorkItems.pipe(
      Effect.provide(WorkItems.layerMemory(options).pipe(Layer.provide(failed))),
    );
    const denied = yield* Effect.flip(
      UnitOfWork.atomic(work.create(actor, { title: "secret" })).pipe(
        Effect.provide(memoryUnitOfWork),
      ),
    );
    expect(denied).toBeInstanceOf(WorkItemAccessUnavailable);
    expect(denied.message).toBe("Work item access is unavailable. Try again shortly.");
    expect(yield* Effect.flip(work.list(actor))).toBeInstanceOf(WorkItemAccessUnavailable);
    expect(new WorkItemStoreUnavailable({ cause }).message).toBe(
      "Work items are unavailable. Try again shortly.",
    );
  }),
);
