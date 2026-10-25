import { EventSource, EventSourceUnavailable } from "@house-rules/application";
import { Effect, Layer, Schema, Stream } from "effect";
import { DeliveryToken } from "./delivery.js";
import type { EventLogService } from "./event-log.js";

export const eventSource = (log: EventLogService) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const unavailable = (cause: unknown) => new EventSourceUnavailable({ cause });
      const token = Schema.decodeUnknownEffect(DeliveryToken);
      return Layer.succeed(EventSource, {
        consumers: yield* log.consumers(),
        claimDue: (consumer) => log.claimDue({ consumer }).pipe(Effect.mapError(unavailable)),
        takeNext: (input) =>
          token(input).pipe(
            Effect.flatMap(log.takeNext),
            Effect.map((delivery) => delivery?.event ?? null),
            Effect.mapError(unavailable),
          ),
        settleSuccess: (input) =>
          token(input).pipe(Effect.flatMap(log.settleSuccess), Effect.mapError(unavailable)),
        settleFailure: (input, summary) =>
          token(input).pipe(
            Effect.flatMap((decoded) => log.settleFailure(decoded, summary)),
            Effect.mapError(unavailable),
          ),
        wake: Stream.unwrap(log.wakeups()).pipe(Stream.mapError(unavailable)),
      });
    }),
  );
