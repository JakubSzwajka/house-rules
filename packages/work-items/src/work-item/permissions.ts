export const WorkItemPermissions = { read: "work_items:read", write: "work_items:write" } as const;
export type WorkItemPermission = (typeof WorkItemPermissions)[keyof typeof WorkItemPermissions];
