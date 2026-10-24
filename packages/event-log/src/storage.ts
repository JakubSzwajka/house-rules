import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect, type Stream } from "effect";
import type { Candidate, DeadLetter, DeadLetterQuery } from "./event/delivery.js";
import type { EventQuery, EventStoreUnavailable, StoredEvent } from "./event/event.js";

type Write<A = void> = Effect.Effect<A, EventStoreUnavailable | NoOpenUnit>;
export class EventStore extends Context.Service<
  EventStore,
  {
    readonly append: (event: Omit<StoredEvent, "id">) => Write<StoredEvent>;
    readonly read: (
      query: EventQuery,
    ) => Effect.Effect<ReadonlyArray<StoredEvent>, EventStoreUnavailable>;
    readonly lock: (consumer: string) => Write<boolean>;
    readonly candidate: (
      consumer: string,
      kinds: ReadonlyArray<string>,
    ) => Effect.Effect<Candidate | undefined, EventStoreUnavailable>;
    readonly retry: (consumer: string, candidate: Candidate) => Write;
    readonly enqueueReplay: (consumer: string, candidate: Candidate) => Write<boolean>;
    readonly advance: (consumer: string, eventId: string, replay: boolean) => Write;
    readonly deadLetter: (row: DeadLetter) => Write;
    readonly listDeadLetters: (
      query: DeadLetterQuery,
    ) => Effect.Effect<ReadonlyArray<DeadLetter>, EventStoreUnavailable>;
    readonly findDeadLetter: (
      consumer: string,
      eventId: string,
    ) => Effect.Effect<DeadLetter | undefined, EventStoreUnavailable>;
    readonly clearDeadLetter: (consumer: string, eventId: string) => Write;
    readonly wakeups: Stream.Stream<void, EventStoreUnavailable>;
  }
>()("@house-rules/event-log/EventStore") {}
