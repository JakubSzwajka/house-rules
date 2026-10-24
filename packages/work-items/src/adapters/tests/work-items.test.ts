import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Exit, Layer, Schema } from "effect";
import {
  DepthExceeded,
  TransitionNotAllowed,
  WorkItemClosed,
  WorkItemHeld,
  WorkItemInputInvalid,
  WorkItemNotFound,
  WorkItems,
  type WorkItemFailure,
} from "../../index.js";
import { stores } from "./stores.js";
import { a, b, project, access } from "./access.js";
class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}
for (const { name, layer: storeLayer } of stores) {
  const world = WorkItems.layer({ ...WorkItems.presets.board, maxPageSize: 2 }).pipe(
    Layer.provide(access),
    Layer.provideMerge(storeLayer),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `WorkItems on ${name}`,
    (it) => {
      it.effect("inherits the parent container and enforces one-column depth", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const root = (yield* UnitOfWork.atomic(
            work.create(a, { title: "root", container: project("a") }),
          )).item;
          const child = (yield* UnitOfWork.atomic(
            work.create(a, { title: "child", parent: root.id, container: project("b") }),
          )).item;
          expect(child.container).toEqual(root.container);
          expect(child.parent).toBe(root.id);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(work.create(a, { title: "grandchild", parent: child.id })),
            ),
          ).toBeInstanceOf(DepthExceeded);
          expect(yield* work.tree(a, project("a"))).toEqual([
            { item: root, children: [{ item: child, children: [] }] },
          ]);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(work.create(a, { title: "missing", parent: "missing" })),
            ),
          ).toBeInstanceOf(WorkItemNotFound);
          expect(
            yield* Effect.flip(
              UnitOfWork.atomic(work.create(b, { title: "hidden", parent: root.id })),
            ),
          ).toBeInstanceOf(WorkItemNotFound);
        }),
      );
      it.effect("returns contract event facts and preserves arbitrary JSON including null", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const made = yield* UnitOfWork.atomic(
            work.create(a, { title: "json", attributes: null }),
          );
          expect(made.item.attributes).toBeNull();
          expect(made.events).toEqual([
            {
              kind: "work_items.created",
              subject: { kind: "work_item", id: made.item.id },
              item: made.item,
            },
          ]);
          const attributes = [1, null, false, { arbitrary: { deep: ["value"] } }];
          const edited = yield* UnitOfWork.atomic(
            work.edit(a, made.item.id, { title: "new title", body: "# plain text", attributes }),
          );
          expect(edited.item.body).toBe("# plain text");
          expect(edited.events).toEqual([
            {
              kind: "work_items.edited",
              subject: { kind: "work_item", id: made.item.id },
              from: { title: "json", body: "", attributes: null },
              to: { title: "new title", body: "# plain text", attributes },
            },
          ]);
          expect((yield* work.get(a, made.item.id)).attributes).toEqual(attributes);
          yield* UnitOfWork.atomic(work.edit(a, made.item.id, { attributes: "scalar" }));
          expect((yield* work.get(a, made.item.id)).attributes).toBe("scalar");
        }),
      );
      it.effect("assignment never changes status; claim and release do", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const { item } = yield* UnitOfWork.atomic(
            work.create(a, { title: "holding", container: project("shared") }),
          );
          const holder = { kind: "person", id: "b" };
          const assigned = yield* UnitOfWork.atomic(work.assign(a, item.id, holder));
          expect(assigned.item.status).toBe("todo");
          expect(assigned.events[0]).toMatchObject({
            kind: "work_items.assigned",
            from: null,
            to: holder,
          });
          const held = yield* Effect.flip(UnitOfWork.atomic(work.claim(a, item.id)));
          expect(held).toBeInstanceOf(WorkItemHeld);
          expect(held.message).toContain("person:b");
          yield* UnitOfWork.atomic(work.assign(a, item.id, null));
          const claimed = yield* UnitOfWork.atomic(work.claim(a, item.id));
          expect(claimed.item).toMatchObject({
            status: "doing",
            holder: { kind: "person", id: "a" },
          });
          expect(claimed.events[0]).toMatchObject({
            kind: "work_items.claimed",
            from: { holder: null, status: "todo" },
            to: { holder: { kind: "person", id: "a" }, status: "doing" },
          });
          expect(yield* UnitOfWork.atomic(work.claim(a, item.id))).toEqual({
            item: claimed.item,
            events: [],
          });
          const released = yield* UnitOfWork.atomic(work.release(b, item.id));
          expect(released.item).toMatchObject({ holder: null, status: "todo" });
          expect(released.events[0]).toMatchObject({
            kind: "work_items.released",
            from: { status: "doing" },
            to: { holder: null, status: "todo" },
          });
          yield* UnitOfWork.atomic(work.setStatus(a, item.id, "blocked"));
          const blocked = yield* work.get(a, item.id);
          expect(yield* UnitOfWork.atomic(work.release(a, item.id))).toEqual({
            item: blocked,
            events: [],
          });
        }),
      );
      it.effect("sets closedAt on closure, clears it on reopen and refuses closed claims", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const { item } = yield* UnitOfWork.atomic(work.create(a, { title: "closing" }));
          for (const status of ["done", "dropped"]) {
            const changed = yield* UnitOfWork.atomic(work.setStatus(a, item.id, status));
            expect(changed.item.closedAt).not.toBeNull();
            expect(changed.events[0]).toMatchObject({
              kind: "work_items.status_changed",
              to: status,
            });
            expect(yield* Effect.flip(UnitOfWork.atomic(work.claim(a, item.id)))).toBeInstanceOf(
              WorkItemClosed,
            );
            expect(
              (yield* UnitOfWork.atomic(work.setStatus(a, item.id, "todo"))).item.closedAt,
            ).toBeNull();
          }
          expect(
            yield* Effect.flip(UnitOfWork.atomic(work.setStatus(a, item.id, "unknown"))),
          ).toBeInstanceOf(TransitionNotAllowed);
          const strict = yield* WorkItems.pipe(
            Effect.provide(
              WorkItems.layer({ ...WorkItems.presets.board, transitions: { todo: [] } }).pipe(
                Layer.provide(access),
              ),
            ),
          );
          expect(
            yield* Effect.flip(UnitOfWork.atomic(strict.setStatus(a, item.id, "doing"))),
          ).toBeInstanceOf(TransitionNotAllowed);
          expect(yield* Effect.flip(UnitOfWork.atomic(strict.claim(a, item.id)))).toBeInstanceOf(
            TransitionNotAllowed,
          );
        }),
      );
      it.effect("exactly one of two concurrent claims wins", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const { item } = yield* UnitOfWork.atomic(
            work.create(a, { title: "race", container: project("shared") }),
          );
          const outcomes = yield* Effect.forEach(
            [a, b],
            (actor) => UnitOfWork.atomic(work.claim(actor, item.id)).pipe(Effect.result),
            { concurrency: "unbounded" },
          );
          const successes = outcomes.filter((outcome) => outcome._tag === "Success");
          const failures = outcomes.filter((outcome) => outcome._tag === "Failure");
          expect(successes).toHaveLength(1);
          expect(failures).toHaveLength(1);
          expect(failures[0]?.failure).toBeInstanceOf(WorkItemHeld);
          const saved = yield* work.get(a, item.id);
          expect(saved.status).toBe("doing");
          expect(saved.holder).toEqual(successes[0]?.success.item.holder);
        }),
      );
      it.effect("combines state, category, holder, parent and container filters", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const container = project("shared");
          const root = (yield* UnitOfWork.atomic(work.create(a, { title: "filters", container })))
            .item;
          const child = (yield* UnitOfWork.atomic(
            work.create(a, { title: "filtered child", parent: root.id }),
          )).item;
          const claimed = (yield* UnitOfWork.atomic(work.claim(a, child.id))).item;
          const filters = {
            container,
            parent: root.id,
            state: "doing",
            category: "active" as const,
            holder: { kind: "person", id: "a" },
          };
          expect((yield* work.list(a, filters)).items).toEqual([claimed]);
          expect((yield* work.list(a, { ...filters, state: "todo" })).items).toEqual([]);
          expect((yield* work.list(a, { ...filters, category: "done" })).items).toEqual([]);
          expect((yield* work.list(a, { ...filters, holder: null })).items).toEqual([]);
          expect(
            (yield* work.list(a, { ...filters, parent: null })).items.every(
              (item) => item.parent === null && item.id !== child.id,
            ),
          ).toBe(true);
          expect(yield* Effect.flip(work.list(a, { state: "unknown" }))).toBeInstanceOf(
            WorkItemInputInvalid,
          );
        }),
      );
      it.effect("rolls back writes and both trusted cascades", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const { item } = yield* UnitOfWork.atomic(
            work.create(a, {
              title: "rollback",
              container: project("shared"),
              holder: { kind: "person", id: "rollback" },
            }),
          );
          const failed = yield* Effect.exit(
            UnitOfWork.atomic(
              Effect.gen(function* () {
                yield* work.edit(a, item.id, { title: "not saved" });
                yield* work.releaseHolder({ kind: "person", id: "rollback" });
                yield* work.removeContainer(project("shared"));
                return yield* new Rollback();
              }),
            ),
          );
          expect(Exit.isFailure(failed)).toBe(true);
          expect(yield* work.get(a, item.id)).toEqual(item);
          yield* UnitOfWork.atomic(work.releaseHolder({ kind: "person", id: "rollback" }));
          expect(yield* work.get(a, item.id)).toMatchObject({ holder: null, status: "todo" });
          yield* UnitOfWork.atomic(work.removeContainer(project("shared")));
          expect(yield* Effect.flip(work.get(a, item.id))).toBeInstanceOf(WorkItemNotFound);
        }),
      );
      it.effect("requires a unit for every facade write", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const writes: ReadonlyArray<Effect.Effect<unknown, WorkItemFailure | NoOpenUnit>> = [
            work.create(a, { title: "outside" }),
            work.edit(a, "missing", {}),
            work.setStatus(a, "missing", "done"),
            work.assign(a, "missing", null),
            work.claim(a, "missing"),
            work.release(a, "missing"),
            work.removeContainer(project("a")),
            work.releaseHolder({ kind: "person", id: "a" }),
          ];
          for (const write of writes)
            expect(
              yield* Effect.match(write, { onSuccess: () => null, onFailure: (error) => error }),
            ).toBeInstanceOf(NoOpenUnit);
        }),
      );
    },
  );
}
