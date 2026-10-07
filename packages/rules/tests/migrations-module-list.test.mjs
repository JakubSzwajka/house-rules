import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUTH_MIGRATION, problemLines, run, TRIPS_MIGRATION } from "./migrations-helpers.mjs";

describe("house-rules-migrations, the module list", () => {
  const CALL_AUDIT = {
    "node_modules/@house-rules/call-audit/package.json": JSON.stringify({
      name: "@house-rules/call-audit",
      houseRules: { migrations: "migrations" },
    }),
    "node_modules/@house-rules/call-audit/migrations/0001_call_audit.sql":
      "create table call_audit (id bigint primary key);\n",
  };

  it("fails a module with migrations when there is no list", () => {
    const result = run(
      { "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION },
      { list: false },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), ["migrations.json:1"]);
    assert.match(result.stderr, /packages\/trips has migrations, but there is no module list/);
  });

  it("fails a workspace module the list does not name", () => {
    const result = run({
      "migrations.json": JSON.stringify({ modules: [{ workspace: "packages/auth" }] }),
      "packages/auth/migrations/0001_user.sql": AUTH_MIGRATION,
      "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION,
    });
    assert.equal(result.status, 1);
    assert.deepEqual(problemLines(result), ["migrations.json:1"]);
    assert.match(
      result.stderr,
      /packages\/trips has migrations, but the module list does not name it\. Add \{ "workspace": "packages\/trips" \}/,
    );
  });

  it("fails a dependency that ships migrations when the list does not name it", () => {
    const result = run({
      ...CALL_AUDIT,
      "apps/web/package.json": JSON.stringify({
        dependencies: { "@house-rules/call-audit": "github:JakubSzwajka/house-rules#abc" },
      }),
      "apps/web/node_modules/@house-rules/call-audit/package.json": JSON.stringify({
        name: "@house-rules/call-audit",
        houseRules: { migrations: "migrations" },
      }),
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /@house-rules\/call-audit, a dependency in apps\/web, ships migrations, but the module list does not name it/,
    );
  });

  it("passes a listed dependency, and owns its tables like a workspace package's", () => {
    const listed = {
      ...CALL_AUDIT,
      "package.json": JSON.stringify({
        dependencies: { "@house-rules/call-audit": "github:JakubSzwajka/house-rules#abc" },
      }),
      "migrations.json": JSON.stringify({
        modules: [{ workspace: "packages/trips" }, { package: "@house-rules/call-audit" }],
      }),
      "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION,
    };
    const clean = run(listed);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /3 table\(s\) owned by 2 package\(s\).*2 module\(s\) listed/);

    const reaching = run({
      ...listed,
      "packages/trips/src/internal/audit.ts": "export const q = sql`select * from call_audit`;\n",
    });
    assert.equal(reaching.status, 1);
    assert.deepEqual(problemLines(reaching), ["packages/trips/src/internal/audit.ts:1"]);
    assert.match(reaching.stderr, /a table @house-rules\/call-audit owns/);
  });

  it("fails list entries that name nothing it can run", () => {
    const result = run({
      "node_modules/@vendor/plain/package.json": JSON.stringify({ name: "@vendor/plain" }),
      "migrations.json": JSON.stringify({
        modules: [
          { workspace: "packages/nowhere" },
          { workspace: "packages/db" },
          { package: "@vendor/missing" },
          { package: "@vendor/plain" },
          { workspace: "packages/db", package: "@vendor/plain" },
        ],
      }),
    });
    assert.equal(result.status, 1);
    assert.equal(problemLines(result).length, 5);
    assert.match(result.stderr, /"packages\/nowhere", which is not a workspace package/);
    assert.match(result.stderr, /"packages\/db", which has no migrations\/ folder/);
    assert.match(result.stderr, /"@vendor\/missing", which is not installed/);
    assert.match(result.stderr, /"@vendor\/plain", whose package.json does not declare/);
    assert.match(result.stderr, /entry 5 must name exactly one of "workspace" or "package"/);
  });

  it("fails a list that is not JSON of the right shape", () => {
    const result = run({ "migrations.json": "{ modules: nope" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /migrations.json is not valid JSON/);
  });

  const FRAMEWORK = {
    ...CALL_AUDIT,
    "node_modules/@house-rules/call-audit/package.json": JSON.stringify({
      name: "@house-rules/call-audit",
      files: ["src", "migrations"],
      houseRules: { migrations: "migrations" },
    }),
    "package.json": JSON.stringify({
      dependencies: { "@house-rules/call-audit": "github:JakubSzwajka/house-rules#abc" },
    }),
    "migrations.json": JSON.stringify({
      modules: [{ workspace: "packages/trips" }, { package: "@house-rules/call-audit" }],
    }),
    "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION,
  };

  it("holds a listed package's own source to the own-tables rule", () => {
    const own = run({
      ...FRAMEWORK,
      "node_modules/@house-rules/call-audit/src/own.ts":
        "export const q = sql`select * from call_audit`;\n",
    });
    assert.equal(own.status, 0, own.stderr);

    const reaching = run({
      ...FRAMEWORK,
      "node_modules/@house-rules/call-audit/src/q.ts":
        "export const q = sql`select * from trip`;\n",
    });
    assert.equal(reaching.status, 1);
    assert.deepEqual(problemLines(reaching), ["node_modules/@house-rules/call-audit/src/q.ts:1"]);
    assert.match(reaching.stderr, /SQL names "trip", a table packages\/trips owns/);
  });

  it("fails two entries on one history table or one name, and a name that is no slug", () => {
    const sameTable = run({
      ...FRAMEWORK,
      "migrations.json": JSON.stringify({
        modules: [
          { workspace: "packages/trips", table: "shared_migrations" },
          { package: "@house-rules/call-audit", table: "shared_migrations" },
        ],
      }),
    });
    assert.equal(sameTable.status, 1);
    assert.match(
      sameTable.stderr,
      /entry 2: module call_audit or its history table shared_migrations is listed twice/,
    );

    const sameName = run({
      ...FRAMEWORK,
      "migrations.json": JSON.stringify({
        modules: [
          { workspace: "packages/trips", name: "one" },
          { package: "@house-rules/call-audit", name: "one" },
        ],
      }),
    });
    assert.equal(sameName.status, 1);
    assert.match(
      sameName.stderr,
      /entry 2: module one or its history table one_migrations is listed twice/,
    );

    const badName = run({
      ...FRAMEWORK,
      "migrations.json": JSON.stringify({
        modules: [
          { workspace: "packages/trips", name: "NOT A SLUG" },
          { package: "@house-rules/call-audit", table: 7 },
        ],
      }),
    });
    assert.equal(badName.status, 1);
    assert.match(badName.stderr, /entry 1: module name NOT A SLUG is not a lowercase slug/);
    assert.match(badName.stderr, /entry 2: "name" and "table" must be strings/);
  });

  it("fails a workspace package that declares a migrations folder other than migrations/", () => {
    const result = run({
      "packages/trips/package.json": JSON.stringify({ houseRules: { migrations: "sql" } }),
      "packages/trips/sql/0001_trips.sql": TRIPS_MIGRATION,
      "migrations.json": JSON.stringify({ modules: [{ workspace: "packages/trips" }] }),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /workspace packages\/trips declares the migrations folder "sql"/);
    assert.match(
      result.stderr,
      /packages\/trips\/sql\/0001_trips.sql:1: this SQL file sits outside/,
    );

    const standard = run({
      "packages/trips/package.json": JSON.stringify({ houseRules: { migrations: "./migrations" } }),
      "packages/trips/migrations/0001_trips.sql": TRIPS_MIGRATION,
      "migrations.json": JSON.stringify({ modules: [{ workspace: "packages/trips" }] }),
    });
    assert.equal(standard.status, 0, standard.stderr);
  });
});
