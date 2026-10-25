import { Effect } from "effect";
import type { WorkItemStore } from "../storage.js";
import { WorkItemNotFound } from "./work-item.js";

export const readStoredWorkItem = Effect.fn("WorkItems.readStoredWorkItem")(function* (
  store: WorkItemStore["Service"],
  id: string,
) {
  const item = yield* store.get(id);
  if (item === null) return yield* new WorkItemNotFound();
  return item;
});
