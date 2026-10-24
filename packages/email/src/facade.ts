import { defineModule } from "@house-rules/domain";
import { Effect } from "effect";
import { EmailSender } from "./sender/email-sender.ts";
import type {
  EmailMessage,
  EmailRejected,
  EmailSendFailed,
  EmailSendResult,
} from "./sender/message.ts";

export class Email extends defineModule<
  Email,
  {
    readonly send: (
      message: EmailMessage,
      idempotencyKey: string,
    ) => Effect.Effect<EmailSendResult, EmailSendFailed | EmailRejected>;
  }
>()("email", {
  make: Effect.gen(function* () {
    const sender = yield* EmailSender;
    return {
      send: (message: EmailMessage, idempotencyKey: string) =>
        sender.send({ ...message, idempotencyKey }),
    };
  }),
}) {}
