import type { WorkItem, WorkItemTree } from "./work-item.js";

export const workItemTree = (
  items: ReadonlyArray<WorkItem>,
  maxDepth: number,
): ReadonlyArray<WorkItemTree> => {
  const children = new Map<string | null, WorkItem[]>();
  for (const item of items) {
    const group = children.get(item.parent) ?? [];
    group.push(item);
    children.set(item.parent, group);
  }
  const branch = (parent: string | null, depth: number): ReadonlyArray<WorkItemTree> =>
    (children.get(parent) ?? []).map((item) => ({
      item,
      children: depth >= maxDepth ? [] : branch(item.id, depth + 1),
    }));
  return branch(null, 0);
};
