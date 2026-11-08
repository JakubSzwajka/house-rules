import { system } from "../actor/actor.ts";

export const WorkItemsPermissions = {
  read: "work_items:read",
  write: "work_items:write",
  assign: "work_items:assign",
  link: "work_items:link",
} as const;

export const hierarchyKeeper = system("work-items", [WorkItemsPermissions.link]);
