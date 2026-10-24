export const EmailPermissions = { send: "email:send" } as const;
export type EmailPermission = (typeof EmailPermissions)[keyof typeof EmailPermissions];
