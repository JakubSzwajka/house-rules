export const EventLogPermissions = {
  record: "event-log:record",
  read: "event-log:read",
  deliver: "event-log:deliver",
  deadLetters: "event-log:dead-letters",
  replay: "event-log:replay",
} as const;
export type EventLogPermission = (typeof EventLogPermissions)[keyof typeof EventLogPermissions];
