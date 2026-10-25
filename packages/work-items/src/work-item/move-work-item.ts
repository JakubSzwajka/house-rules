import type { Actor, NoOpenUnit } from "@house-rules/domain";
import { DateTime, Effect, Schema } from "effect";
import type { WorkItemStore } from "../storage.js";
import type { WorkItemMutation } from "./events.js";
import { checkHierarchy } from "./hierarchy.js";
import { lockHierarchy } from "./hierarchy-lock.js";
import { sameRef } from "./order.js";
import type { WorkItemsOptions } from "./options.js";
import {
  type WorkItem,
  type WorkItemFailure,
  WorkItemInputInvalid,
  WorkItemMove,
  type WorkItemRef,
} from "./work-item.js";

export const moveWorkItem = (
  store: WorkItemStore["Service"],
  options: WorkItemsOptions,
  writable: (actor: Actor, id: string) => Effect.Effect<WorkItem, WorkItemFailure | NoOpenUnit>,
  requireAccess: (
    actor: Actor,
    container: WorkItemRef | null,
    write: boolean,
  ) => Effect.Effect<void, WorkItemFailure>,
) =>
  Effect.fn("WorkItems.move")(function* (actor: Actor, id: string, to: WorkItemMove) {
    const target = yield* Schema.decodeEffect(WorkItemMove)(to).pipe(
      Effect.mapError(() => new WorkItemInputInvalid({ message: "Invalid work item input." })),
    );
    yield* lockHierarchy(
      store,
      "parent" in target ? [id, target.parent] : [id],
      "container" in target ? [target.container] : [],
    );
    const before = yield* writable(actor, id);
    let container: WorkItemRef | null;
    let parent: string | null;
    if ("parent" in target) {
      const destination = yield* writable(actor, target.parent);
      container = destination.container;
      parent = destination.id;
    } else {
      container = target.container;
      parent = null;
    }
    yield* requireAccess(actor, container, true);
    const all = yield* store.inContainers([before.container, container]);
    const subtree = new Set([id]);
    let size = 0;
    while (size !== subtree.size) {
      size = subtree.size;
      for (const item of all)
        if (item.parent !== null && subtree.has(item.parent)) subtree.add(item.id);
    }
    const locked: WorkItem[] = [];
    // Read each row after locking it so concurrent content/holder edits are preserved.
    for (const row of all
      .filter((item) => subtree.has(item.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const current = yield* store.lock(row.id);
      if (current !== null) locked.push(current);
    }
    const updatedAt = yield* DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));
    const moved = locked.map((current) => ({
      ...current,
      container,
      parent: current.id === id ? parent : current.parent,
      updatedAt,
    }));
    const resulting = all.map((item) => moved.find((row) => row.id === item.id) ?? item);
    yield* checkHierarchy(moved, resulting, options, !sameRef(before.container, container));
    for (const item of moved) yield* store.save(item);
    const item = { ...before, container, parent, updatedAt };
    return {
      item,
      events: [
        {
          kind: "work_items.moved",
          subject: { kind: "work_item", id },
          from: { parent: before.parent, container: before.container },
          to: { parent, container },
        },
      ],
    } satisfies WorkItemMutation;
  });
