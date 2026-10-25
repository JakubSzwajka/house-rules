import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import {
  EmailMessage,
  EmailRejected,
  EmailSendFailed,
  EmailCallerDenied,
  EmailSendResult,
} from "./message.ts";
import { EmailPermissions } from "./permissions.ts";

const send = defineOperation("Email.send", {
  description: "Send an email as the system with a delivery idempotency key.",
  input: Schema.Struct({ message: EmailMessage, idempotencyKey: Schema.String }),
  output: EmailSendResult,
  failure: Schema.Union([EmailSendFailed, EmailRejected, EmailCallerDenied]),
  permission: EmailPermissions.send,
  edges: [],
  transactional: false,
});

export const EmailOperations = { send } as const;
