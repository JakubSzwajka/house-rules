import type { PlainSchema } from "@house-rules/domain/contract";
import { ConsumerOptions } from "./delivery.js";
import { Effect, Schema } from "effect";
import { EventInputInvalid } from "./event.js";

export type EventLogOptions = Readonly<{
  registry: Readonly<Record<string, PlainSchema>>;
  consumers: ReadonlyArray<ConsumerOptions>;
}>;
export const deliveryDefaults = {
  maxAttempts: 5,
  backoff: { baseMs: 1000, capMs: 300000 },
} as const;
export const validateOptions = Effect.fn("EventLog.validateOptions")(function* (
  options: EventLogOptions,
) {
  const consumers = yield* Schema.decodeEffect(Schema.Array(ConsumerOptions))(
    options.consumers,
  ).pipe(
    Effect.mapError(() => new EventInputInvalid({ message: "Invalid event consumer options." })),
  );
  const names = new Set<string>();
  for (const consumer of consumers) {
    if (
      names.has(consumer.name) ||
      consumer.kinds.some((kind) => !Object.hasOwn(options.registry, kind)) ||
      (consumer.backoff !== undefined && consumer.backoff.baseMs > consumer.backoff.capMs)
    ) {
      return yield* new EventInputInvalid({ message: "Invalid event consumer registration." });
    }
    names.add(consumer.name);
  }
  return {
    registry: { ...options.registry },
    consumers: consumers.map((consumer) => ({
      ...consumer,
      kinds: [...new Set(consumer.kinds)],
      maxAttempts: consumer.maxAttempts ?? deliveryDefaults.maxAttempts,
      backoff: consumer.backoff ?? deliveryDefaults.backoff,
    })),
  };
});
export type EventLogSettings = Effect.Success<ReturnType<typeof validateOptions>>;
