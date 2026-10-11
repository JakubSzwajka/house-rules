import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, layer } from "@effect/vitest";
import { Effect, Path } from "effect";
import { Migrations } from "../index.ts";
import { alphaAndBeta, scratchApp, type Tree } from "./scratch-app.ts";

layer(NodeServices.layer)("Migrations, the module list", (it) => {
  const listError = (tree: Tree) =>
    Effect.gen(function* listError() {
      const app = yield* scratchApp(tree);
      return yield* Migrations.readModuleList(app.list).pipe(Effect.flip);
    });

  it.effect("resolves workspace and installed folders, names and tables", () =>
    Effect.gen(function* resolves() {
      const app = yield* scratchApp(alphaAndBeta);
      const path = yield* Path.Path;
      const modules = yield* Migrations.readModuleList(app.list);
      const root = path.dirname(app.list);
      expect(modules).toEqual([
        {
          name: "alpha",
          directory: path.join(root, "packages/alpha/migrations"),
          table: "alpha_migrations",
        },
        {
          name: "beta",
          directory: path.join(root, "node_modules/@vendor/beta/sql"),
          table: "beta_migrations",
        },
      ]);
    }),
  );

  it.effect("refuses an entry with both workspace and package", () =>
    Effect.gen(function* both() {
      const error = yield* listError({
        ...alphaAndBeta,
        "migrations.json": JSON.stringify({
          modules: [{ workspace: "packages/alpha", package: "@vendor/beta" }],
        }),
      });
      expect(error.message).toContain('exactly one of "workspace" or "package"');
    }),
  );

  it.effect("refuses a package that is not installed", () =>
    Effect.gen(function* missing() {
      const error = yield* listError({
        "migrations.json": JSON.stringify({ modules: [{ package: "@vendor/nowhere" }] }),
      });
      expect(error.message).toContain("@vendor/nowhere is not installed");
    }),
  );

  it.effect("refuses a package without houseRules.migrations", () =>
    Effect.gen(function* undeclared() {
      const error = yield* listError({
        "migrations.json": JSON.stringify({ modules: [{ package: "@vendor/plain" }] }),
        "node_modules/@vendor/plain/package.json": JSON.stringify({ name: "@vendor/plain" }),
      });
      expect(error.message).toContain("does not declare");
    }),
  );

  it.effect("refuses a workspace outside the app folder", () =>
    Effect.gen(function* outside() {
      const error = yield* listError({
        "migrations.json": JSON.stringify({ modules: [{ workspace: "../elsewhere" }] }),
      });
      expect(error.message).toContain("is not a folder below");
    }),
  );

  it.effect("refuses two modules on one history table", () =>
    Effect.gen(function* sameTable() {
      const error = yield* listError({
        ...alphaAndBeta,
        "migrations.json": JSON.stringify({
          modules: [
            { workspace: "packages/alpha", table: "shared_migrations" },
            { package: "@vendor/beta", table: "shared_migrations" },
          ],
        }),
      });
      expect(error.message).toContain("listed twice");
    }),
  );

  it.effect("refuses a workspace that declares another migrations folder", () =>
    Effect.gen(function* customFolder() {
      const error = yield* listError({
        "migrations.json": JSON.stringify({ modules: [{ workspace: "packages/gamma" }] }),
        "packages/gamma/package.json": JSON.stringify({ houseRules: { migrations: "sql" } }),
        "packages/gamma/sql/0001_gamma.sql": "create table gamma (id integer);\n",
      });
      expect(error.message).toContain("keeps its migrations in migrations/");
    }),
  );

  it.effect("accepts a workspace that declares migrations itself", () =>
    Effect.gen(function* standardFolder() {
      const app = yield* scratchApp({
        "migrations.json": JSON.stringify({ modules: [{ workspace: "packages/gamma" }] }),
        "packages/gamma/package.json": JSON.stringify({
          houseRules: { migrations: "./migrations" },
        }),
      });
      const modules = yield* Migrations.readModuleList(app.list);
      expect(modules.map((module) => module.name)).toEqual(["gamma"]);
    }),
  );

  it.effect("refuses a module name that is not a slug", () =>
    Effect.gen(function* badName() {
      const error = yield* listError({
        ...alphaAndBeta,
        "migrations.json": JSON.stringify({
          modules: [{ workspace: "packages/alpha", name: "NOT A SLUG" }],
        }),
      });
      expect(error.message).toContain("is not a lowercase slug");
    }),
  );

  const withAdopt = (alpha: unknown, beta?: unknown) => ({
    ...alphaAndBeta,
    "migrations.json": JSON.stringify({
      modules: [
        { workspace: "packages/alpha", adopt: alpha },
        beta === undefined ? { package: "@vendor/beta" } : { package: "@vendor/beta", adopt: beta },
      ],
    }),
  });

  it.effect("keeps an adopt entry on its module", () =>
    Effect.gen(function* adopts() {
      const adopt = { from: "db_migrations", ids: [1, 2], rehash: [2] };
      const app = yield* scratchApp(withAdopt(adopt, { from: "db_migrations", ids: [3] }));
      const modules = yield* Migrations.readModuleList(app.list);
      expect(modules.map((module) => module.adopt)).toEqual([
        adopt,
        { from: "db_migrations", ids: [3] },
      ]);
    }),
  );

  const ADOPT_PROBLEMS = [
    [{ from: "BAD TABLE", ids: [1] }, undefined, "is not a lowercase SQL name"],
    [{ from: "beta_migrations", ids: [1] }, undefined, "history table of a listed module"],
    [{ from: "alpha_migrations", ids: [1] }, undefined, "history table of a listed module"],
    [{ from: "db_migrations", ids: [] }, undefined, "claims no ids"],
    [{ from: "db_migrations", ids: [-1] }, undefined, "is not a migration id"],
    [{ from: "db_migrations", ids: [1, 1] }, undefined, "lists id 1 twice"],
    [{ from: "db_migrations", ids: [1], rehash: [2] }, undefined, "rehash id 2 is not one of"],
    [
      { from: "db_migrations", ids: [1, 2] },
      { from: "db_migrations", ids: [2] },
      "also claimed by module beta",
    ],
  ] as const;
  for (const [alpha, beta, message] of ADOPT_PROBLEMS) {
    it.effect(`refuses an adopt entry that ${message}`, () =>
      Effect.gen(function* badAdopt() {
        const error = yield* listError(withAdopt(alpha, beta));
        expect(error.message).toContain(message);
      }),
    );
  }

  it.effect("refuses an adopt entry that is not an object of ids", () =>
    Effect.gen(function* badShape() {
      const error = yield* listError(withAdopt({ from: "db_migrations", ids: ["1"] }));
      expect(error.message).toContain("is not {");
    }),
  );
});
