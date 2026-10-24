import { UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import type { WorkItemStore } from "../storage.js";
import type { WorkItemEvent } from "./events.js";
import { checkHierarchy } from "./hierarchy.js";
import { lockHierarchy } from "./hierarchy-lock.js";
import type { WorkItemsOptions } from "./options.js";
import { WorkItem, WorkItemIdTaken, WorkItemInputInvalid } from "./work-item.js";

export const importWorkItems = (store: WorkItemStore["Service"], options: WorkItemsOptions) =>
  Effect.fn("WorkItems.import")(function* (input: ReadonlyArray<WorkItem>) {
    yield* UnitOfWork.required;
    const invalid = () => new WorkItemInputInvalid({ message: "Invalid work item import." });
    const items = yield* Schema.decodeEffect(Schema.Array(WorkItem))(input).pipe(
      Effect.mapError(invalid),
    );
    const parents = items.flatMap((item) => (item.parent === null ? [] : [item.parent]));
    yield* lockHierarchy(
      store,
      parents,
      items.map((item) => item.container),
    );
    const existing = yield* store.inContainers(items.map((item) => item.container));
    const linked = yield* store.getMany(parents);
    const taken = yield* store.getMany(items.map((item) => item.id));
    const ids = new Set(taken.map((item) => item.id));
    let largest = 0n;
    for (const item of items) {
      if (ids.has(item.id)) return yield* new WorkItemIdTaken({ id: item.id });
      ids.add(item.id);
      const state = options.states.find((state) => state.name === item.status);
      const closed = state?.category === "done" || state?.category === "cancelled";
      if (
        item.createdAt > item.updatedAt ||
        (item.closedAt !== null) !== closed ||
        item.title.length > options.maxTitleLength ||
        item.body.length > options.maxBodyLength ||
        state === undefined ||
        (item.container !== null && !options.containerKinds.includes(item.container.kind)) ||
        (item.holder !== null && !options.holderKinds.includes(item.holder.kind))
      )
        return yield* invalid();
      if (/^\d+$/.test(item.id)) {
        const numeric = BigInt(item.id);
        if (numeric >= 9223372036854775807n) {
          if (options.idStrategy === "sequence") return yield* invalid();
        } else if (numeric > largest) largest = numeric;
      }
    }
    const all = [
      ...new Map([...existing, ...linked, ...items].map((item) => [item.id, item])).values(),
    ];
    yield* checkHierarchy(items, all, options);
    if (largest > 0n) yield* store.advanceSequence(largest.toString());
    // Unique-index waits also follow id order for concurrent imports into different containers.
    for (const item of [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
      if (!(yield* store.insert(item))) return yield* new WorkItemIdTaken({ id: item.id });
    return {
      items,
      events: items.map(
        (item): WorkItemEvent => ({
          kind: "work_items.created",
          subject: { kind: "work_item", id: item.id },
          item,
        }),
      ),
    };
  });
