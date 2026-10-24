import { PgClient } from "@effect/sql-pg";
import { assert, layer, it } from "@effect/vitest";
import { Context, Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { MigrationsTesting, SqlHealth } from "../index.ts";

it.effect("does not invent a SQL check for an app without a SqlClient", () =>
  Effect.sync(() => assert.isTrue(Option.isNone(SqlHealth.fromContext(Context.empty())))),
);

layer(
  MigrationsTesting.database({
    label: "sql_health",
    client: (url) => PgClient.layer({ url, maxConnections: 1 }),
  }),
  { timeout: "30 seconds" },
)("SQL readiness", (it) => {
  it.effect("pings the app client without a unit or migrations and captures that same client", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.isUndefined(yield* SqlHealth.check(sql));
      const captured = SqlHealth.fromContext(Context.make(SqlClient.SqlClient, sql));
      assert.isTrue(Option.isSome(captured));
      if (Option.isSome(captured)) assert.isUndefined(yield* captured.value);
    }),
  );
});
