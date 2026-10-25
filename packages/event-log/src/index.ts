import type { MountDefinition } from "@house-rules/application";
import { EventLog } from "./facade.js";
import { EventLogOperations } from "./event/operations.js";
import { bindEventLog } from "./event/bind-event-log.js";
export const EventLogMount = {
  map: { name: "event-log", kind: "package", package: "@house-rules/event-log" },
  service: EventLog,
  operations: Object.values(EventLogOperations),
  bind: bindEventLog,
} satisfies MountDefinition<EventLog, EventLog["Service"]>;
export { EventLog } from "./facade.js";
export { bindEventLog } from "./event/bind-event-log.js";
export { EventStore } from "./storage.js";
export { memoryEventStore } from "./adapters/memory/event.js";
export { postgresEventStore } from "./adapters/postgres/event.js";
export {
  EventId,
  EventFact,
  StoredEvent,
  EventQuery,
  EventInputInvalid,
  EventStoreUnavailable,
  DeadLetterNotFound,
  DeliveryToken,
  ReplayResult,
  Delivery,
  DeadLetter,
  DeadLetterQuery,
  DeadLetterCursor,
  ConsumerOptions,
  EventLogOperations,
  EventLogPermissions,
  type EventLogPermission,
  type EventLogOptions,
} from "./contract.js";
