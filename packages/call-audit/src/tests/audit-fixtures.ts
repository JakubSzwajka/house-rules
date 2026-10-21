import {
  CallChannel,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
  withRequestId,
} from "@house-rules/application";
import { Context, DateTime, Duration, Effect, Layer, Option, Schema } from "effect";
import { McpSchema } from "effect/ai";
import { AuditStore } from "../index.ts";
import type { AuditPolicy, AuditRow } from "../index.ts";

export const secret = "Secret honeymoon in Lisbon";

export class TripNotFound extends Schema.TaggedError<TripNotFound>()("TripNotFound", {
  kind: Schema.tag("not_found"),
  message: Schema.String,
}) {}

const TripInput = Schema.Struct({ tripId: Schema.String, title: Schema.String });

const trip = (name: string, readOnly: boolean) => {
  const entry = defineFeature(name, {
    description: "Read or rename a trip.",
    input: TripInput,
    output: Schema.String,
    failure: TripNotFound,
    permission: null,
    edges: [],
    flags: { readOnly },
    start: { kind: "system", reason: "audit test", startedBy: "test" },
    handler: ({ tripId, title }) =>
      tripId === "missing"
        ? Effect.fail(new TripNotFound({ message: `No trip called ${title}` }))
        : Effect.succeed(tripId),
  });
  const runtime = Layer.mergeAll(
    Runtime.layer({ bindings: [], features: [entry], ways: [] }),
    StepTrace.layer(),
    Layer.succeedContext(May.system([entry], { system: [], via: "test" })),
  );
  return {
    entry,
    handler: (input: typeof TripInput.Type) =>
      runFeature(entry, input).pipe(Effect.provide(runtime)),
  };
};
export const readTrip = trip("read_trip", true);
export const renameTrip = trip("rename_trip", false);

export class Requester extends Context.Service<Requester, { readonly userId: string }>()(
  "test/Requester",
) {}

export const who = Effect.serviceOption(Requester).pipe(
  Effect.map((viewer) => (Option.isSome(viewer) ? viewer.value.userId : null)),
);

export const asRequester = (userId: string) => Effect.provideService(Requester, { userId });

export const onWeb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(CallChannel, "web"));

export const overMcp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(McpSchema.McpRequestContext, {
      clientId: 1,
      protocolVersion: "2025-11-25",
      clientCapabilities: new McpSchema.ClientCapabilities({}),
      clientInfo: { name: "test-client", version: "1.0.0" },
    }),
  );

export const inRequest = (requestId: string) => withRequestId(requestId);

export const daysAgo = (days: number) =>
  DateTime.now.pipe(
    Effect.map((now) =>
      DateTime.toDateUtc(
        DateTime.makeUnsafe(DateTime.toEpochMillis(now) - Duration.toMillis(Duration.days(days))),
      ),
    ),
  );

const blankRow = {
  capability: "seeded",
  target: "seeded",
  permission: "public",
  viewerId: null,
  outcome: "success",
  ms: 1,
  kind: "write",
  targetId: null,
  channel: "web",
  requestId: null,
} as const;

export const seed = (row: Partial<Omit<AuditRow, "recordedAt">>, ageInDays: number) =>
  Effect.gen(function* seedRow() {
    const store = yield* AuditStore;
    yield* store.record({ ...blankRow, ...row, recordedAt: yield* daysAgo(ageInDays) });
  });

export const allRows = AuditStore.use((store) => store.read({ limit: 1000 }));

export const capabilitiesOf = (rows: ReadonlyArray<AuditRow>) =>
  rows.map((row) => row.capability).sort();

export const perClassPolicy = (base: AuditPolicy): AuditPolicy => ({
  ...base,
  retention: {
    read: Duration.days(1),
    write: Duration.days(10),
    failure: Duration.days(30),
  },
});
