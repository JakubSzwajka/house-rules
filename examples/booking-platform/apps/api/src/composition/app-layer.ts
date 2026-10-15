import { PgClient } from "@effect/sql-pg";
import { Accounts } from "@example/accounts";
import { Activity } from "@example/activity";
import { Bookings, postgresBookingStore } from "@example/bookings";
import { memoryUnitOfWork } from "@house-rules/domain";
import { CurrentActor, sqlUnitOfWork } from "@house-rules/application";
import { CallAudit, memoryAuditStore } from "@house-rules/call-audit";
import { Comments, CommentTargets, CommentTargetsUnavailable } from "@house-rules/comments";
import { Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { Config, Effect, Layer, Option, Redacted } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { callNotes, requestLogWatch } from "./request-log.js";
import { localSignIn, type SignInSettings, signInConfig, signInLayer } from "./sign-in.js";

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
  policy: CallAudit.presets.strict,
};

const demoBookings = [
  { id: "demo", guestName: "Ada Lovelace", ownerId: null, status: "active" },
] as const;

const memoryModules = Layer.mergeAll(
  Comments.layerMemory(commentOptions).pipe(
    Layer.provide(commentTargets),
    Layer.provideMerge(Bookings.fromRecords(demoBookings)),
  ),
  Activity.layer.pipe(
    Layer.provideMerge(
      requestLogWatch(callNotes).pipe(
        Layer.provideMerge(
          CallAudit.layer(auditOptions).pipe(Layer.provideMerge(memoryAuditStore())),
        ),
      ),
    ),
  ),
  Identity.layerMemory,
  Party.layerMemory,
  memoryUnitOfWork,
);

export const memoryAppLayer = (settings: SignInSettings = localSignIn) =>
  signInLayer(settings, Accounts.layerMemory).pipe(Layer.provideMerge(memoryModules));

export const postgresAppLayer = <E>(
  database: Layer.Layer<SqlClient, E>,
  settings: SignInSettings = localSignIn,
) =>
  signInLayer(settings, Accounts.layerPostgres).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Comments.layerPostgres(commentOptions).pipe(
          Layer.provide(commentTargets),
          Layer.provideMerge(Bookings.layer.pipe(Layer.provide(postgresBookingStore))),
        ),
        Activity.layer.pipe(
          Layer.provideMerge(
            requestLogWatch(callNotes).pipe(
              Layer.provideMerge(CallAudit.layerPostgres(auditOptions)),
            ),
          ),
        ),
        Identity.layerPostgres,
        Party.layerPostgres,
        sqlUnitOfWork,
      ),
    ),
    Layer.provide(database),
  );

export const databaseUrl = Config.String("DATABASE_URL").pipe(
  Config.withDefault(""),
  Config.map((url) => (url === "" ? Option.none() : Option.some(Redacted.make(url)))),
);

export const postgresClient = (url: Redacted.Redacted<string>): Layer.Layer<SqlClient, SqlError> =>
  PgClient.layer({ url });

export const appLayer = Layer.unwrap(
  Effect.orDie(Config.all({ database: databaseUrl, signIn: signInConfig })).pipe(
    Effect.map(({ database, signIn }) =>
      Option.match(database, {
        onNone: () => memoryAppLayer(signIn),
        onSome: (url) => postgresAppLayer(postgresClient(url), signIn),
      }),
    ),
  ),
);
