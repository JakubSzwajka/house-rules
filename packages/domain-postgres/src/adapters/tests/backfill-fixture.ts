import * as Domain from "@alchemy.run/domain";
import {
  type Delivery,
  type ModelHost,
  Platform,
  type ViewKit,
  type ViewStore,
} from "@alchemy.run/domain/Platform";
import * as Pg from "@effect/sql-pg/PgClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import { layer, type Options } from "../postgres-platform.ts";

class Marked extends Domain.Event("Marked", { value: Schema.String }) {}
export class Mark extends Domain.Command("Mark", {
  target: Schema.String,
  input: { value: Schema.String },
  events: [Marked],
}) {}
export class Marks extends Domain.Aggregate("Marks", {
  id: Schema.String,
  state: Schema.Array(Schema.String),
  initial: [],
  commands: [Mark],
  decide: { Mark: (_, command) => [new Marked({ value: command.value })] },
  evolve: { Marked: (state, event) => [...state, event.value] },
}) {}

class OtherMarked extends Domain.Event("OtherMarked", { value: Schema.String }) {}
export class OtherMark extends Domain.Command("OtherMark", {
  target: Schema.String,
  input: { value: Schema.String },
  events: [OtherMarked],
}) {}
export class OtherMarks extends Domain.Aggregate("OtherMarks", {
  id: Schema.String,
  state: Schema.Array(Schema.String),
  initial: [],
  commands: [OtherMark],
  decide: { OtherMark: (_, command) => [new OtherMarked({ value: command.value })] },
  evolve: { OtherMarked: (state, event) => [...state, event.value] },
}) {}

interface Declaration {
  readonly mirrorLazy?: boolean;
  readonly policyLazy?: boolean;
  readonly individualOnly?: boolean;
  readonly secondSource?: boolean;
  readonly lazy?: boolean;
}

const modelAt = (version: number, effects: string[], options: Declaration) => {
  const {
    mirrorLazy = false,
    policyLazy = false,
    individualOnly = false,
    secondSource = false,
  } = options;
  class Collected extends Domain.View("Collected", {
    version,
    from: [Marks],
    key: Schema.String,
    keyOf: { Marked: () => "all" },
    state: Schema.Array(Schema.String),
    initial: [],
    evolve: { Marked: (state, event) => [...state, `${version}:${event.value}`] },
  }) {}
  class Individual extends Domain.View("Individual", {
    version,
    from: secondSource ? [Marks, OtherMarks] : [Marks],
    key: Marks,
    keyOf: { OtherMarked: () => Marks.ref("z") },
    state: Schema.Array(Schema.String),
    initial: [],
    evolve: {
      Marked: (state, event) => [...state, `${version}:${event.value}`],
      OtherMarked: (state, event) => [...state, `${version}:${event.value}`],
    },
  }) {}
  class Mirrored extends Domain.View("Mirrored", {
    from: [mirrorLazy ? Individual : Collected],
    key: Schema.String,
    keyOf: { Marked: () => "all" },
    state: Schema.Array(Schema.String),
    initial: [],
    evolve: { Marked: (state, event) => [...state, event.value] },
  }) {}
  class React extends Domain.Policy("React", {
    from: policyLazy || individualOnly ? Individual : Collected,
    on: [Marked],
  }) {}
  class Backfilled extends Domain.Model("Backfilled", {
    aggregates: [Marks, OtherMarks],
    views: individualOnly ? [Individual] : [Mirrored, Individual, Collected],
    policies: [React],
  }) {}
  return {
    definition: Backfilled,
    Collected,
    Individual,
    Mirrored,
    live: Backfilled.layer(
      React.toLayer(Effect.succeed(({ event }) => Effect.sync(() => effects.push(event.value)))),
      { lazy: options.lazy ? ["Individual"] : [] },
    ),
  };
};

export const world = (
  schema: string,
  version: number,
  effects: string[],
  inspect: (kit: ViewKit) => ViewKit = (kit) => kit,
  capture: (delivery: Delivery) => void = () => undefined,
  options: Declaration & {
    readonly pollInterval?: "1 hour";
    readonly outboxStatus?: Options["outboxStatus"];
    readonly host?: (host: ModelHost) => ModelHost | void;
    readonly store?: (kit: ViewKit, store: ViewStore) => ViewStore;
  } = {},
) => {
  const model = modelAt(version, effects, options);
  return {
    ...model,
    live: model.live.pipe(
      Layer.provideMerge(
        Layer.effect(
          Platform,
          Effect.map(Platform, (platform) =>
            Platform.of({
              model: (definition) =>
                Effect.map(platform.model(definition), (original) => {
                  const host = options.host?.(original) ?? original;
                  return {
                    ...host,
                    aggregate: (aggregate, kit) =>
                      host.aggregate(aggregate, {
                        ...kit,
                        deliver: (delivery) => {
                          capture(delivery);
                          return kit.deliver(delivery);
                        },
                      }),
                    view: (view, kit) =>
                      host
                        .view(view, inspect(kit))
                        .pipe(Effect.map((store) => options.store?.(kit, store) ?? store)),
                  };
                }),
            }),
          ),
        ).pipe(
          Layer.provide(
            layer({
              schema,
              pollInterval: options.pollInterval ?? "10 millis",
              outboxStatus: options.outboxStatus,
            }),
          ),
        ),
      ),
    ),
  };
};

export const drained = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* Pg.PgClient;
    yield* sql<{ count: string }>`SELECT count(*) AS count FROM ${sql(`${schema}.outbox`)}`.pipe(
      Effect.repeat({
        until: (rows) => Number(rows[0]?.count) === 0,
        schedule: Schedule.spaced("10 millis"),
      }),
      Effect.timeout("30 seconds"),
    );
  });

export const seed = (schema: string, count: number, deliveries: Delivery[] = []) => {
  const initial = world(schema, 1, [], undefined, (delivery) => deliveries.push(delivery));
  return Effect.gen(function* () {
    const marks = yield* Marks;
    for (let n = 0; n < count; n++) {
      yield* marks.send(n % 2 === 0 ? "a" : "z", new Mark({ value: String(n) }));
    }
    yield* drained(schema);
  }).pipe(Effect.scoped, Effect.provide(initial.live));
};

export const replayOrder = (count: number) =>
  Array.from({ length: count }, (_, n) => n)
    .filter((n) => n % 2 === 0)
    .concat(Array.from({ length: count }, (_, n) => n).filter((n) => n % 2 === 1))
    .map(String);
