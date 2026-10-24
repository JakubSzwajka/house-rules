import { expect, layer } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { WorkItemNotFound, WorkItems } from "../../index.js";
import { a, b, reader, project, access } from "./access.js";
import { stores } from "./stores.js";
for (const { name, layer: storeLayer } of stores) {
  const world = WorkItems.layer({ ...WorkItems.presets.board, maxPageSize: 2 }).pipe(
    Layer.provide(access),
    Layer.provideMerge(storeLayer),
  );
  layer(world, { excludeTestServices: true, timeout: "30 seconds" })(
    `Work item visibility on ${name}`,
    (it) => {
      it.effect("filters visibility before pagination, and protects read-only actors", () =>
        Effect.gen(function* () {
          const work = yield* WorkItems;
          const root = (yield* UnitOfWork.atomic(
            work.create(a, { title: "private", container: project("a") }),
          )).item;
          for (let i = 0; i < 5; i++) {
            yield* UnitOfWork.atomic(
              work.create(a, { title: `hidden ${i}`, container: project("a") }),
            );
            yield* UnitOfWork.atomic(
              work.create(b, { title: `b private ${i}`, container: project("b") }),
            );
          }
          expect(yield* Effect.flip(work.get(b, root.id))).toBeInstanceOf(WorkItemNotFound);
          expect(yield* Effect.flip(work.get(b, "absent"))).toBeInstanceOf(WorkItemNotFound);
          expect(
            yield* Effect.flip(UnitOfWork.atomic(work.edit(reader, root.id, { title: "denied" }))),
          ).toBeInstanceOf(WorkItemNotFound);
          expect((yield* work.get(reader, root.id)).id).toBe(root.id);
          expect(yield* Effect.flip(work.list(b, { container: project("a") }))).toBeInstanceOf(
            WorkItemNotFound,
          );
          expect(yield* Effect.flip(work.tree(b, project("a")))).toBeInstanceOf(WorkItemNotFound);
          const all = [];
          let page = yield* work.list(b, { size: 10000 });
          expect(page.items).toHaveLength(2);
          all.push(...page.items);
          while (page.next !== undefined) {
            page = yield* work.list(b, { cursor: page.next });
            all.push(...page.items);
          }
          expect(all).toHaveLength(5);
          expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
          expect(all.every((item) => item.container?.id === "b")).toBe(true);
          expect(all.some((item) => item.id === root.id)).toBe(false);
          const inbox = (yield* UnitOfWork.atomic(work.create(a, { title: "inbox" }))).item;
          expect((yield* work.list(a, { inbox: true })).items).toEqual([inbox]);
          expect((yield* work.list(a, { container: null })).items).toEqual([inbox]);
          expect(yield* Effect.flip(work.list(b, { inbox: true }))).toBeInstanceOf(
            WorkItemNotFound,
          );
          expect((yield* work.tree(a, project("a"))).length).toBe(6);
          expect(
            yield* Effect.flip(UnitOfWork.atomic(work.create(b, { title: "denied inbox" }))),
          ).toBeInstanceOf(WorkItemNotFound);
          expect(
            yield* Effect.flip(UnitOfWork.atomic(work.assign(b, root.id, null))),
          ).toBeInstanceOf(WorkItemNotFound);
          expect(yield* Effect.flip(UnitOfWork.atomic(work.claim(b, root.id)))).toBeInstanceOf(
            WorkItemNotFound,
          );
          expect(yield* Effect.flip(UnitOfWork.atomic(work.release(b, root.id)))).toBeInstanceOf(
            WorkItemNotFound,
          );
          expect(
            yield* Effect.flip(UnitOfWork.atomic(work.setStatus(b, root.id, "done"))),
          ).toBeInstanceOf(WorkItemNotFound);
        }),
      );
    },
  );
}
