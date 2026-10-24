export const RelationsPermissions = { read: "relations:read", write: "relations:write" } as const;
export type RelationsPermission = (typeof RelationsPermissions)[keyof typeof RelationsPermissions];
