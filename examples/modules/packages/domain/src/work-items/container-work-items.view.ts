import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Forbidden, requirePermission, Session } from "@house-rules/stack";
import { WorkItemsPermissions } from "./permissions.ts";
import { WorkItemFields } from "./work-item-state.ts";
import { WorkItemCard } from "./work-item-card.view.ts";

export const ItemsById = Schema.Struct({
  items: Schema.Record(Schema.String, WorkItemFields),
});

export class ContainerWorkItems extends Domain.View("ContainerWorkItems", {
  from: [WorkItemCard],
  key: Schema.String,
  keyOf: { WorkItemCard: ({ state }) => state?.container ?? undefined },
  middleware: [Session],
  rejects: [Forbidden],
  state: ItemsById,
  initial: { items: {} },
  evolve: {
    WorkItemCard: (v, _, { source, state }) =>
      state === null ? v : { items: { ...v.items, [source.id]: state } },
  },
  validate: Effect.fn(function* () {
    yield* requirePermission(WorkItemsPermissions.read);
  }),
}) {}
