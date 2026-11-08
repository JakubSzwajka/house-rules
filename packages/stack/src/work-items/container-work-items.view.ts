import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { requirePermission } from "../access/require-permission.ts";
import { Session } from "../auth/session.middleware.ts";
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
