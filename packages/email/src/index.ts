import type { MountDefinition } from "@house-rules/application";
import { Email } from "./facade.ts";
import { bindEmail } from "./sender/bind-email.ts";
import { EmailOperations } from "./sender/operations.ts";

export const EmailMount = {
  map: { name: "email", kind: "package", package: "@house-rules/email" },
  service: Email,
  operations: Object.values(EmailOperations),
  bind: bindEmail,
} satisfies MountDefinition<Email, Email["Service"]>;

export { Email } from "./facade.ts";
export { bindEmail } from "./sender/bind-email.ts";
export { EmailSender } from "./sender/email-sender.ts";
export type { EmailDelivery, EmailSenderOptions } from "./sender/email-sender.ts";
export {
  EmailMessage,
  EmailOperations,
  type EmailPermission,
  EmailPermissions,
  EmailRejected,
  EmailSendFailed,
  EmailCallerDenied,
  EmailSendResult,
} from "./contract.ts";
export { console as consoleEmail } from "./adapters/console.ts";
export { memory as memoryEmail, MemoryEmailOutboxTesting } from "./adapters/memory.ts";
