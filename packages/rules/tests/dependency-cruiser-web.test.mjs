import assert from "node:assert/strict";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

const tree = {
  "apps/web/package.json": "{}",
  "apps/web/framework-env.d.ts": 'import "./.framework/types/routes.d.ts";',
  "apps/web/src/server/framework-env.d.ts": 'import "../../.framework/types/server.d.ts";',
  "apps/web/src/main.ts": 'import {missing} from "./missing.ts";',
};
const valueViolations = ["no-unresolved-imports: apps/web/src/main.ts -> ./missing.ts"];
const unresolved = [
  "no-unresolved-imports: apps/web/framework-env.d.ts -> ./.framework/types/routes.d.ts",
  "no-unresolved-imports: apps/web/src/server/framework-env.d.ts -> ../../.framework/types/server.d.ts",
];
const rule = (config, name) => config.forbidden.find((item) => item.name === name);
test("empty generated declarations preserve the whole config", () => {
  const plain = layout({ scope: "@acme/" });
  assert.deepEqual(layout({ scope: "@acme/", generatedDeclarationFiles: [] }), plain);
  assert.deepEqual(rule(plain, "no-unresolved-imports").from, {});
  assert.ok(plain.forbidden.every(({ severity }) => severity === "error"));
});
test("unconfigured declarations and ordinary files must resolve", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules(tree, layout({ scope: "@acme/" }))),
    [...unresolved, ...valueViolations].sort(),
  );
});
test("removed server-entry option fails with removal guidance", () => {
  for (const value of [[], ["runtime.ts"], "runtime.ts"])
    assert.throws(() => layout({ scope: "@acme/", serverEntryFiles: value }), {
      name: "TypeError",
      message:
        "layout(): serverEntryFiles was removed in 0.16.0. Remove the option. See @house-rules/rules docs/dependency-cruiser.md.",
    });
});
test("generated declarations exempt only the named app-relative files", async () => {
  const config = layout({ scope: "@acme/", generatedDeclarationFiles: ["framework-env.d.ts"] });
  assert.deepEqual(rule(config, "no-unresolved-imports").from, {
    pathNot: "^apps/[^/]+/(?:framework-env[.]d[.]ts)$",
  });
  assert.deepEqual(
    fromPaths(await violatedRules(tree, config)),
    [unresolved[1], ...valueViolations].sort(),
  );
});
test("naming both declarations keeps ordinary files checked", async () => {
  const config = layout({
    scope: "@acme/",
    generatedDeclarationFiles: ["framework-env.d.ts", "src/server/framework-env.d.ts"],
  });
  assert.deepEqual(fromPaths(await violatedRules(tree, config)), valueViolations);
});
test("generated declaration path validation stays strict", () => {
  for (const bad of [
    [""],
    ["/env.d.ts"],
    ["../env.d.ts"],
    [1],
    ["framework-env.ts"],
    ["src/app.tsx"],
    ["types.d.ts/"],
    "env.d.ts",
  ])
    assert.throws(
      () => layout({ scope: "@acme/", generatedDeclarationFiles: bad }),
      /generatedDeclarationFiles must be an array of relative paths .*ending in "\.d\.ts"/,
    );
  assert.doesNotThrow(() =>
    layout({ scope: "@acme/", generatedDeclarationFiles: ["env.d.mts", ".gen/routes.d.cts"] }),
  );
});
