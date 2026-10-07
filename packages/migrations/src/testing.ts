import { Config, Effect, Layer, Random, Redacted } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { UnsafeTestDatabase } from "./types.ts";

const NAMESPACE = /^[a-z][a-z0-9_]{7,62}$/;
const LABEL = /^[a-z][a-z0-9_]{0,15}$/;

export type TestDatabaseOptions<E> = Readonly<{
  label: string;
  client: (url: Redacted.Redacted<string>) => Layer.Layer<SqlClient, E>;
}>;

export const MigrationsTesting = {
  database: <E>(options: TestDatabaseOptions<E>) =>
    Layer.unwrap(
      Effect.gen(function* throwawayDatabase() {
        // One throwaway database per layer: created on build, dropped on release.
        const adminUrl = yield* Config.Redacted("TEST_DATABASE_ADMIN_URL");
        const namespace = yield* Config.String("TEST_DATABASE_NAMESPACE");
        if (!NAMESPACE.test(namespace) || !LABEL.test(options.label)) {
          return yield* new UnsafeTestDatabase({
            message: "TEST_DATABASE_NAMESPACE and the label must be lowercase slugs.",
          });
        }
        const suffix = yield* Random.nextIntBetween(10_000_000, 99_999_999);
        const name = `test_${suffix}_${options.label}_${namespace}`.slice(0, 63);
        const server = new URL(Redacted.value(adminUrl));
        server.pathname = "/postgres";
        const target = new URL(Redacted.value(adminUrl));
        target.pathname = `/${name}`;
        const serverLayer = options.client(Redacted.make(server.toString()));

        yield* Effect.acquireRelease(
          SqlClient.use((sql) =>
            sql.unsafe(`create database "${name}"`).unprepared.pipe(
              // No fsync wait on commit, so DROP DATABASE checkpoints elsewhere never stall it; the database is thrown away.
              Effect.andThen(
                sql.unsafe(`alter database "${name}" set synchronous_commit = off`).unprepared,
              ),
            ),
          ).pipe(Effect.provide(serverLayer)),
          () =>
            SqlClient.use(
              (sql) => sql.unsafe(`drop database if exists "${name}" with (force)`).unprepared,
            ).pipe(Effect.provide(serverLayer), Effect.orDie),
        );

        return options.client(Redacted.make(target.toString()));
      }),
    ),
} as const;
