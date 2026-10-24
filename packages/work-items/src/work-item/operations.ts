import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { WorkItemImportResult, WorkItemMutation } from "./events.js";
import { WorkItemPermissions } from "./permissions.js";
import {
  WorkItem,
  WorkItemCreate,
  WorkItemEdit,
  WorkItemFailure,
  WorkItemFilters,
  WorkItemList,
  WorkItemMove,
  WorkItemIdTaken,
  WorkItemsCallerDenied,
  WorkItemsChanged,
  WorkItemRef,
  WorkItemTree,
} from "./work-item.js";
const write = {
  failure: WorkItemFailure,
  permission: WorkItemPermissions.write,
  output: WorkItemMutation,
  transactional: true,
  edges: [],
} as const;
const read = {
  failure: WorkItemFailure,
  permission: WorkItemPermissions.read,
  readOnly: true,
  edges: [],
} as const;
const key = Schema.Struct({ id: Schema.NonEmptyString });
const create = defineOperation("WorkItems.create", {
  ...write,
  failure: Schema.Union([WorkItemFailure, WorkItemsChanged]),
  description: "Create a work item, inheriting its parent's container.",
  input: WorkItemCreate,
});
const move = defineOperation("WorkItems.move", {
  ...write,
  failure: Schema.Union([WorkItemFailure, WorkItemsChanged]),
  description: "Move a subtree to a parent or top-level container.",
  input: Schema.Struct({ id: Schema.NonEmptyString, to: WorkItemMove }),
});
const importItems = defineOperation("WorkItems.import", {
  ...write,
  permission: WorkItemPermissions.import,
  failure: Schema.Union([
    WorkItemFailure,
    WorkItemsCallerDenied,
    WorkItemIdTaken,
    WorkItemsChanged,
  ]),
  description: "Import work items with their given ids as the system.",
  input: Schema.Struct({ items: Schema.Array(WorkItem) }),
  output: WorkItemImportResult,
});
const edit = defineOperation("WorkItems.edit", {
  ...write,
  description: "Replace work item title, body or attributes.",
  destructive: true,
  input: Schema.Struct({ id: Schema.NonEmptyString, patch: WorkItemEdit }),
});
const setStatus = defineOperation("WorkItems.setStatus", {
  ...write,
  description: "Move a work item through its configured workflow.",
  input: Schema.Struct({ id: Schema.NonEmptyString, status: Schema.NonEmptyString }),
});
const assign = defineOperation("WorkItems.assign", {
  ...write,
  description: "Set or clear a holder without changing status.",
  input: Schema.Struct({ id: Schema.NonEmptyString, holder: Schema.NullOr(WorkItemRef) }),
});
const claim = defineOperation("WorkItems.claim", {
  ...write,
  description: "Claim an open item that is unheld or already held by the caller.",
  input: key,
});
const release = defineOperation("WorkItems.release", {
  ...write,
  description: "Clear the holder and apply the configured release transition.",
  input: key,
});
const get = defineOperation("WorkItems.get", {
  ...read,
  description: "Read one visible work item.",
  input: key,
  output: WorkItem,
});
const getForSystem = defineOperation("WorkItems.getForSystem", {
  ...read,
  permission: WorkItemPermissions.systemRead,
  failure: Schema.Union([WorkItemFailure, WorkItemsCallerDenied]),
  description: "Read one work item as the system without person access checks.",
  input: key,
  output: WorkItem,
});
const list = defineOperation("WorkItems.list", {
  ...read,
  description: "List visible work items with filters and an exclusive cursor.",
  input: WorkItemFilters,
  output: WorkItemList,
});
const tree = defineOperation("WorkItems.tree", {
  ...read,
  description: "Read a container's work item hierarchy.",
  input: Schema.Struct({ container: Schema.NullOr(WorkItemRef) }),
  output: Schema.Array(WorkItemTree),
});
export const WorkItemsOperations = {
  create,
  move,
  import: importItems,
  edit,
  setStatus,
  assign,
  claim,
  release,
  get,
  getForSystem,
  list,
  tree,
} as const;
