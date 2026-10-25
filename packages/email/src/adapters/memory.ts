import { Context, Effect, Layer, Ref } from "effect";
import {
  EmailSender,
  type EmailDelivery,
  type EmailSenderOptions,
  validateEmail,
} from "../sender/email-sender.ts";

export class MemoryEmailOutboxTesting extends Context.Service<
  MemoryEmailOutboxTesting,
  {
    messages: Effect.Effect<ReadonlyArray<EmailDelivery>>;
    add: (email: EmailDelivery) => Effect.Effect<void>;
  }
>()("@house-rules/email/MemoryEmailOutboxTesting") {}

export const memory = (options: EmailSenderOptions) => {
  const outbox = Layer.effect(
    MemoryEmailOutboxTesting,
    Effect.gen(function* () {
      const sent = yield* Ref.make(new Map<string, EmailDelivery>());
      return MemoryEmailOutboxTesting.of({
        messages: Ref.get(sent).pipe(Effect.map((items) => [...items.values()])),
        add: (email) =>
          Ref.update(sent, (items) => {
            if (items.has(email.idempotencyKey)) return items;
            const message = Object.freeze({ ...email, from: email.from ?? options.defaultFrom });
            return new Map(items).set(email.idempotencyKey, message);
          }),
      });
    }),
  );

  return Layer.effect(
    EmailSender,
    Effect.gen(function* () {
      const outbox = yield* MemoryEmailOutboxTesting;
      return EmailSender.of({
        send: (email) => {
          const invalid = validateEmail(email, options.defaultFrom);
          if (invalid) return Effect.fail(invalid);
          return outbox.add(email).pipe(Effect.as({}));
        },
      });
    }),
  ).pipe(Layer.provideMerge(outbox));
};
