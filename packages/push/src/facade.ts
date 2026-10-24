import { defineModule } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { memoryPushStore } from "./adapters/memory/push.js";
import { memoryPushSender, type MemoryPushSenderOptions } from "./adapters/memory/sender.js";
import { consolePushSender } from "./adapters/console/sender.js";
import { postgresPushStore } from "./adapters/postgres/push.js";
import { makePush } from "./push/push-service.js";
import { PushInputInvalid, PushTtl } from "./push/push.js";
import { PushSender } from "./push/sender.js";
import { PushStore } from "./storage.js";
export type PushOptions = { readonly defaultTtlSeconds?: number };
export type PushService = ReturnType<typeof makePush>;
export class Push extends defineModule<Push, PushService>()("push", {
  make: (options: PushOptions) =>
    Effect.gen(function* () {
      const ttl = yield* Schema.decodeEffect(PushTtl)(options.defaultTtlSeconds ?? 86400).pipe(
        Effect.mapError(
          () => new PushInputInvalid({ message: "Push TTL must be a positive integer." }),
        ),
      );
      const store = yield* PushStore;
      const sender = yield* PushSender;
      return makePush(store, sender, ttl);
    }),
}) {
  static readonly layerMemory = (
    options: PushOptions = {},
    sender: Layer.Layer<PushSender> = memoryPushSender(),
  ) => Push.layer(options).pipe(Layer.provide(Layer.merge(memoryPushStore(), sender)));
  static readonly layerPostgres = (
    options: PushOptions = {},
    sender: Layer.Layer<PushSender> = consolePushSender,
  ) => Push.layer(options).pipe(Layer.provide(Layer.merge(postgresPushStore, sender)));
  static readonly layerMemoryTesting = (
    options: PushOptions = {},
    senderOptions: MemoryPushSenderOptions = {},
  ) =>
    Push.layer(options).pipe(
      Layer.provide(memoryPushStore()),
      Layer.provideMerge(memoryPushSender(senderOptions)),
    );
}
