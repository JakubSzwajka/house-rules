export const WorkItemPermissions = {
  read: "work_items:read",
  systemRead: "work_items:system-read",
  write: "work_items:write",
} as const;
export type WorkItemPermission = (typeof WorkItemPermissions)[keyof typeof WorkItemPermissions];
