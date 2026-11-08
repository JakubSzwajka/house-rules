import { ContainerWorkItems } from "./container-work-items.view.ts";
import { HeldWorkItems } from "./held-work-items.view.ts";
import { ParentAdoption, ParentAdoptionLive } from "./parent-adoption.policy.ts";
import { WorkItem } from "./work-item.aggregate.ts";
import { WorkItemCard } from "./work-item-card.view.ts";

export { AdoptChild, ChildAdopted, TooDeep } from "./adopt-child.command.ts";
export { AssignWorkItem, WorkItemAssigned } from "./assign-work-item.command.ts";
export {
  ChangeWorkItemStatus,
  WorkItemStatusChanged,
} from "./change-work-item-status.command.ts";
export {
  ClaimWorkItem,
  WorkItemClaimed,
  WorkItemClosed,
  WorkItemHeld,
} from "./claim-work-item.command.ts";
export { ConfirmParent, ParentConfirmed } from "./confirm-parent.command.ts";
export { ContainerWorkItems, ItemsById } from "./container-work-items.view.ts";
export { CreateWorkItem, WorkItemCreated, WorkItemExists } from "./create-work-item.command.ts";
export { CurrentWorkflow } from "./current-workflow.context.ts";
export { EditWorkItem, WorkItemEdited } from "./edit-work-item.command.ts";
export { HeldWorkItems } from "./held-work-items.view.ts";
export { ParentAdoption, ParentAdoptionLive } from "./parent-adoption.policy.ts";
export { hierarchyKeeper, WorkItemsPermissions } from "./permissions.ts";
export { ParentRefused, RefusalReason, RefuseParent } from "./refuse-parent.command.ts";
export { NotHolder, ReleaseWorkItem, WorkItemReleased } from "./release-work-item.command.ts";
export { TransitionNotAllowed } from "./transition-not-allowed.rejection.ts";
export { WorkItem } from "./work-item.aggregate.ts";
export { WorkItemBody, WorkItemId, WorkItemTitle } from "./work-item.id.ts";
export { WorkItemCard } from "./work-item-card.view.ts";
export { WorkItemNotFound } from "./work-item-not-found.rejection.ts";
export { WorkItemFields, WorkItemState } from "./work-item-state.ts";
export { allows, board, Category, closedAtAfter, isClosed, Workflow } from "./workflow.ts";
export { WorkflowConfig, workflowConfig } from "./workflow-config.middleware.ts";

export const aggregates = [WorkItem] as const;
export const views = [WorkItemCard, ContainerWorkItems, HeldWorkItems] as const;
export const policies = [ParentAdoption] as const;
export const handlers = ParentAdoptionLive;
