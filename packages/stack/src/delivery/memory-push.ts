import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { Push, PushGone, type PushMessage, PushSendFailed } from "./push.external.ts";

export class SentPushes extends Context.Service<
  SentPushes,
  {
    readonly all: Effect.Effect<ReadonlyArray<PushMessage>>;
    readonly record: (message: PushMessage) => Effect.Effect<void>;
  }
>()("HouseRules/SentPushes") {
  static readonly layer = Layer.effect(
    this,
    Effect.map(Ref.make<ReadonlyArray<PushMessage>>([]), (sent) => ({
      all: Ref.get(sent),
      record: (message: PushMessage) => Ref.update(sent, (all) => [...all, message]),
    })),
  );
}

export const memoryPush = (refuse: Readonly<Record<string, "gone" | "failed">> = {}) =>
  Push.toLayer(
    Effect.gen(function* () {
      const sent = yield* SentPushes;
      return {
        send: (message) => {
          const refusal = refuse[message.subscription.endpoint];
          if (refusal === "gone") return Effect.fail(new PushGone());
          if (refusal === "failed") return Effect.fail(new PushSendFailed());
          return sent.record(message);
        },
      };
    }),
  ).pipe(Layer.provideMerge(SentPushes.layer));
