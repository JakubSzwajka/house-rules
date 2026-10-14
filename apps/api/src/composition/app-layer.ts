import { PgClient } from "@effect/sql-pg";
import { BookingPermissions, Bookings, postgresBookingStore } from "@hosti/bookings";
import { memoryUnitOfWork } from "@house-rules/domain";
import { CurrentActor, Grant, sqlUnitOfWork } from "@house-rules/application";
import { CallAudit, memoryAuditStore } from "@house-rules/call-audit";
import { Comments, CommentTargets, CommentTargetsUnavailable } from "@house-rules/comments";
import { Config, Effect, Layer, Option, Redacted } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { TokenVerifier } from "./token-verifier.js";

export const visitorGrant: Layer.Layer<Grant> = Grant.layerFromPermissions([
  BookingPermissions.read,
]);

export const commentTargets = Layer.effect(
  CommentTargets,
  Effect.gen(function* () {
    const bookings = yield* Bookings;
    return CommentTargets.of({
      relation: (actor, ref) =>
        bookings
          .relation(actor, ref.id)
          .pipe(Effect.mapError((cause) => new CommentTargetsUnavailable({ cause }))),
    });
  }),
);

const commentOptions = { ...Comments.presets.default, targets: ["booking"] };

const auditOptions = {
  who: Effect.serviceOption(CurrentActor).pipe(
    Effect.map(Option.match({ onNone: () => null, onSome: (actor) => actor.id })),
  ),
  policy: CallAudit.presets.agentAware,
};

const demoBookings = [
  { id: "demo", guestName: "Ada Lovelace", ownerId: null, status: "active" },
] as const;

export const memoryAppLayer = Layer.mergeAll(
  Comments.layerMemory(commentOptions).pipe(
    Layer.provide(commentTargets),
    Layer.provideMerge(Bookings.fromRecords(demoBookings)),
  ),
  CallAudit.layer(auditOptions).pipe(Layer.provideMerge(memoryAuditStore())),
  memoryUnitOfWork,
  visitorGrant,
);

export const postgresAppLayer = <E>(database: Layer.Layer<SqlClient, E>) =>
  Layer.mergeAll(
    Comments.layerPostgres(commentOptions).pipe(
      Layer.provide(commentTargets),
      Layer.provideMerge(Bookings.layer.pipe(Layer.provide(postgresBookingStore))),
    ),
    CallAudit.layerPostgres(auditOptions),
    sqlUnitOfWork,
    visitorGrant,
  ).pipe(Layer.provide(database));

export const databaseUrl = Config.String("DATABASE_URL").pipe(
  Config.withDefault(""),
  Config.map((url) => (url === "" ? Option.none() : Option.some(Redacted.make(url)))),
);

export const postgresClient = (url: Redacted.Redacted<string>): Layer.Layer<SqlClient, SqlError> =>
  PgClient.layer({ url });

export const appLayer = Layer.unwrap(
  Effect.orDie(databaseUrl).pipe(
    Effect.map(
      Option.match({
        onNone: () => memoryAppLayer,
        onSome: (url) => postgresAppLayer(postgresClient(url)),
      }),
    ),
  ),
).pipe(Layer.merge(TokenVerifier.none));
