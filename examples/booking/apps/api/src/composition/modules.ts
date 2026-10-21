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
import { memoryAuditLog, type MemoryAuditLog } from "@house-rules/call-audit";
import { Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { StepTrace } from "@house-rules/application";
import { Config, Effect, Layer, Schema } from "effect";
import { PgClient } from "@effect/sql-pg";
import { SqlClient } from "effect/sql/SqlClient";
import { AuditStorage } from "./audit-storage.ts";
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
      if (storage === "memory")
        return Layer.mergeAll(
          Bookings.layer.pipe(Layer.provide(memoryBookingStore())),
          Billing.layer.pipe(Layer.provide(Layer.merge(memoryPaymentStore(), provider))),
          MyStuff.layer.pipe(Layer.provide(readUnavailablePort)),
          Identity.layerMemory,
          Party.layerMemory,
          memoryUnitOfWork,
          StepTrace.layer(),
          Layer.succeed(AuditStorage, { kind: "memory", log: options.log ?? memoryAuditLog() }),
        );
      const url = yield* Config.schema(Schema.Redacted(Schema.NonEmptyString), "DATABASE_URL");
      return Layer.mergeAll(
        Bookings.layer.pipe(Layer.provide(postgresBookingStore)),
        Billing.layer.pipe(Layer.provide(Layer.merge(postgresPaymentStore, provider))),
        MyStuff.layer.pipe(Layer.provide(postgresMyBookingStore)),
        Identity.layerPostgres,
        Party.layerPostgres,
        sqlUnitOfWork,
        StepTrace.layer(),
        Layer.effect(
          AuditStorage,
          Effect.map(SqlClient, (client) => ({ kind: "postgres" as const, client })),
        ),
      ).pipe(Layer.provide(PgClient.layer({ url })));
    }),
  );
