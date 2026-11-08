import * as Pg from "@effect/sql-pg/PgClient";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { databaseUrl, PgForTests, testSchema } from "../from-env.ts";
import { layer, type Options } from "../postgres-platform.ts";
import { migrate, TablesMissing, tableNames } from "../tables.ts";
import { Audit, TalliesLive, TallyApi, TallyId } from "./tally.ts";

const onPostgres = process.env["DOMAIN_STORE"] !== "memory";

const platform = (schema: string, options: Options = {}) =>
  layer({ schema, pollInterval: "100 millis", ...options });

const worldIn = (schema: string) =>
  TalliesLive.pipe(Layer.provideMerge(platform(schema, { createTables: false })));

const exercise = (name: string) =>
  Effect.gen(function* () {
    const api = yield* TallyApi.clientInProcess;
    const id = TallyId.make(name);
    yield* api.OpenTally(id, { closeAfterMillis: 300 });
    yield* api.AddToTally(id, { amount: 2 });
    const audits = yield* Audit;
    const audit = yield* audits.state(id).pipe(
      Effect.filterOrFail((state) => state.count === 1),
      Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 }),
    );
    expect(audit).toEqual({ count: 1 });
    const closed = yield* api.TallyTotals.watch(id).pipe(
      Stream.filter(({ state }) => state?.closed === true),
      Stream.runHead,
      Effect.timeout("5 seconds"),
      Effect.map(Option.getOrUndefined),
    );
    expect(closed?.state).toEqual({ total: 2, adds: 1, closed: true });
  });

const defectOf = <E>(exit: Exit.Exit<unknown, E>) =>
  Exit.isFailure(exit) ? Result.getOrUndefined(Cause.findDefect(exit.cause)) : undefined;

const startFails = (schema: string) =>
  Layer.build(platform(schema, { createTables: false })).pipe(
    Effect.scoped,
    Effect.exit,
    Effect.map(defectOf),
  );

const schemaExists = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* Pg.PgClient;
    const rows = yield* sql<{ found: boolean }>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema}) AS found`;
    return rows[0]?.found === true;
  });

const runtimeRole = (schema: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const sql = yield* Pg.PgClient;
      const rows = yield* sql<{ name: string; password: string }>`
        SELECT 'runtime_' || replace(gen_random_uuid()::text, '-', '') AS name,
               replace(gen_random_uuid()::text, '-', '') AS password`;
      const role = rows[0] ?? (yield* Effect.die(new Error("no role name")));
      // Both values are generated hex above; utility statements take no bind parameters.
      yield* sql.unsafe(`CREATE ROLE ${role.name} LOGIN PASSWORD '${role.password}'`);
      yield* sql`GRANT USAGE ON SCHEMA ${sql(schema)} TO ${sql(role.name)}`;
      yield* sql`
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${sql(schema)}
        TO ${sql(role.name)}`;
      yield* sql`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${sql(schema)} TO ${sql(role.name)}`;
      const url = new URL(Redacted.value(yield* databaseUrl));
      url.username = role.name;
      url.password = role.password;
      return { name: role.name, client: Pg.layer({ url: Redacted.make(url.toString()) }) };
    }),
    (role) =>
      Effect.gen(function* () {
        const sql = yield* Pg.PgClient;
        yield* sql`DROP OWNED BY ${sql(role.name)}`;
        yield* sql`DROP ROLE IF EXISTS ${sql(role.name)}`;
      }).pipe(Effect.ignore),
  ).pipe(Effect.orDie);

describe.skipIf(!onPostgres)("the Postgres platform with createTables: false", () => {
  it.live("runs a model on tables migrate created beforehand", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      yield* migrate(schema);
      yield* exercise("n-1").pipe(Effect.scoped, Effect.provide(worldIn(schema)));
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("refuses to start on a missing schema, and does not create it", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      const defect = yield* startFails(schema);
      expect(defect).toBeInstanceOf(TablesMissing);
      expect(defect).toMatchObject({ schema, missing: [...tableNames] });
      expect(String((defect as TablesMissing).message)).toContain(
        `schema "${schema}" does not exist`,
      );
      expect(yield* schemaExists(schema)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("names the tables a schema lacks", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      yield* migrate(schema);
      const sql = yield* Pg.PgClient;
      yield* sql`DROP TABLE ${sql(`${schema}.outbox`)}`;
      const defect = yield* startFails(schema);
      expect(defect).toMatchObject({ _tag: "TablesMissing", schema, missing: ["outbox"] });
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );

  it.live("runs a model as a role that may only use rows, not create", () =>
    Effect.gen(function* () {
      const schema = yield* testSchema;
      yield* migrate(schema);
      const role = yield* runtimeRole(schema);

      const creating = yield* Layer.build(platform(schema)).pipe(
        Effect.scoped,
        Effect.provide(role.client),
        Effect.exit,
        Effect.map(defectOf),
      );
      expect(creating).toMatchObject({
        _tag: "SqlError",
        reason: { _tag: "AuthorizationError", cause: { code: "42501" } },
      });

      yield* exercise("n-2").pipe(
        Effect.scoped,
        Effect.provide(worldIn(schema).pipe(Layer.provide(role.client))),
      );
    }).pipe(Effect.scoped, Effect.provide(PgForTests)),
  );
});
