import {
  Bookings,
  BookingsMount,
  memoryBookingStore,
  postgresBookingStore,
} from "@example/bookings";
import {
  Billing,
  BillingMount,
  PaymentProvider,
  fakePaymentProvider,
  memoryPaymentStore,
  postgresPaymentStore,
} from "@example/billing";
import {
  MyStuff,
  MyStuffMount,
  MyBookingStore,
  postgresMyBookingStore,
  ReadUnavailable,
} from "../read-models/my-bookings/index.ts";
import { CurrentActor, StepTrace, sqlUnitOfWork } from "@house-rules/application";
import { memoryUnitOfWork } from "@house-rules/domain";
import { CallAudit, memoryAuditLog, type MemoryAuditLog } from "@house-rules/call-audit";
import { Identity, IdentityMount } from "@house-rules/identity";
import { Party, PartyMount } from "@house-rules/party";
import { Config, Effect, Layer, Option, Schema, Redacted } from "effect";
import { DemoForbidden } from "./demo-issuers.ts";
import { PgClient } from "@effect/sql-pg";
import { builtInRoles } from "./roles.ts";
import { AuditTrailMount, auditTrailReader } from "../read-models/audit-trail/index.ts";

const storage = Config.Literals(["memory", "postgres"], "STORAGE").pipe(
  Config.withDefault("memory"),
);
const database = Layer.unwrap(
  Config.schema(Schema.Redacted(Schema.NonEmptyString), "DATABASE_URL").pipe(
    Effect.map((url) => PgClient.layer({ url })),
  ),
);
const choose = <A, E, R, B, F, S>(memory: Layer.Layer<A, E, R>, postgres: Layer.Layer<B, F, S>) =>
  Layer.unwrap(
    storage.pipe(
      Effect.map(
        (
          kind,
        ): Layer.Layer<
          A & B,
          E | F | Layer.Error<typeof database>,
          R | Exclude<S, Layer.Success<typeof database>>
        > => (kind === "memory" ? memory : postgres.pipe(Layer.provide(database))),
      ),
    ),
  );
const auditOptions = {
  who: Effect.serviceOption(CurrentActor).pipe(
    Effect.map(Option.match({ onNone: () => null, onSome: (actor) => actor.id })),
  ),
  policy: CallAudit.presets.strict,
};
const readUnavailablePort = Layer.succeed(MyBookingStore, {
  forPerson: () => Effect.fail(new ReadUnavailable({})),
});
const identityOptions = Effect.gen(function* () {
  const issuer = yield* Config.String("ACCOUNTS_ISSUER").pipe(Config.withDefault(""));
  const origin = yield* Config.String("APP_ORIGIN").pipe(Config.withDefault(""));
  const port = yield* Config.Int("PORT").pipe(Config.withDefault(3000));
  const signingKey = yield* Config.Redacted("ACCOUNTS_SIGNING_KEY").pipe(
    Config.withDefault(Redacted.make("")),
  );
  const environment = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"));
  if (environment === "production" && Redacted.value(signingKey).trim() === "")
    return yield* new DemoForbidden();
  const passwordOptions = { issuer: issuer || origin || `http://localhost:${port}` };
  return {
    providers: [
      Identity.passwords(
        Redacted.value(signingKey).trim() === ""
          ? { ...passwordOptions, ephemeral: true }
          : { ...passwordOptions, signingKey },
      ),
    ],
  };
});

export const modulePlan = (
  options: { readonly provider?: Layer.Layer<PaymentProvider>; readonly log?: MemoryAuditLog } = {},
) => {
  const provider = options.provider ?? fakePaymentProvider();
  const log = options.log ?? memoryAuditLog();
  const mounts = [
    {
      ...BookingsMount,
      layer: Bookings.layer.pipe(Layer.provide(choose(memoryBookingStore(), postgresBookingStore))),
    },
    {
      ...BillingMount,
      layer: Billing.layer.pipe(
        Layer.provide(Layer.merge(choose(memoryPaymentStore(), postgresPaymentStore), provider)),
      ),
    },
    {
      ...IdentityMount,
      layer: Layer.unwrap(
        identityOptions.pipe(
          Effect.map((options) =>
            choose(Identity.layerMemory(options), Identity.layerPostgres(options)),
          ),
        ),
      ),
    },
    {
      ...PartyMount,
      layer: choose(Party.layerMemory({ builtInRoles }), Party.layerPostgres({ builtInRoles })),
    },
    {
      ...MyStuffMount,
      layer: MyStuff.layer.pipe(Layer.provide(choose(readUnavailablePort, postgresMyBookingStore))),
    },
    {
      ...AuditTrailMount,
      layer: auditTrailReader.pipe(
        Layer.provide(choose(CallAudit.reader.memory(log), CallAudit.reader.postgres)),
      ),
    },
  ] as const;
  const infrastructure = Layer.mergeAll(
    Layer.unwrap(
      storage.pipe(
        Effect.map(
          (kind): Layer.Layer<never, Layer.Error<typeof database>> =>
            kind === "memory" ? Layer.empty : database,
        ),
      ),
    ),
    choose(memoryUnitOfWork, sqlUnitOfWork),
    StepTrace.layer(),
    choose(
      CallAudit.record.memory(log, auditOptions).layer,
      CallAudit.record.postgres(auditOptions).layer,
    ),
  );
  return { mounts, layer: infrastructure };
};
