export const ProjectPermissions = { read: "projects:read", write: "projects:write" } as const;
export type ProjectPermission = (typeof ProjectPermissions)[keyof typeof ProjectPermissions];
