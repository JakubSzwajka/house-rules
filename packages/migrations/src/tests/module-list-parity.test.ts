import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, layer } from "@effect/vitest";
import { Effect, Exit, Path } from "effect";
import { Migrations } from "../index.ts";
import { scratchApp, type Tree } from "./scratch-app.ts";

interface Case {
  readonly label: string;
  readonly modules: ReadonlyArray<unknown>;
  readonly accepts: boolean;
  readonly outside?: true;
  readonly workspaceFolder?: string;
  readonly frameworkFolder?: string | number | null;
  readonly frameworkHouseRules?: unknown;
  readonly frameworkName?: unknown;
}

const trips = { workspace: "packages/trips" };
const audit = { package: "@vendor/audit" };
const CASES: ReadonlyArray<Case> = [
  { label: "a workspace entry and a package entry", modules: [trips, audit], accepts: true },
  {
    label: "names and tables of the allowed length",
    modules: [
      { ...trips, name: "a".repeat(48) },
      { ...audit, table: "a".repeat(63) },
    ],
    accepts: true,
  },
  {
    label: "a workspace that declares ./migrations",
    modules: [trips, audit],
    workspaceFolder: "./migrations",
    accepts: true,
  },
  {
    label: "a framework folder other than migrations",
    modules: [trips, audit],
    frameworkFolder: "sql",
    accepts: true,
  },
  {
    label: "a nested framework folder",
    modules: [trips, audit],
    frameworkFolder: "db/sql",
    accepts: true,
  },
  {
    label: "a repeated name",
    modules: [
      { ...trips, name: "same" },
      { ...audit, name: "same" },
    ],
    accepts: false,
  },
  {
    label: "a repeated history table",
    modules: [
      { ...trips, table: "same" },
      { ...audit, table: "same" },
    ],
    accepts: false,
  },
  {
    label: "a name that is no slug",
    modules: [{ ...trips, name: "NOT A SLUG" }, audit],
    accepts: false,
  },
  {
    label: "a history table that is no SQL name",
    modules: [{ ...trips, table: "BAD TABLE" }, audit],
    accepts: false,
  },
  {
    label: "a name of 49 characters",
    modules: [{ ...trips, name: "a".repeat(49) }, audit],
    accepts: false,
  },
  {
    label: "a table of 64 characters",
    modules: [{ ...trips, table: "a".repeat(64) }, audit],
    accepts: false,
  },
  { label: "an empty name", modules: [{ ...trips, name: "" }, audit], accepts: false },
  { label: "a null name", modules: [{ ...trips, name: null }, audit], accepts: false },
  { label: "a number as table", modules: [{ ...trips, table: 42 }, audit], accepts: false },
  {
    label: "both workspace and package",
    modules: [{ ...trips, package: "@vendor/audit" }, audit],
    accepts: false,
  },
  {
    label: "a workspace entry with package 42",
    modules: [{ ...trips, package: 42 }, audit],
    accepts: false,
  },
  {
    label: "a workspace entry with package null",
    modules: [{ ...trips, package: null }, audit],
    accepts: false,
  },
  {
    label: "a package entry with workspace null",
    modules: [trips, { ...audit, workspace: null }],
    accepts: false,
  },
  {
    label: "a package entry with workspace 42",
    modules: [trips, { ...audit, workspace: 42 }],
    accepts: false,
  },
  { label: "an entry with neither", modules: [trips, audit, {}], accepts: false },
  { label: "an empty workspace", modules: [{ workspace: "" }, audit], accepts: false },
  { label: "an empty package", modules: [trips, { package: "" }], accepts: false },
  { label: "a null entry", modules: [trips, audit, null], accepts: false },
  { label: "a string entry", modules: [trips, audit, "packages/trips"], accepts: false },
  {
    label: "a package that is not installed",
    modules: [trips, { package: "@vendor/nowhere" }],
    accepts: false,
  },
  {
    label: "a workspace outside the repository",
    modules: [{ workspace: "../elsewhere" }, audit],
    accepts: false,
  },
  {
    label: "a workspace outside the repository that pnpm discovers",
    modules: [{ workspace: "../external/trips", name: "trips", table: "db_migrations" }],
    outside: true,
    accepts: false,
  },
  {
    label: "a workspace that declares another folder",
    modules: [trips, audit],
    workspaceFolder: "sql",
    accepts: false,
  },
  {
    label: "a framework folder that escapes the package",
    modules: [trips, audit],
    frameworkFolder: "../foreign",
    accepts: false,
  },
  {
    label: "a framework folder of .",
    modules: [trips, audit],
    frameworkFolder: ".",
    accepts: false,
  },
  {
    label: "an empty framework folder",
    modules: [trips, audit],
    frameworkFolder: "",
    accepts: false,
  },
  {
    label: "an absolute framework folder",
    modules: [trips, audit],
    frameworkFolder: "/tmp",
    accepts: false,
  },
  {
    label: "a framework folder that is a number",
    modules: [trips, audit],
    frameworkFolder: 7,
    accepts: false,
  },
  {
    label: "a framework package without houseRules.migrations",
    modules: [trips, audit],
    frameworkFolder: null,
    accepts: false,
  },
  {
    label: "a framework houseRules that is a string",
    modules: [trips, audit],
    frameworkHouseRules: "migrations",
    accepts: false,
  },
  {
    label: "a framework name that is a number",
    modules: [trips, audit],
    frameworkName: 7,
    accepts: false,
  },
];

const outsideTree = (modules: ReadonlyArray<unknown>): Tree => ({
  "app/pnpm-workspace.yaml": 'packages:\n  - "../external/*"\n',
  "app/package.json": "{}",
  "app/migrations.json": JSON.stringify({ modules }),
  "external/trips/package.json": "{}",
  "external/trips/migrations/0001_trip.sql": "create table trip (id integer);\n",
});

const treeFor = ({
  modules,
  workspaceFolder = "migrations",
  frameworkFolder = "migrations",
  frameworkHouseRules,
  frameworkName = "@vendor/audit",
}: Case): Tree => {
  const houseRules =
    frameworkHouseRules ?? (frameworkFolder === null ? undefined : { migrations: frameworkFolder });
  const folder = typeof frameworkFolder === "string" ? frameworkFolder : "migrations";
  return {
    "package.json": JSON.stringify({ dependencies: { "@vendor/audit": "1.0.0" } }),
    "migrations.json": JSON.stringify({ modules }),
    "packages/trips/package.json": JSON.stringify({ houseRules: { migrations: workspaceFolder } }),
    [`packages/trips/${workspaceFolder}/0001_trip.sql`]: "create table trip (id integer);\n",
    "node_modules/@vendor/audit/package.json": JSON.stringify({ name: frameworkName, houseRules }),
    [`node_modules/@vendor/audit/${folder}/0001_audit.sql`]: "create table audit (id integer);\n",
  };
};

layer(NodeServices.layer)(
  "Migrations, the module list, runner verdicts on the cases of packages/rules/tests/module-list-parity.test.mjs",
  (it) => {
    for (const item of CASES) {
      it.effect(`${item.accepts ? "accepts" : "rejects"} ${item.label}`, () =>
        Effect.gen(function* verdict() {
          const path = yield* Path.Path;
          const app = yield* scratchApp(item.outside ? outsideTree(item.modules) : treeFor(item));
          const list = item.outside
            ? path.join(path.dirname(app.list), "app", "migrations.json")
            : app.list;
          const exit = yield* Migrations.readModuleList(list).pipe(Effect.exit);
          expect(Exit.isSuccess(exit)).toBe(item.accepts);
        }),
      );
    }
  },
);
