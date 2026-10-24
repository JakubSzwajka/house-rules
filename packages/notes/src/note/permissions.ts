export const NotePermissions = { read: "notes:read", write: "notes:write" } as const;
export type NotePermission = (typeof NotePermissions)[keyof typeof NotePermissions];
