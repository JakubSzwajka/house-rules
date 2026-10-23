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
  MyBookings,
  MyBookingsMount,
  MyBookingStore,
  postgresMyBookingStore,
  ReadUnavailable,
} from "../read-models/my-bookings/index.ts";
import { CurrentActor, StepTrace, sqlUnitOfWork } from "@house-rules/application";
import { memoryUnitOfWork } from "@house-rules/domain";
import { CallAudit, memoryAuditLog, type MemoryAuditLog } from "@house-rules/call-audit";
import { Identity, IdentityMount, type IdentityOptions } from "@house-rules/identity";
import { Party, PartyMount } from "@house-rules/party";
import { Config, Effect, Layer, Option, Schema } from "effect";
import { PgClient } from "@effect/sql-pg";
import { builtInRoles } from "./access.ts";
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
export const modulePlan = (options: {
  readonly provider?: Layer.Layer<PaymentProvider>;
  readonly log?: MemoryAuditLog;
  readonly identity: Effect.Effect<
    IdentityOptions,
    Config.ConfigError | import("@house-rules/identity").IdentityProviderInvalid
  >;
}) => {
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
        options.identity.pipe(
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
      ...MyBookingsMount,
      layer: MyBookings.layer.pipe(
        Layer.provide(choose(readUnavailablePort, postgresMyBookingStore)),
      ),
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
