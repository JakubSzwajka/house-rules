import * as Domain from "@alchemy.run/domain";
import * as Pg from "@effect/sql-pg/PgClient";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { layer, type Options } from "./postgres-platform.ts";

export const LOCAL_DATABASE_URL = "postgres://house_rules:house_rules@127.0.0.1:55432/house_rules";

export const databaseUrl = Config.Redacted("DATABASE_URL").pipe(
  Config.withDefault(Redacted.make(LOCAL_DATABASE_URL)),
);

export const domainStore = Config.Literals(["postgres", "memory"], "DOMAIN_STORE").pipe(
  Config.withDefault("postgres" as const),
);

export const PgForTests = Pg.layerConfig({ url: databaseUrl });

export const testSchema = Effect.acquireRelease(
  Effect.gen(function* () {
    const sql = yield* Pg.PgClient;
    const rows = yield* sql<{ name: string }>`
      SELECT 'test_' || replace(gen_random_uuid()::text, '-', '') AS name`;
    const name = rows[0]?.name;
    return name ?? (yield* Effect.die(new Error("no schema name")));
  }),
  (schema) =>
    Effect.gen(function* () {
      const sql = yield* Pg.PgClient;
      yield* sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`;
    }).pipe(Effect.ignore),
).pipe(Effect.orDie);

export const postgresInFreshSchema = Layer.unwrap(
  Effect.map(testSchema, (schema) => layer({ schema, pollInterval: "200 millis" })),
);

export const fromEnv = (options: Omit<Options, "schema"> & { readonly schema: string }) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const store = yield* domainStore;
      if (store === "memory") return Domain.InMemory;
      const url = yield* Config.Redacted("DATABASE_URL");
      return layer(options).pipe(Layer.provide(Pg.layer({ url })));
    }),
  );

export const platformForTests = Layer.unwrap(
  Effect.gen(function* () {
    const store = yield* domainStore;
    return store === "memory"
      ? Domain.InMemory
      : postgresInFreshSchema.pipe(Layer.provide(PgForTests), Layer.orDie);
  }),
).pipe(Layer.orDie);
