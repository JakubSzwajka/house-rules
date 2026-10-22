import { Bookings, memoryBookingStore, postgresBookingStore } from "@example/bookings";
import {
  Billing,
  PaymentProvider,
  fakePaymentProvider,
  memoryPaymentStore,
  postgresPaymentStore,
} from "@example/billing";
import {
  MyStuff,
  MyBookingStore,
  postgresMyBookingStore,
  ReadUnavailable,
} from "../read-models/my-bookings/index.ts";
import { sqlUnitOfWork } from "@house-rules/application";
import { memoryUnitOfWork } from "@house-rules/domain";
import { CallAudit, memoryAuditLog, type MemoryAuditLog } from "@house-rules/call-audit";
import { Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { CurrentActor, StepTrace } from "@house-rules/application";
import { Config, Effect, Layer, Option, Schema, Redacted } from "effect";
import { DemoForbidden } from "./demo-issuers.ts";
import { PgClient } from "@effect/sql-pg";
import { builtInRoles } from "./roles.ts";
import { Catalogue } from "./catalogue.ts";
const auditOptions = {
  who: Effect.serviceOption(CurrentActor).pipe(
    Effect.map(Option.match({ onNone: () => null, onSome: (actor) => actor.id })),
  ),
  policy: CallAudit.presets.strict,
};
export const readUnavailablePort = Layer.succeed(MyBookingStore, {
  forPerson: () => Effect.fail(new ReadUnavailable({})),
});
export const modulesLayer = (
  options: { readonly provider?: Layer.Layer<PaymentProvider>; readonly log?: MemoryAuditLog } = {},
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const storage = yield* Config.Literals(["memory", "postgres"], "STORAGE").pipe(
        Config.withDefault("memory"),
      );
      const provider = options.provider ?? fakePaymentProvider();
      const issuer = yield* Config.String("ACCOUNTS_ISSUER").pipe(Config.withDefault(""));
      const origin = yield* Config.String("APP_ORIGIN").pipe(Config.withDefault(""));
      const port = yield* Config.Int("PORT").pipe(Config.withDefault(3000));
      const signingKey = yield* Config.Redacted("ACCOUNTS_SIGNING_KEY").pipe(
        Config.withDefault(Redacted.make("")),
      );
      const environment = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"));
      const admin = yield* Config.String("DEMO_ADMIN_EMAIL").pipe(Config.withDefault(""));
      if (
        environment === "production" &&
        (admin !== "" || Redacted.value(signingKey).trim() === "")
      ) {
        return yield* new DemoForbidden();
      }
      const passwordOptions = { issuer: issuer || origin || `http://localhost:${port}` };
      const identityOptions = {
        providers: [
          Identity.passwords(
            Redacted.value(signingKey).trim() === ""
              ? { ...passwordOptions, ephemeral: true }
              : { ...passwordOptions, signingKey },
          ),
        ],
      };
      if (storage === "memory")
        return Layer.mergeAll(
          Identity.layerMemory(identityOptions),
          Bookings.layer.pipe(Layer.provide(memoryBookingStore())),
          Billing.layer.pipe(Layer.provide(Layer.merge(memoryPaymentStore(), provider))),
          MyStuff.layer.pipe(Layer.provide(readUnavailablePort)),
          Party.layerMemory({ builtInRoles }).pipe(Layer.provideMerge(Catalogue.layer)),
          memoryUnitOfWork,
          StepTrace.layer(),
          CallAudit.record.memory(options.log ?? memoryAuditLog(), auditOptions).layer,
        );
      const url = yield* Config.schema(Schema.Redacted(Schema.NonEmptyString), "DATABASE_URL");
      return Layer.mergeAll(
        Identity.layerPostgres(identityOptions),
        Bookings.layer.pipe(Layer.provide(postgresBookingStore)),
        Billing.layer.pipe(Layer.provide(Layer.merge(postgresPaymentStore, provider))),
        MyStuff.layer.pipe(Layer.provide(postgresMyBookingStore)),
        Party.layerPostgres({ builtInRoles }).pipe(Layer.provideMerge(Catalogue.layer)),
        sqlUnitOfWork,
        StepTrace.layer(),
        CallAudit.record.postgres(auditOptions).layer,
      ).pipe(Layer.provide(PgClient.layer({ url })));
    }),
  );
