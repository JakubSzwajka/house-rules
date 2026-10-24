import type { MountDefinition } from "@house-rules/application";
import { WorkItems } from "./facade.js";
import { WorkItemsOperations } from "./contract.js";
import { bindWorkItems } from "./work-item/bind-work-items.js";
export const WorkItemsMount = {
  map: { name: "work-items", kind: "package", package: "@house-rules/work-items" },
  service: WorkItems,
  operations: Object.values(WorkItemsOperations),
  bind: bindWorkItems,
} satisfies MountDefinition<WorkItems, WorkItems["Service"]>;
export { WorkItems } from "./facade.js";
export { bindWorkItems } from "./work-item/bind-work-items.js";
export { WorkItemAccess, type WorkItemVisibility } from "./work-item/access.js";
export { WorkItemStore, type WorkItemQuery } from "./storage.js";
export { memoryWorkItemStore } from "./adapters/memory/work-item.js";
export { postgresWorkItemStore } from "./adapters/postgres/work-item.js";
export {
  WorkItem,
  WorkItemCategory,
  WorkItemCreate,
  WorkItemCursor,
  WorkItemEdit,
  WorkItemFailure,
  WorkItemFilters,
  WorkItemList,
  WorkItemRef,
  WorkItemTree,
  WorkItemTreeTooLarge,
  WorkItemNotFound,
  WorkItemInputInvalid,
  DepthExceeded,
  TransitionNotAllowed,
  WorkItemHeld,
  WorkItemClosed,
  WorkItemStoreUnavailable,
  WorkItemAccessUnavailable,
  WorkItemEvent,
  WorkItemEvents,
  WorkItemMutation,
  WorkItemPermissions,
  type WorkItemPermission,
  WorkItemsOperations,
  WorkItemsOptions,
} from "./contract.js";
