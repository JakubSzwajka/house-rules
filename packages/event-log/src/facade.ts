import { defineModule } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { memoryEventStore } from "./adapters/memory/event.js";
import { postgresEventStore } from "./adapters/postgres/event.js";
import { makeEventLog, type EventLogService } from "./event/event-log.js";
import { type EventLogOptions, validateOptions, deliveryDefaults } from "./event/options.js";
import { EventStore } from "./storage.js";

export class EventLog extends defineModule<EventLog, EventLogService>()("event-log", {
  make: (options: EventLogOptions) =>
    Effect.gen(function* () {
      const settings = yield* validateOptions(options);
      return makeEventLog(yield* EventStore, settings);
    }),
}) {
  static readonly presets = { default: deliveryDefaults } as const;
  static readonly layerMemory = (options: EventLogOptions) =>
    this.layer(options).pipe(Layer.provide(memoryEventStore()));
  static readonly layerPostgres = (options: EventLogOptions) =>
    this.layer(options).pipe(Layer.provide(postgresEventStore));
}
