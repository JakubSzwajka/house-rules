import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { WorkItemStore } from "../../storage.js";
import { compareItems, copyItem, matchesItem, sameRef } from "../../work-item/order.js";
import { type WorkItem, WorkItemStoreUnavailable } from "../../work-item/work-item.js";
export const memoryWorkItemStore = (): Layer.Layer<WorkItemStore> =>
  Layer.sync(WorkItemStore, () => {
    const rows = new Map<string, WorkItem>();
    const change = Effect.fn("WorkItemStore.memory.change")(function* (run: () => void) {
      yield* UnitOfWork.required;
      const before = new Map([...rows].map(([id, item]) => [id, copyItem(item)]));
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          rows.clear();
          for (const [id, item] of before) rows.set(id, item);
        }),
      );
      run();
    });
    const get = (id: string) =>
      Effect.sync(() => {
        const item = rows.get(id);
        return item === undefined ? null : copyItem(item);
      });
    return WorkItemStore.of({
      get,
      lock: (id) => UnitOfWork.required.pipe(Effect.andThen(get(id))),
      list: (visible, filters) =>
        Effect.sync(() =>
          [...rows.values()]
            .filter((item) => matchesItem(item, visible, filters))
            .sort(compareItems)
            .slice(0, filters.size)
            .map(copyItem),
        ),
      insert: Effect.fn("WorkItemStore.memory.insert")(function* (item) {
        yield* UnitOfWork.required;
        if (rows.has(item.id))
          return yield* new WorkItemStoreUnavailable({ cause: "Duplicate work item id." });
        yield* change(() => void rows.set(item.id, copyItem(item)));
      }),
      save: (item) => change(() => void rows.set(item.id, copyItem(item))),
      claim: Effect.fn("WorkItemStore.memory.claim")(function* (item) {
        yield* UnitOfWork.required;
        const before = rows.get(item.id);
        if (
          before === undefined ||
          (before.holder !== null && !sameRef(before.holder, item.holder))
        )
          return false;
        yield* change(() => void rows.set(item.id, copyItem(item)));
        return true;
      }),
      removeContainer: (ref) =>
        change(() => {
          for (const [id, item] of rows) if (sameRef(item.container, ref)) rows.delete(id);
        }),
      releaseHolder: (ref, updatedAt) =>
        change(() => {
          for (const [id, item] of rows)
            if (sameRef(item.holder, ref)) rows.set(id, { ...item, holder: null, updatedAt });
        }),
    });
  });
