import { Effect } from "effect";
import type { WorkItemStore } from "../storage.js";
import type { WorkItemsOptions } from "./options.js";
import { sameRef } from "./order.js";
import {
  DepthExceeded,
  type WorkItem,
  WorkItemInputInvalid,
  WorkItemNotFound,
  WorkItemTreeTooLarge,
} from "./work-item.js";

export const checkParentDepth = Effect.fn("WorkItems.checkParentDepth")(function* (
  store: WorkItemStore["Service"],
  parent: WorkItem,
  maxDepth: number,
) {
  let ancestor: WorkItem | null = parent;
  let depth = 1;
  while (ancestor.parent !== null) {
    if (depth > maxDepth) return yield* new DepthExceeded();
    ancestor = yield* store.get(ancestor.parent);
    if (ancestor === null) return yield* new WorkItemNotFound();
    depth++;
  }
  if (depth > maxDepth) return yield* new DepthExceeded();
});

export const checkHierarchy = Effect.fn("WorkItems.checkHierarchy")(function* (
  changed: ReadonlyArray<WorkItem>,
  all: ReadonlyArray<WorkItem>,
  options: WorkItemsOptions,
  checkSize = true,
) {
  const byId = new Map(all.map((item) => [item.id, item]));
  for (const item of changed) {
    const seen = new Set([item.id]);
    let ancestor = item;
    let depth = 0;
    while (ancestor.parent !== null) {
      if (seen.has(ancestor.parent))
        return yield* new WorkItemInputInvalid({
          message: "Work item hierarchy cannot contain a cycle.",
        });
      seen.add(ancestor.parent);
      const parent = byId.get(ancestor.parent);
      if (parent === undefined) return yield* new WorkItemNotFound();
      if (!sameRef(parent.container, item.container))
        return yield* new WorkItemInputInvalid({
          message: "A child must share its parent's container.",
        });
      ancestor = parent;
      depth++;
    }
    if (depth > options.maxDepth) return yield* new DepthExceeded();
    if (
      checkSize &&
      all.filter((row) => sameRef(row.container, item.container)).length > options.maxTreeSize
    )
      return yield* new WorkItemTreeTooLarge();
  }
});
