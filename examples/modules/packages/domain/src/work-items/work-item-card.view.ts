import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { Forbidden, requirePermission, Session } from "@house-rules/stack";
import { WorkItemsPermissions } from "./permissions.ts";
import { WorkItem } from "./work-item.aggregate.ts";
import { foldWorkItem, WorkItemState } from "./work-item-state.ts";

export class WorkItemCard extends Domain.View("WorkItemCard", {
  from: [WorkItem],
  key: WorkItem,
  middleware: [Session],
  rejects: [Forbidden],
  state: WorkItemState,
  initial: null,
  evolve: foldWorkItem,
  validate: Effect.fn(function* () {
    yield* requirePermission(WorkItemsPermissions.read);
  }),
}) {}
