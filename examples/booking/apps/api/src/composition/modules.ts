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
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { AuditStorage } from "./audit-storage.ts";
export const readUnavailablePort = Layer.succeed(MyBookingStore, {
  forPerson: () => Effect.fail(new ReadUnavailable({})),
});
export const mountMemoryModules = (
  options: { readonly provider?: Layer.Layer<PaymentProvider>; readonly log?: MemoryAuditLog } = {},
) =>
  Layer.mergeAll(
    Bookings.layer.pipe(Layer.provide(memoryBookingStore())),
    Billing.layer.pipe(
      Layer.provide(Layer.merge(memoryPaymentStore(), options.provider ?? fakePaymentProvider())),
    ),
    MyStuff.layer.pipe(Layer.provide(readUnavailablePort)),
    Identity.layerMemory,
    Party.layerMemory,
    memoryUnitOfWork,
    StepTrace.layer(),
    Layer.succeed(AuditStorage, { kind: "memory", log: options.log ?? memoryAuditLog() }),
  );
export const mountPostgresModules = <E>(
  database: Layer.Layer<SqlClient, E>,
  provider: Layer.Layer<PaymentProvider> = fakePaymentProvider(),
) =>
  Layer.mergeAll(
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
  ).pipe(Layer.provide(database));
