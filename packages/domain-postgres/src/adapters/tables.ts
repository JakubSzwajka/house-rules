import { PgClient } from "@effect/sql-pg/PgClient";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

export const tableNames = [
  "instances",
  "events",
  "receipts",
  "schedules",
  "cancellations",
  "views",
  "view_keys",
  "view_entries",
  "outbox",
] as const;

export class TablesMissing extends Data.TaggedError("TablesMissing")<{
  readonly schema: string;
  readonly missing: ReadonlyArray<string>;
  readonly message: string;
}> {}

export const createTables = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient;
    const t = (name: string) => sql(`${schema}.${name}`);
    // Parallel hosts on one database would race CREATE IF NOT EXISTS without it.
    yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`house-rules/domain-postgres/${schema}`}))`;
    yield* sql`CREATE SCHEMA IF NOT EXISTS ${sql(schema)}`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${t("instances")} (
        model text NOT NULL,
        aggregate text NOT NULL,
        id text NOT NULL,
        state jsonb,
        version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
        PRIMARY KEY (model, aggregate, id)
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${t("events")} (
        model text NOT NULL,
        aggregate text NOT NULL,
        id text NOT NULL,
        seq integer NOT NULL CHECK (seq > 0),
        event jsonb NOT NULL,
        envelope jsonb NOT NULL,
        PRIMARY KEY (model, aggregate, id, seq)
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${t("receipts")} (
        model text NOT NULL,
        aggregate text NOT NULL,
        id text NOT NULL,
        command_id text NOT NULL,
        result jsonb NOT NULL,
        PRIMARY KEY (model, aggregate, id, command_id)
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${t("schedules")} (
        model text NOT NULL,
        aggregate text NOT NULL,
        id text NOT NULL,
        command_id text NOT NULL,
        command jsonb NOT NULL,
        meta jsonb NOT NULL,
        due_at bigint NOT NULL,
        token text NOT NULL,
        PRIMARY KEY (model, aggregate, id, command_id)
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${t("cancellations")} (
        model text NOT NULL,
        aggregate text NOT NULL,
        id text NOT NULL,
        command_id text NOT NULL,
        PRIMARY KEY (model, aggregate, id, command_id)
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${t("views")} (
        model text NOT NULL,
        view text NOT NULL,
        generation integer NOT NULL,
        PRIMARY KEY (model, view)
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${t("view_keys")} (
        model text NOT NULL,
        view text NOT NULL,
        key text NOT NULL,
        snapshot jsonb NOT NULL,
        PRIMARY KEY (model, view, key)
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${t("view_entries")} (
        model text NOT NULL,
        view text NOT NULL,
        key text NOT NULL,
        seq integer NOT NULL CHECK (seq > 0),
        entry jsonb NOT NULL,
        PRIMARY KEY (model, view, key, seq)
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS ${t("outbox")} (
        position bigserial PRIMARY KEY,
        model text NOT NULL,
        delivery jsonb NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        failed_at bigint
      )`;
    yield* sql`
      CREATE INDEX IF NOT EXISTS ${sql("outbox_pending")} ON ${t("outbox")} (model, position)
      WHERE failed_at IS NULL`;
  });

export const migrate = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient;
    yield* sql.withTransaction(createTables(schema));
  });

export const checkTables = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient;
    const schemas = yield* sql<{ found: boolean }>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema}) AS found`;
    const rows = yield* sql<{ name: string }>`
      SELECT c.relname AS name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relkind IN ('r', 'p')`;
    const found = new Set(rows.map((row) => row.name));
    const missing = tableNames.filter((name) => !found.has(name));
    if (missing.length === 0) return;
    const fix = `run migrate("${schema}") as the schema owner before starting with createTables: false`;
    return yield* new TablesMissing({
      schema,
      missing,
      message:
        schemas[0]?.found === true
          ? `schema "${schema}" lacks tables ${missing.join(", ")}; ${fix}`
          : `schema "${schema}" does not exist; ${fix}`,
    });
  });
