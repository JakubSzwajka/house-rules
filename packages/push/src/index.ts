import type { MountDefinition } from "@house-rules/application";
import { Push } from "./facade.js";
import { PushOperations } from "./contract.js";
import { bindPush } from "./push/bind-push.js";
export const PushMount = {
  map: { name: "push", kind: "package", package: "@house-rules/push" },
  service: Push,
  operations: Object.values(PushOperations),
  bind: bindPush,
} satisfies MountDefinition<Push, Push["Service"]>;
export { Push, type PushOptions } from "./facade.js";
export { PushStore } from "./storage.js";
export { PushSender } from "./push/sender.js";
export { memoryPushStore } from "./adapters/memory/push.js";
export { memoryPushSender } from "./adapters/memory/sender.js";
export { MemoryPushOutbox } from "./adapters/memory/outbox.js";
export { consolePushSender } from "./adapters/console/sender.js";
export { bindPush } from "./push/bind-push.js";
export {
  PushOperations,
  PushOwner,
  PushSubscription,
  PushPayload,
  PushInputInvalid,
  PushCallerDenied,
  PushSubscriptionNotFound,
  PushSubscriptionConflict,
  PushStoreUnavailable,
  PushSendFailed,
  Subscribed,
  Unsubscribed,
  SubscriptionExpired,
  PushEvents,
  PushPermissions,
} from "./contract.js";
