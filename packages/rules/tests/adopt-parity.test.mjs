import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { run } from "./migrations-helpers.mjs";

// Keep in step with packages/migrations/src/tests/adopt-parity.test.ts, which asserts the runner's verdict on the same cases.
const trips = { workspace: "packages/trips" };
const audit = { package: "@vendor/audit" };
const OLD = "db_migrations";
const CASES = [
  {
    label: "two modules splitting one old table",
    modules: [
      { ...trips, adopt: { from: OLD, ids: [1] } },
      { ...audit, adopt: { from: OLD, ids: [2] } },
    ],
    accepts: true,
  },
  {
    label: "a rehash that is a subset of ids",
    modules: [{ ...trips, adopt: { from: OLD, ids: [1, 2], rehash: [2] } }, audit],
    accepts: true,
  },
  {
    label: "an empty rehash",
    modules: [{ ...trips, adopt: { from: OLD, ids: [1], rehash: [] } }, audit],
    accepts: true,
  },
  {
    label: "an unknown key inside adopt",
    modules: [{ ...trips, adopt: { from: OLD, ids: [1], note: "x" } }, audit],
    accepts: true,
  },
  {
    label: "an adopt table that is no SQL name",
    modules: [{ ...trips, adopt: { from: "BAD TABLE", ids: [1] } }, audit],
    accepts: false,
  },
  {
    label: "an adopt with no ids",
    modules: [{ ...trips, adopt: { from: OLD, ids: [] } }, audit],
    accepts: false,
  },
  {
    label: "a negative adopt id",
    modules: [{ ...trips, adopt: { from: OLD, ids: [-1] } }, audit],
    accepts: false,
  },
  {
    label: "a rehash id that is not adopted",
    modules: [{ ...trips, adopt: { from: OLD, ids: [1], rehash: [2] } }, audit],
    accepts: false,
  },
  {
    label: "an id claimed by two modules",
    modules: [
      { ...trips, adopt: { from: OLD, ids: [1, 2] } },
      { ...audit, adopt: { from: OLD, ids: [2] } },
    ],
    accepts: false,
  },
  {
    label: "an adopt that is a string",
    modules: [{ ...trips, adopt: "typo" }, audit],
    accepts: false,
  },
  {
    label: "an adopt that is null",
    modules: [{ ...trips, adopt: null }, audit],
    accepts: false,
  },
  {
    label: "an adopt that is an array",
    modules: [{ ...trips, adopt: [] }, audit],
    accepts: false,
  },
  {
    label: "an adopt without from",
    modules: [{ ...trips, adopt: { ids: [1] } }, audit],
    accepts: false,
  },
  {
    label: "an adopt without ids",
    modules: [{ ...trips, adopt: { from: OLD } }, audit],
    accepts: false,
  },
  {
    label: "an adopt from that is a number",
    modules: [{ ...trips, adopt: { from: 7, ids: [1] } }, audit],
    accepts: false,
  },
  {
    label: "adopt ids that are strings",
    modules: [{ ...trips, adopt: { from: OLD, ids: ["1"] } }, audit],
    accepts: false,
  },
  {
    label: "an adopt id that is not whole",
    modules: [{ ...trips, adopt: { from: OLD, ids: [1.5] } }, audit],
    accepts: false,
  },
  {
    label: "an adopt id beyond the safe integers",
    modules: [{ ...trips, adopt: { from: OLD, ids: [9007199254740992] } }, audit],
    accepts: false,
  },
  {
    label: "an adopt id listed twice",
    modules: [{ ...trips, adopt: { from: OLD, ids: [1, 1] } }, audit],
    accepts: false,
  },
  {
    label: "a rehash id listed twice",
    modules: [{ ...trips, adopt: { from: OLD, ids: [1], rehash: [1, 1] } }, audit],
    accepts: false,
  },
  {
    label: "a rehash that is not an array",
    modules: [{ ...trips, adopt: { from: OLD, ids: [1], rehash: 1 } }, audit],
    accepts: false,
  },
  {
    label: "a negative rehash id",
    modules: [{ ...trips, adopt: { from: OLD, ids: [1], rehash: [-1] } }, audit],
    accepts: false,
  },
  {
    label: "an adopt from the history table of another module",
    modules: [trips, { ...audit, adopt: { from: "trips_migrations", ids: [1] } }],
    accepts: false,
  },
  {
    label: "an adopt from its own history table",
    modules: [{ ...trips, adopt: { from: "trips_migrations", ids: [1] } }, audit],
    accepts: false,
  },
  {
    label: "an adopt from a custom history table of another module",
    modules: [
      { ...trips, table: "legacy" },
      { ...audit, adopt: { from: "legacy", ids: [1] } },
    ],
    accepts: false,
  },
];

const treeFor = (modules) => ({
  "package.json": JSON.stringify({ dependencies: { "@vendor/audit": "1.0.0" } }),
  "migrations.json": JSON.stringify({ modules }),
  "packages/trips/package.json": "{}",
  "packages/trips/migrations/0001_trip.sql": "create table trip (id integer);\n",
  "node_modules/@vendor/audit/package.json": JSON.stringify({
    name: "@vendor/audit",
    houseRules: { migrations: "migrations" },
  }),
  "node_modules/@vendor/audit/migrations/0001_audit.sql": "create table audit (id integer);\n",
});

describe("house-rules-migrations, the adopt key, checker verdicts shared with the runner", () => {
  for (const item of CASES) {
    it(`${item.accepts ? "accepts" : "rejects"} ${item.label}`, () => {
      const result = run(treeFor(item.modules));
      assert.equal(result.status === 0, item.accepts, result.stderr);
    });
  }
});
