import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { defineContract, Grant, implement } from "@house-rules/capability";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { expect, layer } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Logger, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { CallAudit } from "../../index.ts";

class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {}) {}

const readGreeting = implement(
  defineContract("read_greeting", {
    description: "Greet someone by name.",
    input: Schema.Struct({ name: Schema.String }),
    output: Schema.String,
    failure: NameIsEmpty,
    permission: "greetings:read",
  }),
  ({ name }) => (name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`)),
);

class Viewer extends Context.Service<Viewer, { readonly userId: string }>()("test/Viewer") {}

const who = Effect.serviceOption(Viewer).pipe(
  Effect.map((viewer) => (Option.isSome(viewer) ? viewer.value.userId : null)),
);

const migrationsDirectory = new URL("../../../migrations", import.meta.url).pathname;

const migratedDatabase = Layer.effectDiscard(
  Migrations.run([
    { name: "call_audit", directory: migrationsDirectory, table: "call_audit_migrations" },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({
        label: "audit",
        client: (url) => PgClient.layer({ url, maxConnections: 2 }),
      }),
      NodeServices.layer,
    ),
  ),
);

const caller = Layer.mergeAll(
  Layer.succeed(Viewer, { userId: "user_ana" }),
  Grant.layerFromPermissions(["greetings:read"]),
);

const rows = SqlClient.use(
  (sql) => sql<Record<string, unknown>>`select * from call_audit order by id`,
);

const clearRows = SqlClient.use((sql) => sql`delete from call_audit`);

layer(migratedDatabase, { excludeTestServices: true, timeout: "30 seconds" })(
  "CallAudit.layerTable",
  (it) => {
    it.effect("writes one row per call, with the five fields and a timestamp", () =>
      Effect.gen(function* oneRowPerCall() {
        yield* clearRows;
        const audit = CallAudit.layerTable({ who });
        const secret = "Secret honeymoon in Lisbon";
        yield* readGreeting
          .handler({ name: secret })
          .pipe(Effect.provide(Layer.mergeAll(audit, caller)));
        yield* readGreeting
          .handler({ name: "" })
          .pipe(Effect.provide(Layer.mergeAll(audit, caller)), Effect.exit);
        const written = yield* rows;
        expect(written).toHaveLength(2);
        expect(written.map((row) => Object.keys(row).sort())).toEqual([
          [
            "capability",
            "channel",
            "id",
            "kind",
            "ms",
            "outcome",
            "permission",
            "recorded_at",
            "request_id",
            "target_id",
            "viewer_id",
          ],
          [
            "capability",
            "channel",
            "id",
            "kind",
            "ms",
            "outcome",
            "permission",
            "recorded_at",
            "request_id",
            "target_id",
            "viewer_id",
          ],
        ]);
        expect(written).toMatchObject([
          {
            capability: "read_greeting",
            permission: "greetings:read",
            viewer_id: "user_ana",
            outcome: "success",
          },
          { capability: "read_greeting", viewer_id: "user_ana", outcome: "NameIsEmpty" },
        ]);
        expect(written[0]?.recorded_at).toBeInstanceOf(Date);
        expect(typeof written[0]?.ms).toBe("number");
        const text = JSON.stringify(written, (_key, value: unknown) =>
          typeof value === "bigint" ? String(value) : value,
        );
        expect(text).not.toContain(secret);
      }),
    );

    it.effect("indexes both read patterns, newest first, and retention by class", () =>
      Effect.gen(function* readIndexes() {
        const found = yield* SqlClient.use(
          (sql) =>
            sql<{ indexname: string; indexdef: string }>`
              select indexname, indexdef from pg_indexes
              where tablename = 'call_audit' and indexname <> 'call_audit_pkey'
              order by indexname`,
        );
        const columns = Object.fromEntries(
          found.map((row) => [row.indexname, row.indexdef.slice(row.indexdef.indexOf("("))]),
        );
        expect(columns).toEqual({
          call_audit_recorded_at: "(recorded_at DESC, id DESC)",
          call_audit_retention: "(outcome, kind, recorded_at, id)",
          call_audit_viewer_recorded_at: "(viewer_id, recorded_at DESC, id DESC)",
        });
      }),
    );

    it.effect("keeps the log line when asked, beside the row", () =>
      Effect.gen(function* tableAndLog() {
        yield* clearRows;
        const lines: Array<unknown> = [];
        const capture = Logger.layer([Logger.make(({ message }) => lines.push(message))]);
        yield* readGreeting
          .handler({ name: "Ada" })
          .pipe(
            Effect.provide(
              Layer.mergeAll(CallAudit.layerTable({ who, log: true }), caller, capture),
            ),
          );
        expect(yield* rows).toHaveLength(1);
        expect(JSON.stringify(lines)).toContain(
          'capability call {\\"capability\\":\\"read_greeting\\"',
        );
      }),
    );

    it.effect("a broken table leaves the call's exit and the log line untouched", () =>
      Effect.gen(function* brokenTable() {
        const lines: Array<unknown> = [];
        const capture = Logger.layer([Logger.make(({ message }) => lines.push(message))]);
        const audit = Layer.mergeAll(CallAudit.layerTable({ who, log: true }), caller, capture);
        yield* SqlClient.use((sql) => sql`alter table call_audit rename to call_audit_away`);
        const success = yield* readGreeting
          .handler({ name: "Ada" })
          .pipe(Effect.provide(audit), Effect.exit);
        const failure = yield* readGreeting
          .handler({ name: "" })
          .pipe(Effect.provide(audit), Effect.exit);
        yield* SqlClient.use((sql) => sql`alter table call_audit_away rename to call_audit`);
        expect(success).toEqual(Exit.succeed("Hello, Ada"));
        expect(Exit.isFailure(failure)).toBe(true);
        expect(JSON.stringify(failure)).toContain("NameIsEmpty");
        expect(JSON.stringify(lines).match(/capability call/g)).toHaveLength(2);
      }),
    );
  },
);
