import { CallChannel, CallRequestId, defineContract, implement } from "@house-rules/capability";
import { Context, DateTime, Duration, Effect, Option, Schema } from "effect";
import { McpSchema } from "effect/unstable/ai";
import { AuditStore } from "../index.ts";
import type { AuditPolicy, AuditRow } from "../index.ts";

export const secret = "Secret honeymoon in Lisbon";

export class TripNotFound extends Schema.TaggedError<TripNotFound>()("TripNotFound", {
  message: Schema.String,
}) {}

const TripInput = Schema.Struct({ tripId: Schema.String, title: Schema.String });

export const readTrip = implement(
  defineContract("read_trip", {
    description: "Read a trip.",
    input: TripInput,
    output: Schema.String,
    failure: TripNotFound,
    permission: "public",
    annotations: { readOnly: true },
    audit: { target: "tripId" },
  }),
  ({ tripId, title }) =>
    tripId === "missing"
      ? Effect.fail(new TripNotFound({ message: `No trip called ${title}` }))
      : Effect.succeed(tripId),
);

export const renameTrip = implement(
  defineContract("rename_trip", {
    description: "Rename a trip.",
    input: TripInput,
    output: Schema.String,
    failure: TripNotFound,
    permission: "public",
    audit: { target: "tripId" },
  }),
  ({ tripId, title }) =>
    tripId === "missing"
      ? Effect.fail(new TripNotFound({ message: `No trip called ${title}` }))
      : Effect.succeed(tripId),
);

export class Viewer extends Context.Service<Viewer, { readonly userId: string }>()("test/Viewer") {}

export const who = Effect.serviceOption(Viewer).pipe(
  Effect.map((viewer) => (Option.isSome(viewer) ? viewer.value.userId : null)),
);

export const asViewer = (userId: string) => Effect.provideService(Viewer, { userId });

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

export const inRequest =
  (requestId: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(CallRequestId, requestId));

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
