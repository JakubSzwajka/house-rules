import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { assert, it } from "@effect/vitest";
import { Actor, ActorId } from "@house-rules/domain";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Effect, FileSystem, Layer } from "effect";
import { MyStuff, postgresMyBookingStore } from "../../index.ts";

const database = Layer.effectDiscard(
  Migrations.run([
    {
      name: "party",
      table: "party_migrations",
      directory: new URL("../migrations", import.meta.resolve("@house-rules/party")).pathname,
    },
    {
      name: "bookings",
      table: "bookings_migrations",
      directory: new URL("../migrations", import.meta.resolve("@example/bookings")).pathname,
    },
    {
      name: "billing",
      table: "billing_migrations",
      directory: new URL("../migrations", import.meta.resolve("@example/billing")).pathname,
    },
  ]),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      MigrationsTesting.database({ label: "read", client: (url) => PgClient.layer({ url }) }),
      NodeServices.layer,
    ),
  ),
);
const world = MyStuff.layer.pipe(
  Layer.provide(postgresMyBookingStore),
  Layer.provideMerge(database),
);

it.layer(world, { timeout: 30_000 })("published views", (it) => {
  it.effect("runs the Postgres adapter against both migrated views", () =>
    Effect.gen(function* () {
      const read = yield* MyStuff;
      assert.deepStrictEqual(yield* read.myBookings(Actor.make({ id: ActorId.make("A") })), []);
      assert.deepStrictEqual(yield* read.myBookings(Actor.make({ id: ActorId.make("B") })), []);
    }),
  );
});

const guardReadSource = (source: string): number => {
  assert.notMatch(source, /\bsql\s*\.\s*(?:unsafe|literal|insert|update|delete)\b/i);
  const templates = [...source.matchAll(/sql\x60([\s\S]*?)\x60/g)];
  for (const [, query] of templates) {
    assert.notMatch(query ?? "", /\b(?:booking|payment)\b/i);
    assert.match(query ?? "", /^\s*SELECT\b/i);
    assert.notMatch(
      query ?? "",
      /;|\b(?:insert|update|delete|drop|alter|create|truncate|merge|call|grant|copy|execute|begin|commit)\b/i,
    );
  }
  return templates.length;
};

it.effect("guards every adapter SQL template against private tables and writes", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = new URL("../postgres", import.meta.url).pathname;
    const names = yield* fs.readDirectory(directory);
    let queries = 0;
    for (const name of names) {
      const source = yield* fs.readFileString(`${directory}/${name}`);
      queries += guardReadSource(source);
    }
    assert.strictEqual(queries, 1);
    for (const table of ["booking", "payment"]) {
      assert.throws(() => guardReadSource(`sql\`SELECT * FROM ${table}\``));
    }
    for (const source of [
      "sql`UPDATE booking_read SET status = 'cancelled'`",
      "sql`SELECT * FROM booking_read; DELETE FROM payment_read`",
      "sql.unsafe('DROP VIEW booking_read')",
    ])
      assert.throws(() => guardReadSource(source));
    assert.strictEqual(
      guardReadSource("sql`SELECT * FROM booking_read JOIN payment_read USING (id)`"),
      1,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
