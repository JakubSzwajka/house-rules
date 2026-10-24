import { expect, layer } from "@effect/vitest";
import { NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { WorkItemFailure, WorkItemNotFound, WorkItemStore, WorkItems } from "../../index.js";
import { a, b, project, access } from "./access.js";
import { stores } from "./stores.js";

for (const { name, layer: storeLayer } of stores) {
  const world = WorkItems.layer(WorkItems.presets.board).pipe(
    Layer.provide(access),
    Layer.provideMerge(storeLayer),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `WorkItem guards on ${name}`,
    (it) => {
      it.effect("lets the assigned agent claim and re-claim its own board item", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems.pipe(
            Effect.provide(
              WorkItems.layer({
                ...WorkItems.presets.board,
                holderKinds: ["agent"],
                claim: { holderKind: "agent", toState: "doing" },
              }).pipe(Layer.provide(access)),
            ),
          );
          const { item } = yield* UnitOfWork.atomic(
            work.create(a, { title: "assigned agent", container: project("shared") }),
          );
          const holder = { kind: "agent", id: b.id };
          const assigned = yield* UnitOfWork.atomic(work.assign(a, item.id, holder));
          expect(assigned.item.status).toBe("todo");
          const claimed = yield* UnitOfWork.atomic(work.claim(b, item.id));
          expect(claimed.item).toMatchObject({ status: "doing", holder });
          expect(claimed.events).toEqual([
            {
              kind: "work_items.claimed",
              subject: { kind: "work_item", id: item.id },
              from: { status: "todo", holder },
              to: { status: "doing", holder },
            },
          ]);
          expect(yield* work.get(b, item.id)).toEqual(claimed.item);
          expect(yield* UnitOfWork.atomic(work.claim(b, item.id))).toEqual({
            item: claimed.item,
            events: [],
          });
        }),
      );
      it.effect("claims an unheld target-state item without a self-transition", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems.pipe(
            Effect.provide(
              WorkItems.layer({
                ...WorkItems.presets.board,
                transitions: { todo: ["doing"], doing: ["todo"] },
              }).pipe(Layer.provide(access)),
            ),
          );
          const { item } = yield* UnitOfWork.atomic(work.create(a, { title: "already doing" }));
          yield* UnitOfWork.atomic(work.setStatus(a, item.id, "doing"));
          const claimed = yield* UnitOfWork.atomic(work.claim(a, item.id));
          expect(claimed.item).toMatchObject({
            status: "doing",
            holder: { kind: "person", id: a.id },
          });
          expect(claimed.events).toHaveLength(1);
          expect(yield* UnitOfWork.atomic(work.claim(a, item.id))).toEqual({
            item: claimed.item,
            events: [],
          });
        }),
      );
      it.effect(
        "releases a blocked holder without changing status and moves unheld doing to todo",
        () =>
          Effect.gen(function* () {
            const work = yield* WorkItems;
            const { item } = yield* UnitOfWork.atomic(work.create(a, { title: "release states" }));
            yield* UnitOfWork.atomic(work.assign(a, item.id, { kind: "person", id: a.id }));
            yield* UnitOfWork.atomic(work.setStatus(a, item.id, "blocked"));
            const released = yield* UnitOfWork.atomic(work.release(a, item.id));
            expect(released.item).toMatchObject({ holder: null, status: "blocked" });
            expect(released.events).toHaveLength(1);
            expect(yield* UnitOfWork.atomic(work.release(a, item.id))).toEqual({
              item: released.item,
              events: [],
            });
            yield* UnitOfWork.atomic(work.setStatus(a, item.id, "doing"));
            const unheld = yield* UnitOfWork.atomic(work.release(a, item.id));
            expect(unheld.item).toMatchObject({ holder: null, status: "todo" });
            expect(unheld.events).toHaveLength(1);
          }),
      );
      it.effect("hides stored items whose container kind is no longer configured", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const { item } = yield* UnitOfWork.atomic(
            work.create(a, { title: "retired container", container: project("a") }),
          );
          const changed = yield* WorkItems.pipe(
            Effect.provide(
              WorkItems.layer({ ...WorkItems.presets.board, containerKinds: [] }).pipe(
                Layer.provide(access),
              ),
            ),
          );
          expect(yield* Effect.flip(changed.get(a, item.id))).toBeInstanceOf(WorkItemNotFound);
          const writes: ReadonlyArray<Effect.Effect<unknown, WorkItemFailure | NoOpenUnit>> = [
            changed.edit(a, item.id, { title: "hidden" }),
            changed.setStatus(a, item.id, "doing"),
            changed.assign(a, item.id, null),
            changed.claim(a, item.id),
            changed.release(a, item.id),
            changed.create(a, { title: "hidden child", parent: item.id }),
          ];
          for (const write of writes)
            expect(
              yield* Effect.match(UnitOfWork.atomic(write), {
                onSuccess: () => null,
                onFailure: (error) => error,
              }),
            ).toBeInstanceOf(WorkItemNotFound);
          expect(yield* work.get(a, item.id)).toEqual(item);
        }),
      );
      it.effect("bounds tree fetches and rejects oversized containers without truncating", () =>
        Effect.gen(function* () {
          const store = yield* WorkItemStore;
          let requestedSize: number | undefined;
          let fetched = 0;
          const work = yield* WorkItems.pipe(
            Effect.provide(
              WorkItems.layer({ ...WorkItems.presets.board, maxTreeSize: 2 }).pipe(
                Layer.provide(access),
                Layer.provide(
                  Layer.succeed(WorkItemStore, {
                    ...store,
                    list: (visible, filters) => {
                      requestedSize = filters.size;
                      return store.list(visible, filters).pipe(
                        Effect.tap((rows) =>
                          Effect.sync(() => {
                            fetched = rows.length;
                          }),
                        ),
                      );
                    },
                  }),
                ),
              ),
            ),
          );
          yield* UnitOfWork.atomic(work.removeContainer(project("a")));
          const root = (yield* UnitOfWork.atomic(
            work.create(a, { title: "bounded root", container: project("a") }),
          )).item;
          const child = (yield* UnitOfWork.atomic(
            work.create(a, { title: "bounded child", parent: root.id }),
          )).item;
          expect(yield* work.tree(a, project("a"))).toEqual([
            { item: root, children: [{ item: child, children: [] }] },
          ]);
          expect(requestedSize).toBe(3);
          expect(fetched).toBe(2);
          for (const title of ["overflow", "still bounded"]) {
            yield* UnitOfWork.atomic(work.create(a, { title, container: project("a") }));
            const failure = yield* Effect.flip(work.tree(a, project("a")));
            expect(failure).toMatchObject({ _tag: "WorkItemTreeTooLarge", kind: "invalid" });
            expect(failure.message).toBe("Work item tree is too large.");
            expect(yield* Schema.decodeUnknownEffect(WorkItemFailure)(failure)).toEqual(failure);
            expect(requestedSize).toBe(3);
            expect(fetched).toBe(3);
          }
        }),
      );
    },
  );
}
