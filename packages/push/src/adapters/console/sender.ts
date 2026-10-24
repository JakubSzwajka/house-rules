import { Effect, Layer } from "effect";
import type { PushSubscription } from "../../push/push.js";
import { PushSender } from "../../push/sender.js";
export const consolePushSender: Layer.Layer<PushSender> = Layer.succeed(
  PushSender,
  PushSender.of({
    send: (subscription: PushSubscription, _payload, options) =>
      Effect.logInfo("Push delivery", {
        endpoint: subscription.endpoint,
        ttl: options.ttl,
        idempotencyKey: options.idempotencyKey,
      }).pipe(Effect.as("sent" as const)),
  }),
);
