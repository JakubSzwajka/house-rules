import { Effect, Layer } from "effect";
import { EmailSender, type EmailSenderOptions, validateEmail } from "../sender/email-sender.ts";

export const console = (options: EmailSenderOptions) =>
  Layer.effect(
    EmailSender,
    Effect.succeed(
      EmailSender.of({
        send: (email) => {
          const invalid = validateEmail(email, options.defaultFrom);
          if (invalid) return Effect.fail(invalid);
          return Effect.logInfo("Email queued", {
            fromConfigured: Boolean(email.from ?? options.defaultFrom),
            recipientCount: 1,
            hasHtml: Boolean(email.html),
          }).pipe(Effect.as({}));
        },
      }),
    ),
  );
