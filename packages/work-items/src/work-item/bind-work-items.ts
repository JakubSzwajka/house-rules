import { type Binding, bindOperation } from "@house-rules/application";
import { Effect } from "effect";
import type { makeWorkItems } from "./work-items.js";
import { WorkItemsOperations as operations } from "./operations.js";
import { WorkItemNotFound, WorkItemsCallerDenied } from "./work-item.js";
export const bindWorkItems = (service: ReturnType<typeof makeWorkItems>): readonly Binding[] => [
  bindOperation(operations.create, (input, { caller }) =>
    caller.kind === "person"
      ? service.create(caller.actor, input)
      : Effect.fail(new WorkItemNotFound()),
  ),
  bindOperation(operations.move, ({ id, to }, { caller }) =>
    caller.kind === "person"
      ? service.move(caller.actor, id, to)
      : Effect.fail(new WorkItemNotFound()),
  ),
  bindOperation(operations.import, ({ items }, { caller }) =>
    caller.kind === "system" ? service.import(items) : Effect.fail(new WorkItemsCallerDenied()),
  ),
  bindOperation(operations.edit, ({ id, patch }, { caller }) =>
    caller.kind === "person"
      ? service.edit(caller.actor, id, patch)
      : Effect.fail(new WorkItemNotFound()),
  ),
  bindOperation(operations.setStatus, ({ id, status }, { caller }) =>
    caller.kind === "person"
      ? service.setStatus(caller.actor, id, status)
      : Effect.fail(new WorkItemNotFound()),
  ),
  bindOperation(operations.assign, ({ id, holder }, { caller }) =>
    caller.kind === "person"
      ? service.assign(caller.actor, id, holder)
      : Effect.fail(new WorkItemNotFound()),
  ),
  bindOperation(operations.claim, ({ id }, { caller }) =>
    caller.kind === "person"
      ? service.claim(caller.actor, id)
      : Effect.fail(new WorkItemNotFound()),
  ),
  bindOperation(operations.release, ({ id }, { caller }) =>
    caller.kind === "person"
      ? service.release(caller.actor, id)
      : Effect.fail(new WorkItemNotFound()),
  ),
  bindOperation(operations.get, ({ id }, { caller }) =>
    caller.kind === "person" ? service.get(caller.actor, id) : Effect.fail(new WorkItemNotFound()),
  ),
  bindOperation(operations.getForSystem, ({ id }, { caller }) =>
    caller.kind === "system" ? service.getForSystem(id) : Effect.fail(new WorkItemsCallerDenied()),
  ),
  bindOperation(operations.list, (input, { caller }) =>
    caller.kind === "person"
      ? service.list(caller.actor, input)
      : Effect.fail(new WorkItemNotFound()),
  ),
  bindOperation(operations.tree, ({ container }, { caller }) =>
    caller.kind === "person"
      ? service.tree(caller.actor, container)
      : Effect.fail(new WorkItemNotFound()),
  ),
];
