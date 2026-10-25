import { Context, Effect, Layer } from "effect";
import { PushSendFailed } from "../../push/push.js";
import { PushSender } from "../../push/sender.js";
import { MemoryPushOutbox, type MemoryPushResult, type MemoryPushSend } from "./outbox.js";

export type MemoryPushSenderOptions = {
  readonly result?: MemoryPushResult;
  readonly results?: Readonly<Record<string, MemoryPushResult>>;
};
export const memoryPushSender = (
  options: MemoryPushSenderOptions = {},
): Layer.Layer<PushSender | MemoryPushOutbox> =>
  Layer.syncContext(() => {
    const sends: MemoryPushSend[] = [];
    const sender = PushSender.of({
      send: (subscription, payload, sendOptions) =>
        Effect.gen(function* () {
          const result = options.results?.[subscription.endpoint] ?? options.result ?? "sent";
          sends.push({
            subscription: {
              ...subscription,
              owner: { ...subscription.owner },
              keys: { ...subscription.keys },
            },
            payload,
            options: { ...sendOptions },
            result,
          });
          if (result === "fail") return yield* new PushSendFailed({ cause: "simulated" });
          return result;
        }),
    });
    return Context.make(PushSender, sender).pipe(
      Context.add(MemoryPushOutbox, { sends: Effect.sync(() => sends.slice()) }),
    );
  });
