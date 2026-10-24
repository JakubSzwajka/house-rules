import type { WorkItemQuery } from "../storage.js";
import type { WorkItemVisibility } from "./access.js";
import type { WorkItem, WorkItemCursor, WorkItemRef } from "./work-item.js";
export const sameRef = (a: WorkItemRef | null, b: WorkItemRef | null): boolean =>
  a === null ? b === null : b !== null && a.kind === b.kind && a.id === b.id;
export const compareItems = (a: WorkItemCursor, b: WorkItemCursor): number =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const copyItem = (item: WorkItem): WorkItem => structuredClone(item);
export const matchesItem = (
  item: WorkItem,
  visible: WorkItemVisibility,
  filters: WorkItemQuery,
): boolean =>
  (item.container === null
    ? visible.inbox
    : visible.containers.some((ref) => sameRef(ref, item.container))) &&
  (filters.container === undefined || sameRef(filters.container, item.container)) &&
  (!filters.inbox || item.container === null) &&
  (filters.state === undefined || filters.state === item.status) &&
  (filters.states === undefined || filters.states.includes(item.status)) &&
  (filters.holder === undefined || sameRef(filters.holder, item.holder)) &&
  (filters.parent === undefined || filters.parent === item.parent) &&
  (filters.cursor === undefined || compareItems(item, filters.cursor) > 0);
