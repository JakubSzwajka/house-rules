import { errorKind } from "@house-rules/domain";
import { Context, type Effect, Schema, type Stream } from "effect";
import type { EventEnvelope } from "../contract/event.ts";

export class EventSourceUnavailable extends Schema.TaggedError<EventSourceUnavailable>()(
  "EventSourceUnavailable",
  { kind: errorKind("unavailable"), cause: Schema.Defect() },
) {
  override get message(): string {
    return "Event delivery is unavailable. Try again shortly.";
  }
}

export class EventSource extends Context.Service<
  EventSource,
  {
    readonly consumers: readonly Readonly<{ name: string; kinds: readonly string[] }>[];
    readonly claimDue: (
      consumer: string,
    ) => Effect.Effect<readonly unknown[], EventSourceUnavailable>;
    readonly takeNext: (
      token: unknown,
    ) => Effect.Effect<EventEnvelope | null, EventSourceUnavailable>;
    readonly settleSuccess: (token: unknown) => Effect.Effect<boolean, EventSourceUnavailable>;
    readonly settleFailure: (
      token: unknown,
      summary: string,
    ) => Effect.Effect<boolean, EventSourceUnavailable>;
    readonly wake: Stream.Stream<void, EventSourceUnavailable>;
  }
>()("@house-rules/application/EventSource") {}
