import { UnitOfWork } from "@house-rules/domain";
import { Effect } from "effect";
import type { WorkItemStore } from "../storage.js";
import { sameRef } from "./order.js";
import { WorkItemInputInvalid, type WorkItemRef } from "./work-item.js";

export const lockHierarchy = Effect.fn("WorkItems.lockHierarchy")(function* (
  store: WorkItemStore["Service"],
  ids: ReadonlyArray<string>,
  containers: ReadonlyArray<WorkItemRef | null>,
) {
  yield* UnitOfWork.required;
  // Discover without row locks so opposing moves cannot deadlock before container locking.
  const before = yield* store.getMany(ids);
  yield* store.lockContainers([...containers, ...before.map((item) => item.container)]);
  const current = yield* store.getMany(ids);
  // An anchor may have moved while we waited. Do not acquire extra locks out of order.
  if (
    current.some(
      (item) => !before.some((old) => old.id === item.id && sameRef(old.container, item.container)),
    )
  )
    return yield* new WorkItemInputInvalid({
      message: "Work item hierarchy changed. Retry the operation.",
    });
  return current;
});
