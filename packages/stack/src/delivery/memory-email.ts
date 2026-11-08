import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { Email, type EmailMessage } from "./email.external.ts";

export class SentEmails extends Context.Service<
  SentEmails,
  {
    readonly all: Effect.Effect<ReadonlyArray<EmailMessage>>;
    readonly record: (message: EmailMessage) => Effect.Effect<void>;
  }
>()("HouseRules/SentEmails") {
  static readonly layer = Layer.effect(
    this,
    Effect.map(Ref.make<ReadonlyArray<EmailMessage>>([]), (sent) => ({
      all: Ref.get(sent),
      record: (message: EmailMessage) =>
        Ref.update(sent, (all) =>
          all.some((m) => m.idempotencyKey === message.idempotencyKey) ? all : [...all, message],
        ),
    })),
  );
}

export const memoryEmail = (defaultFrom: string) =>
  Email.toLayer(
    Effect.gen(function* () {
      const sent = yield* SentEmails;
      return {
        send: (message) =>
          sent.record({ from: defaultFrom, ...message }).pipe(Effect.as({ providerId: null })),
      };
    }),
  ).pipe(Layer.provideMerge(SentEmails.layer));
