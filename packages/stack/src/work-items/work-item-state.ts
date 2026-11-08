import * as Schema from "effect/Schema";
import { PersonId } from "../actor/actor.ts";
import type { WorkItemChildAdopted } from "./adopt-child.command.ts";
import type { WorkItemAssigned } from "./assign-work-item.command.ts";
import type { WorkItemStatusChanged } from "./change-work-item-status.command.ts";
import type { WorkItemClaimed } from "./claim-work-item.command.ts";
import type { WorkItemParentConfirmed } from "./confirm-parent.command.ts";
import type { WorkItemCreated } from "./create-work-item.command.ts";
import type { WorkItemEdited } from "./edit-work-item.command.ts";
import type { WorkItemParentRefused } from "./refuse-parent.command.ts";
import type { WorkItemReleased } from "./release-work-item.command.ts";
import { WorkItemId } from "./work-item.id.ts";

export const WorkItemFields = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  status: Schema.String,
  closedAt: Schema.NullOr(Schema.Int),
  holder: Schema.NullOr(PersonId),
  container: Schema.NullOr(Schema.String),
  parent: Schema.NullOr(Schema.Struct({ id: WorkItemId, confirmed: Schema.Boolean })),
  children: Schema.Array(WorkItemId),
});
export type WorkItemFields = typeof WorkItemFields.Type;

export const WorkItemState = Schema.NullOr(WorkItemFields);
export type WorkItemState = typeof WorkItemState.Type;

const live =
  <E>(f: (item: WorkItemFields, e: E) => WorkItemFields) =>
  (s: WorkItemState, e: E): WorkItemState =>
    s === null ? s : f(s, e);

export const foldWorkItem = {
  WorkItemCreated: (_: WorkItemState, e: WorkItemCreated): WorkItemState => ({
    title: e.title,
    body: e.body,
    status: e.status,
    closedAt: e.closedAt,
    holder: null,
    container: e.container,
    parent: e.parent === null ? null : { id: e.parent, confirmed: false },
    children: [],
  }),
  WorkItemEdited: live((i, e: WorkItemEdited) => ({ ...i, title: e.title, body: e.body })),
  WorkItemStatusChanged: live((i, e: WorkItemStatusChanged) => ({
    ...i,
    status: e.to,
    closedAt: e.closedAt,
  })),
  WorkItemAssigned: live((i, e: WorkItemAssigned) => ({ ...i, holder: e.to })),
  WorkItemClaimed: live((i, e: WorkItemClaimed) => ({ ...i, holder: e.holder, status: e.to })),
  WorkItemReleased: live((i, e: WorkItemReleased) => ({
    ...i,
    holder: null,
    status: e.to,
    closedAt: e.closedAt,
  })),
  WorkItemChildAdopted: live((i, e: WorkItemChildAdopted) => ({
    ...i,
    children: [...i.children, e.child],
  })),
  WorkItemParentConfirmed: live((i, e: WorkItemParentConfirmed) => ({
    ...i,
    container: e.container,
    parent: { id: e.parent, confirmed: true },
  })),
  WorkItemParentRefused: live((i, _: WorkItemParentRefused) => ({ ...i, parent: null })),
};
