import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { Forbidden, PartyId, requirePermission, Session } from "@house-rules/stack";
import { ItemsById } from "./container-work-items.view.ts";
import { WorkItemsPermissions } from "./permissions.ts";
import type { WorkItemState } from "./work-item-state.ts";
import { WorkItemCard } from "./work-item-card.view.ts";

type Held = typeof ItemsById.Type;
type Change = { readonly source: { readonly id: string }; readonly state: WorkItemState };

const put = (v: Held, _: unknown, { source, state }: Change): Held =>
  state === null ? v : { items: { ...v.items, [source.id]: state } };
const drop = (v: Held, _: unknown, { source }: Change): Held => ({
  items: Object.fromEntries(Object.entries(v.items).filter(([id]) => id !== source.id)),
});

export class HeldWorkItems extends Domain.View("HeldWorkItems", {
  from: [WorkItemCard],
  key: PartyId,
  keyOf: {
    WorkItemAssigned: {
      lost: ({ event }) => event.from ?? undefined,
      gained: ({ event }) => event.to ?? undefined,
    },
    WorkItemReleased: { lost: ({ event }) => event.holder ?? undefined },
    WorkItemCard: ({ state }) => state?.holder ?? undefined,
  },
  middleware: [Session],
  rejects: [Forbidden],
  state: ItemsById,
  initial: { items: {} },
  evolve: {
    WorkItemAssigned: { lost: drop, gained: put },
    WorkItemReleased: { lost: drop },
    WorkItemCard: put,
  },
  validate: Effect.fn(function* () {
    yield* requirePermission(WorkItemsPermissions.read);
  }),
}) {}
