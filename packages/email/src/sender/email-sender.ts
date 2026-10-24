import { Context, type Effect } from "effect";
import {
  type EmailMessage,
  EmailRejected,
  type EmailSendFailed,
  type EmailSendResult,
} from "./message.ts";

export type EmailDelivery = EmailMessage & Readonly<{ idempotencyKey: string }>;

export const validateEmail = (
  email: EmailDelivery,
  defaultFrom: string,
): EmailRejected | undefined => {
  const headerValues = Object.entries(email.headers ?? {}).flat();
  const headersInvalid = headerValues.some((value) => /[\r\n]/.test(value));
  const addressOrSubjectInvalid = [
    email.to,
    email.from ?? defaultFrom,
    defaultFrom,
    email.subject,
  ].some((value) => /[\r\n]/.test(value));

  if (
    !defaultFrom.trim() ||
    !(email.from ?? defaultFrom).trim() ||
    !email.to.trim() ||
    !email.subject.trim() ||
    !email.text.trim() ||
    !email.idempotencyKey.trim() ||
    headersInvalid ||
    addressOrSubjectInvalid
  ) {
    return new EmailRejected({ message: "Email is invalid." });
  }
  return undefined;
};

export class EmailSender extends Context.Service<
  EmailSender,
  {
    send(email: EmailDelivery): Effect.Effect<EmailSendResult, EmailSendFailed | EmailRejected>;
  }
>()("@house-rules/email/EmailSender") {}

export type EmailSenderOptions = Readonly<{ defaultFrom: string }>;
