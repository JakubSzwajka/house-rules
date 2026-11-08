import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export const EmailAddress = Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+$/));
export const EmailLine = Schema.String.check(Schema.isPattern(/^[^\r\n]*\S[^\r\n]*$/));

export class EmailRejected extends Schema.TaggedError<EmailRejected>()("EmailRejected", {}) {}

export class EmailSendFailed extends Schema.TaggedError<EmailSendFailed>()("EmailSendFailed", {}) {}

export const EmailMessage = Schema.Struct({
  to: EmailAddress,
  from: Schema.optionalKey(EmailAddress),
  subject: EmailLine,
  text: Schema.String.check(Schema.isPattern(/\S/)),
  html: Schema.optionalKey(Schema.String),
  idempotencyKey: EmailLine,
});
export type EmailMessage = typeof EmailMessage.Type;

export class Email extends Domain.ExternalSystem("Email", {
  send: {
    args: EmailMessage.fields,
    success: { providerId: Schema.NullOr(Schema.String) },
    error: [EmailRejected, EmailSendFailed],
  },
}) {}
