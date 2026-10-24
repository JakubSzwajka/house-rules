import { expect, layer } from "@effect/vitest";
import { Runtime, runFeature, StepTrace } from "@house-rules/application";
import { Effect, Layer } from "effect";
import {
  DepthExceeded,
  WorkItemIdTaken,
  WorkItemInputInvalid,
  WorkItemNotFound,
  WorkItems,
  WorkItemsCallerDenied,
  WorkItemsMount,
  WorkItemTreeTooLarge,
} from "../../index.js";
import { stores } from "./stores.js";
import { MoveImportTesting } from "./move-import-testing.js";
const {
  create,
  move,
  rollback,
  read,
  importItems,
  personImport,
  systemMove,
  features,
  caller,
  system,
  access,
  options,
  ref,
  stored,
} = MoveImportTesting;

for (const { name, layer: storeLayer } of stores) {
  const module = WorkItems.layer(options).pipe(
    Layer.provideMerge(storeLayer),
    Layer.provide(access),
  );
  const world = Runtime.layer({ mounts: [WorkItemsMount], features, ways: [] }).pipe(
    Layer.provideMerge(module),
    Layer.provideMerge(StepTrace.layer()),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Move and import on ${name}`,
    (it) => {
      it.effect("moves descendants and returns old and new place facts", () =>
        Effect.gen(function* () {
          const root = (yield* runFeature(create, { title: "root", container: ref("old") })).item;
          const child = (yield* runFeature(create, { title: "child", parent: root.id })).item;
          const grandchild = (yield* runFeature(create, { title: "grandchild", parent: child.id }))
            .item;
          const moved = yield* runFeature(move, { id: root.id, to: { container: ref("new") } });
          expect(moved.events).toEqual([
            {
              kind: "work_items.moved",
              subject: { kind: "work_item", id: root.id },
              from: { parent: null, container: ref("old") },
              to: { parent: null, container: ref("new") },
            },
          ]);
          for (const item of [root, child, grandchild]) {
            const current = yield* runFeature(read, { id: item.id });
            expect(current).toMatchObject({
              ...item,
              container: ref("new"),
              updatedAt: moved.item.updatedAt,
            });
          }
        }).pipe(Effect.provide(caller)),
      );
      it.effect("moves under a parent and detaches back to inbox", () =>
        Effect.gen(function* () {
          const parent = (yield* runFeature(create, { title: "parent", container: ref("parent") }))
            .item;
          const child = (yield* runFeature(create, { title: "child", container: ref("separate") }))
            .item;
          const moved = yield* runFeature(move, { id: child.id, to: { parent: parent.id } });
          expect(moved.item).toMatchObject({
            id: child.id,
            parent: parent.id,
            container: parent.container,
          });
          expect(
            (yield* runFeature(move, { id: child.id, to: { container: null } })).item,
          ).toMatchObject({ parent: null, container: null });
        }).pipe(Effect.provide(caller)),
      );
      it.effect("refuses cycles through descendants and self", () =>
        Effect.gen(function* () {
          const root = (yield* runFeature(create, { title: "root", container: ref("cycle") })).item;
          const child = (yield* runFeature(create, { title: "child", parent: root.id })).item;
          for (const parent of [child.id, root.id]) {
            const error = yield* Effect.flip(runFeature(move, { id: root.id, to: { parent } }));
            expect(error).toBeInstanceOf(WorkItemInputInvalid);
            expect(error.message).toContain("cycle");
          }
          expect((yield* runFeature(read, { id: root.id })).parent).toBeNull();
        }).pipe(Effect.provide(caller)),
      );
      it.effect("refuses wrong container kinds and excessive subtree depth", () =>
        Effect.gen(function* () {
          const root = (yield* runFeature(create, { title: "root", container: ref("depth") })).item;
          const child = (yield* runFeature(create, { title: "child", parent: root.id })).item;
          yield* runFeature(create, { title: "grandchild", parent: child.id });
          const destination = (yield* runFeature(create, {
            title: "destination",
            container: ref("depth-target"),
          })).item;
          expect(
            yield* Effect.flip(
              runFeature(move, {
                id: root.id,
                to: { container: { kind: "retired", id: "target" } },
              }),
            ),
          ).toBeInstanceOf(WorkItemInputInvalid);
          expect(
            yield* Effect.flip(runFeature(move, { id: root.id, to: { parent: destination.id } })),
          ).toBeInstanceOf(DepthExceeded);
        }).pipe(Effect.provide(caller)),
      );
      it.effect("allows reparenting inside a container already above maxTreeSize", () =>
        Effect.gen(function* () {
          const parent = (yield* runFeature(create, {
            title: "parent",
            container: ref("over-limit"),
          })).item;
          const child = (yield* runFeature(create, {
            title: "child",
            container: ref("over-limit"),
          })).item;
          for (let i = 0; i < options.maxTreeSize; i++)
            yield* runFeature(create, { title: "extra", container: ref("over-limit") });
          expect(
            (yield* runFeature(move, { id: child.id, to: { parent: parent.id } })).item.parent,
          ).toBe(parent.id);
          expect(
            (yield* runFeature(move, { id: child.id, to: { container: ref("over-limit") } })).item
              .parent,
          ).toBeNull();
        }).pipe(Effect.provide(caller)),
      );
      it.effect("refuses target overflow and leaves descendants unchanged", () =>
        Effect.gen(function* () {
          const root = (yield* runFeature(create, {
            title: "root",
            container: ref("overflow-old"),
          })).item;
          yield* runFeature(create, { title: "child", parent: root.id });
          for (let n = 0; n < 3; n++)
            yield* runFeature(create, { title: "existing", container: ref("overflow-new") });
          expect(
            yield* Effect.flip(
              runFeature(move, { id: root.id, to: { container: ref("overflow-new") } }),
            ),
          ).toBeInstanceOf(WorkItemTreeTooLarge);
          expect((yield* runFeature(read, { id: root.id })).container).toEqual(root.container);
        }).pipe(Effect.provide(caller)),
      );
      it.effect("checks target access for containers and parents and old-place access", () =>
        Effect.gen(function* () {
          const root = (yield* runFeature(create, { title: "root", container: ref("access-old") }))
            .item;
          yield* runFeature(importItems, { items: [stored("hidden-parent", ref("denied"))] }).pipe(
            Effect.provide(system),
          );
          for (const to of [{ container: ref("denied") }, { parent: "hidden-parent" }])
            expect(yield* Effect.flip(runFeature(move, { id: root.id, to }))).toBeInstanceOf(
              WorkItemNotFound,
            );
          expect(
            yield* Effect.flip(
              runFeature(move, { id: "hidden-parent", to: { container: ref("access-old") } }),
            ),
          ).toBeInstanceOf(WorkItemNotFound);
          expect((yield* runFeature(read, { id: root.id })).container).toEqual(root.container);
        }).pipe(Effect.provide(caller)),
      );
      it.effect("rolls back an entire failed move including descendants", () =>
        Effect.gen(function* () {
          const root = (yield* runFeature(create, {
            title: "root",
            container: ref("rollback-old"),
          })).item;
          const child = (yield* runFeature(create, { title: "child", parent: root.id })).item;
          expect(
            yield* Effect.flip(
              runFeature(rollback, { id: root.id, to: { container: ref("rollback-new") } }),
            ),
          ).toBeInstanceOf(WorkItemInputInvalid);
          expect(yield* runFeature(read, { id: root.id })).toEqual(root);
          expect(yield* runFeature(read, { id: child.id })).toEqual(child);
        }).pipe(Effect.provide(caller)),
      );
      it.effect("allocates increasing integer strings", () =>
        Effect.gen(function* () {
          const first = (yield* runFeature(create, { title: "first", container: ref("sequence") }))
            .item.id;
          const second = (yield* runFeature(create, {
            title: "second",
            container: ref("sequence"),
          })).item.id;
          expect(first).toMatch(/^\d+$/);
          expect(BigInt(second)).toBe(BigInt(first) + 1n);
        }).pipe(Effect.provide(caller)),
      );
      it.effect("imports full items and advances sequence before the next create", () =>
        Effect.gen(function* () {
          const items = [
            stored("10001", ref("numeric")),
            { ...stored("10000", ref("numeric")), parent: "10001" },
          ];
          const result = yield* runFeature(importItems, { items }).pipe(Effect.provide(system));
          expect(result.items).toEqual(items);
          expect(result.events.map((event) => event.kind)).toEqual([
            "work_items.created",
            "work_items.created",
          ]);
          for (const item of items) expect(yield* runFeature(read, { id: item.id })).toEqual(item);
          const next = (yield* runFeature(create, {
            title: "after import",
            container: ref("numeric-next"),
          })).item;
          expect(next.id).toBe("10002");
          yield* runFeature(importItems, { items: [stored("0007", ref("lower"))] }).pipe(
            Effect.provide(system),
          );
          expect(
            (yield* runFeature(create, {
              title: "after lower import",
              container: ref("numeric-next"),
            })).item.id,
          ).toBe("10003");
        }).pipe(Effect.provide(caller)),
      );
      it.effect("refuses existing and duplicate batch ids without partial writes", () =>
        Effect.gen(function* () {
          const existing = (yield* runFeature(create, {
            title: "existing",
            container: ref("conflict"),
          })).item;
          for (const items of [
            [stored("partial"), stored(existing.id)],
            [stored("duplicate"), stored("duplicate")],
          ]) {
            const denied = yield* Effect.flip(
              runFeature(importItems, { items }).pipe(Effect.provide(system)),
            );
            expect(denied).toBeInstanceOf(WorkItemIdTaken);
            expect(denied.kind).toBe("conflict");
          }
          expect(yield* Effect.flip(runFeature(read, { id: "partial" }))).toBeInstanceOf(
            WorkItemNotFound,
          );
          expect(yield* runFeature(read, { id: existing.id })).toEqual(existing);
        }).pipe(Effect.provide(caller)),
      );
      it.effect("refuses person import and system moves", () =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(runFeature(personImport, { items: [] }));
          expect(error).toBeInstanceOf(WorkItemsCallerDenied);
          expect(error.kind).toBe("forbidden");
          expect(
            yield* Effect.flip(
              runFeature(systemMove, { id: "missing", to: { container: null } }).pipe(
                Effect.provide(system),
              ),
            ),
          ).toBeInstanceOf(WorkItemNotFound);
        }).pipe(Effect.provide(caller)),
      );
    },
  );
}
