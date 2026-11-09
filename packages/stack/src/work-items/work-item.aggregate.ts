import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { authorOf, partyOf } from "../actor/actor.ts";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { can } from "../access/permission.ts";
import { requirePermission } from "../access/require-permission.ts";
import { AdoptChild, WorkItemChildAdopted, TooDeep } from "./adopt-child.command.ts";
import { AssignWorkItem, WorkItemAssigned } from "./assign-work-item.command.ts";
import { ChangeWorkItemStatus, WorkItemStatusChanged } from "./change-work-item-status.command.ts";
import {
  ClaimWorkItem,
  WorkItemClaimed,
  WorkItemClosed,
  WorkItemHeld,
} from "./claim-work-item.command.ts";
import { ConfirmParent, WorkItemParentConfirmed } from "./confirm-parent.command.ts";
import { CreateWorkItem, WorkItemCreated, WorkItemExists } from "./create-work-item.command.ts";
import { CurrentWorkflow } from "./current-workflow.context.ts";
import { EditWorkItem, WorkItemEdited } from "./edit-work-item.command.ts";
import { WorkItemsPermissions } from "./permissions.ts";
import { WorkItemParentRefused, RefuseParent } from "./refuse-parent.command.ts";
import { NotHolder, ReleaseWorkItem, WorkItemReleased } from "./release-work-item.command.ts";
import { TransitionNotAllowed } from "./transition-not-allowed.rejection.ts";
import { WorkItemId } from "./work-item.id.ts";
import { foldWorkItem, type WorkItemFields, WorkItemState } from "./work-item-state.ts";
import { WorkItemNotFound } from "./work-item-not-found.rejection.ts";
import { allows, closedAtAfter, isClosed, type Workflow } from "./workflow.ts";

const move = (w: Workflow, item: WorkItemFields, to: string, now: DateTime.Utc) =>
  allows(w, item.status, to)
    ? Effect.succeed({
        from: item.status,
        to,
        closedAt: closedAtAfter(w, item.status, to, item.closedAt, DateTime.toEpochMillis(now)),
      })
    : Effect.fail(new TransitionNotAllowed({ from: item.status, to }));

export class WorkItem extends Domain.Aggregate("WorkItem", {
  id: WorkItemId,
  state: WorkItemState,
  initial: null,
  commands: [
    CreateWorkItem,
    EditWorkItem,
    ChangeWorkItemStatus,
    AssignWorkItem,
    ClaimWorkItem,
    ReleaseWorkItem,
    AdoptChild,
    ConfirmParent,
    RefuseParent,
  ],
  decide: {
    CreateWorkItem: Effect.fn(function* (s, cmd, { now }) {
      const actor = yield* requirePermission(WorkItemsPermissions.write);
      if (s !== null) return yield* new WorkItemExists();
      const w = yield* CurrentWorkflow;
      const parent = cmd.parent ?? null;
      return [
        new WorkItemCreated({
          title: cmd.title,
          body: cmd.body ?? "",
          status: w.initial,
          closedAt: isClosed(w, w.initial) ? DateTime.toEpochMillis(now) : null,
          container: parent === null ? (cmd.container ?? null) : null,
          parent,
          by: authorOf(actor),
        }),
      ];
    }),
    EditWorkItem: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(WorkItemsPermissions.write);
      if (s === null) return yield* new WorkItemNotFound();
      const title = cmd.title ?? s.title;
      const body = cmd.body ?? s.body;
      if (title === s.title && body === s.body) return [];
      return [new WorkItemEdited({ title, body, by: authorOf(actor) })];
    }),
    ChangeWorkItemStatus: Effect.fn(function* (s, cmd, { now }) {
      const actor = yield* requirePermission(WorkItemsPermissions.write);
      if (s === null) return yield* new WorkItemNotFound();
      if (s.status === cmd.status) return [];
      const moved = yield* move(yield* CurrentWorkflow, s, cmd.status, now);
      return [new WorkItemStatusChanged({ ...moved, by: authorOf(actor) })];
    }),
    AssignWorkItem: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(WorkItemsPermissions.assign);
      if (s === null) return yield* new WorkItemNotFound();
      if (s.holder === cmd.holder) return [];
      return [new WorkItemAssigned({ from: s.holder, to: cmd.holder, by: authorOf(actor) })];
    }),
    ClaimWorkItem: Effect.fn(function* (s, _cmd, { now }) {
      const actor = yield* requirePermission(WorkItemsPermissions.write);
      if (actor._tag === "System")
        return yield* new Forbidden({ permission: WorkItemsPermissions.write });
      if (s === null) return yield* new WorkItemNotFound();
      const w = yield* CurrentWorkflow;
      if (isClosed(w, s.status)) return yield* new WorkItemClosed({ status: s.status });
      if (s.holder !== null && s.holder !== actor.id)
        return yield* new WorkItemHeld({ holder: s.holder });
      if (s.holder === actor.id && s.status === w.claim) return [];
      const moved =
        s.status === w.claim ? { from: s.status, to: s.status } : yield* move(w, s, w.claim, now);
      return [
        new WorkItemClaimed({
          holder: actor.id,
          from: moved.from,
          to: moved.to,
          by: authorOf(actor),
        }),
      ];
    }),
    ReleaseWorkItem: Effect.fn(function* (s, _cmd, { now }) {
      const actor = yield* requirePermission(WorkItemsPermissions.write);
      if (s === null) return yield* new WorkItemNotFound();
      const self = partyOf(actor);
      if (s.holder !== null && s.holder !== self && !can(actor, WorkItemsPermissions.assign))
        return yield* new NotHolder({ holder: s.holder });
      const w = yield* CurrentWorkflow;
      if (s.holder === null && s.status !== w.release.from) return [];
      const moved =
        s.status === w.release.from
          ? yield* move(w, s, w.release.to, now)
          : { from: s.status, to: s.status, closedAt: s.closedAt };
      return [new WorkItemReleased({ holder: s.holder, ...moved, by: authorOf(actor) })];
    }),
    AdoptChild: Effect.fn(function* (s, cmd) {
      yield* requirePermission(WorkItemsPermissions.link);
      if (s === null) return yield* new WorkItemNotFound();
      if (s.parent !== null) return yield* new TooDeep();
      if (s.children.includes(cmd.child)) return [];
      return [new WorkItemChildAdopted({ child: cmd.child, container: s.container })];
    }),
    ConfirmParent: Effect.fn(function* (s, cmd) {
      yield* requirePermission(WorkItemsPermissions.link);
      if (s?.parent?.id !== cmd.parent || s.parent.confirmed) return [];
      return [new WorkItemParentConfirmed({ parent: cmd.parent, container: cmd.container })];
    }),
    RefuseParent: Effect.fn(function* (s, cmd) {
      yield* requirePermission(WorkItemsPermissions.link);
      if (s?.parent?.id !== cmd.parent || s.parent.confirmed) return [];
      return [new WorkItemParentRefused({ parent: cmd.parent, reason: cmd.reason })];
    }),
  },
  evolve: foldWorkItem,
}) {}
