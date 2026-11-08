import * as Effect from "effect/Effect";
import { Email } from "./email.external.ts";

export const consoleEmail = Email.toLayer(
  Effect.succeed({
    send: (message) =>
      Effect.logInfo("Email sent", { hasHtml: message.html !== undefined }).pipe(
        Effect.as({ providerId: null }),
      ),
  }),
);
