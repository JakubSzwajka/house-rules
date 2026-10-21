import { expect, layer } from "@effect/vitest";
import {
  bindOperation,
  composition,
  defineFeature,
  defineWay,
  endpoint,
  May,
  Mean,
  Runtime,
  StepTrace,
  toFetchHandler,
} from "@house-rules/application";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { SqlError } from "effect/sql/SqlError";
import {
  AuditReadFailed,
  AuditStore,
  AuditStoreUnavailable,
  postgresAuditStore,
} from "../../index.ts";
import { migratedDatabase } from "./stores.ts";

const node = {
  kind: "operation",
  name: "audit_failure",
  description: "Exercise the audit adapter's node failures.",
  input: Schema.Struct({ read: Schema.Boolean }),
  output: Schema.Void,
  failure: Schema.Union([AuditReadFailed, AuditStoreUnavailable]),
  permission: null,
  readOnly: true,
  destructive: false,
  transactional: false,
  needsApproval: false,
  edges: [],
} as const;
const entry = defineFeature("test_audit_failure", {
  ...node,
  flags: { readOnly: true },
  edges: [node],
  handler: (input, { call }) => call(node, input),
});
const features = [entry] as const;
const actor = { id: Schema.NonEmptyString.pipe(Schema.brand("ActorId")).make("viewer") };

layer(migratedDatabase("audit_http"), { timeout: "30 seconds" })(
  "audit node failure disclosure",
  (it) => {
    it.effect(
      "both Postgres audit failures send only 503 unavailable and retain their causes",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient;
          const seen: Array<AuditReadFailed | AuditStoreUnavailable> = [];
          const runtime = Layer.unwrap(
            Effect.gen(function* () {
              const store = yield* AuditStore;
              return Runtime.layer({
                features,
                ways: [{ name: "web", features }],
                bindings: [
                  bindOperation(node, ({ read }) => {
                    const work: Effect.Effect<unknown, AuditReadFailed | AuditStoreUnavailable> =
                      read ? store.read({}) : store.erase("viewer");
                    return work.pipe(
                      Effect.asVoid,
                      Effect.tapError((error) => Effect.sync(() => seen.push(error))),
                    );
                  }),
                ],
              });
            }),
          ).pipe(
            Layer.provide(postgresAuditStore.pipe(Layer.provide(Layer.succeed(SqlClient, sql)))),
          );
          const way = defineWay({
            name: "web",
            path: "/",
            protocol: "http",
            features,
            endpoints: [endpoint(entry, "POST /audit_failure")],
            who: { resolve: () => Effect.succeed(actor) },
            may: May.fixed(features, []),
            mean: Mean.no,
          });
          const app = composition({
            layer: Layer.merge(runtime, StepTrace.layer()),
            features,
            ways: [way],
            system: [],
          });
          const handler = toFetchHandler(app);
          yield* Effect.addFinalizer(() =>
            Effect.promise(() => handler.dispose().then(() => app.dispose())),
          );
          yield* sql`alter table call_audit rename to call_audit_private_driver_detail`;
          yield* Effect.gen(function* () {
            for (const read of [true, false]) {
              const response = yield* Effect.promise(() =>
                handler(
                  new Request("https://app.test/audit_failure", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ read }),
                  }) as Request,
                ),
              );
              const body = yield* Effect.promise(() => response.json());
              expect(response.status).toBe(503);
              expect(body).toEqual({
                error: {
                  code: "unavailable",
                  message: read
                    ? "The audit store could not be read."
                    : "The audit store is unavailable.",
                },
              });
              expect(JSON.stringify(body)).not.toMatch(/call_audit|relation|SqlError|cause|_tag/u);
            }
            expect(seen[0]).toBeInstanceOf(AuditReadFailed);
            expect(seen[1]).toBeInstanceOf(AuditStoreUnavailable);
            for (const error of seen) {
              expect(error.message).not.toContain("call_audit");
              expect(error.cause).toBeDefined();
              expect(Schema.is(SqlError)(error.cause)).toBe(true);
              if (Schema.is(SqlError)(error.cause)) {
                expect(String(error.cause.reason.cause)).toContain("call_audit");
              }
            }
          }).pipe(
            Effect.ensuring(
              sql`alter table call_audit_private_driver_detail rename to call_audit`.pipe(
                Effect.orDie,
              ),
            ),
          );
        }),
    );
  },
);
