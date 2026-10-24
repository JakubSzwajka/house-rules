import { type Binding, bindOperation } from "@house-rules/application";
import { Effect } from "effect";
import {
  type EmailMessage,
  type EmailRejected,
  type EmailSendFailed,
  EmailSendForbidden,
  type EmailSendResult,
} from "./message.ts";
import { EmailOperations } from "./operations.ts";

type Service = {
  readonly send: (
    message: EmailMessage,
    idempotencyKey: string,
  ) => Effect.Effect<EmailSendResult, EmailSendFailed | EmailRejected>;
};

export const bindEmail = (service: Service): readonly Binding[] => [
  bindOperation(EmailOperations.send, ({ message, idempotencyKey }, { caller }) =>
    caller.kind === "system"
      ? service.send(message, idempotencyKey)
      : Effect.fail(new EmailSendForbidden()),
  ),
];
