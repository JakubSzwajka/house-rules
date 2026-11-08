import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { FIXTURES, fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

const rule = (config, name) => config.forbidden.find((item) => item.name === name);
test("Next owns declarations and build exclusions", async () => {
  const ordinary = fromPaths(await violatedRules("next-app", layout({ scope: "@acme/" })));
  assert.deepEqual(ordinary, [
    "no-unresolved-imports: apps/web/.next/server/chunk.js -> ./missing-chunk",
    "no-unresolved-imports: apps/web/next-env.d.ts -> ./.next/types/routes.d.ts",
  ]);
  assert.deepEqual(await violatedRules("next-app", layout({ scope: "@acme/", host: "next" })), []);
});
test("plain Node wiring still passes without a host", async () =>
  assert.deepEqual(await violatedRules("node-app", layout({ scope: "@acme/" })), []));
test("Next changes host-owned paths only and keeps every severity", () => {
  const plain = layout({ scope: "@acme/" });
  const next = layout({ scope: "@acme/", host: "next" });
  assert.deepEqual(layout({ scope: "@acme/", host: undefined }), plain);
  assert.deepEqual(
    next.forbidden.map(({ name, severity }) => [name, severity]),
    plain.forbidden.map(({ name, severity }) => [name, severity]),
  );
  assert.deepEqual(
    next.forbidden
      .filter((item, index) => JSON.stringify(item) !== JSON.stringify(plain.forbidden[index]))
      .map(({ name }) => name),
    ["no-unresolved-imports"],
  );
  assert.deepEqual(rule(next, "no-unresolved-imports").from, {
    pathNot: "^apps/[^/]+/(?:next-env[.]d[.]ts)$",
  });
  assert.equal(
    next.options.exclude.path,
    "^(?!.*node_modules/)(?:|.*/)(?:dist|coverage|generated|[.]turbo|[.]agent_sources|[.]next)(?:/|$)",
  );
  assert.deepEqual({ ...next.options, exclude: plain.options.exclude }, plain.options);
});
test("host declaration lists add to consumer lists", () => {
  const config = layout({
    scope: "@acme/",
    host: "next",
    generatedDeclarationFiles: ["src/routes.d.ts"],
  });
  assert.deepEqual(rule(config, "no-unresolved-imports").from, {
    pathNot: "^apps/[^/]+/(?:src/routes[.]d[.]ts|next-env[.]d[.]ts)$",
  });
});
test("unknown hosts still fail closed", () => {
  for (const host of ["remix", "Next", "", null, 1])
    assert.throws(
      () => layout({ scope: "@acme/", host }),
      /^TypeError: layout\(\): unknown host .*\. Known hosts: next\.$/u,
    );
});
test("Next snapshot records the whole config", async () =>
  assert.deepEqual(
    layout({ scope: "@acme/", host: "next" }),
    JSON.parse(await readFile(path.join(FIXTURES, "layout-acme-next.snapshot.json"), "utf8")),
  ));
