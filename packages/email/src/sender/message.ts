import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const EmailMessage = Schema.Struct({
  to: Schema.String,
  from: Schema.optionalKey(Schema.String),
  subject: Schema.String,
  text: Schema.String,
  html: Schema.optionalKey(Schema.String),
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type EmailMessage = typeof EmailMessage.Type;

export const EmailSendResult = Schema.Struct({ providerId: Schema.optionalKey(Schema.String) });
export type EmailSendResult = typeof EmailSendResult.Type;

export class EmailSendFailed extends Schema.TaggedError<EmailSendFailed>()("EmailSendFailed", {
  kind: errorKind("unavailable"),
  message: Schema.Literal("Email sending is unavailable."),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class EmailRejected extends Schema.TaggedError<EmailRejected>()("EmailRejected", {
  kind: errorKind("invalid"),
  message: Schema.String,
}) {}

export class EmailCallerDenied extends Schema.TaggedError<EmailCallerDenied>()(
  "EmailCallerDenied",
  {
    kind: errorKind("forbidden"),
    message: Schema.tag("Email sending requires a system caller."),
  },
) {}
