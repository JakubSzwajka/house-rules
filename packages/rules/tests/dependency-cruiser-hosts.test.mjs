import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { FIXTURES, fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

const ruleByName = (config, name) => config.forbidden.find((rule) => rule.name === name);

// next-app: src/app/ pages, src/proxy.ts and src/instrumentation.ts, next-env.d.ts that imports
// .next build output that is not there, and a .next chunk with an import that does not resolve.
const NEXT_FILES_WITHOUT_HOST = [
  "app-code-in-layers: apps/web/src/app/global-error.tsx",
  "app-code-in-layers: apps/web/src/app/page.tsx",
  "app-code-in-layers: apps/web/src/instrumentation.ts",
  "app-code-in-layers: apps/web/src/proxy.ts",
  "no-unresolved-imports: apps/web/.next/server/chunk.js -> ./missing-chunk",
  "no-unresolved-imports: apps/web/next-env.d.ts -> ./.next/types/routes.d.ts",
];

test("a Next-shaped app needs no option or exclude with host: next", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules("next-app", layout({ scope: "@acme/" }))),
    NEXT_FILES_WITHOUT_HOST,
  );
  assert.deepEqual(await violatedRules("next-app", layout({ scope: "@acme/", host: "next" })), []);
});

test("with host: next, a page cannot reach the server through proxy.ts", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules("next-bridge", layout({ scope: "@acme/", host: "next" }))),
    [
      "delivery-does-not-import-server: apps/web/src/app/page.tsx -> apps/web/src/server/runtime.ts",
    ],
  );
});

// node-app is also the valid wiring a reachability rule must keep: main.ts imports composition,
// delivery and server; server and a use-case test import composition.
test("a plain Node app with a composition folder passes with no host", async () => {
  assert.deepEqual(await violatedRules("node-app", layout({ scope: "@acme/" })), []);
});

test("host: next changes only the delivery folder, entry files, generated declaration and exclude", () => {
  const plain = layout({ scope: "@acme/" });
  const next = layout({ scope: "@acme/", host: "next" });
  assert.deepEqual(layout({ scope: "@acme/", host: undefined }), plain);
  assert.deepEqual(
    next.forbidden.map(({ name }) => name),
    plain.forbidden.map(({ name }) => name),
  );
  const changed = next.forbidden
    .filter((rule, index) => JSON.stringify(rule) !== JSON.stringify(plain.forbidden[index]))
    .map(({ name }) => name);
  assert.deepEqual(changed, [
    "delivery-does-not-import-server",
    "server-does-not-import-delivery",
    "use-cases-do-not-import-outer-layers",
    "no-unresolved-imports",
    "app-code-in-layers",
  ]);
  assert.deepEqual(ruleByName(next, "app-code-in-layers").module.pathNot.slice(0, 2), [
    "^apps/[^/]+/src/(?:app|server|use-cases|composition)/",
    "^apps/[^/]+/src/(?:proxy[.]ts|instrumentation[.]ts)$",
  ]);
  assert.deepEqual(ruleByName(next, "no-unresolved-imports").from, {
    pathNot: "^apps/[^/]+/(?:next-env[.]d[.]ts)$",
  });
  assert.equal(
    next.options.exclude.path,
    "^(?!.*node_modules/)(?:|.*/)(?:dist|coverage|generated|[.]turbo|[.]agent_sources|[.]next)(?:/|$)",
  );
  assert.deepEqual({ ...next.options, exclude: plain.options.exclude }, plain.options);
});

test("host: next adds its files to the app's own lists, and the app's layers still win", () => {
  const config = layout({
    scope: "@acme/",
    host: "next",
    layers: { delivery: "pages" },
    appEntryFiles: ["proxy.ts", "sentry.server.config.ts"],
    generatedDeclarationFiles: ["src/routes.d.ts"],
  });
  assert.deepEqual(ruleByName(config, "app-code-in-layers").module.pathNot.slice(0, 2), [
    "^apps/[^/]+/src/(?:pages|server|use-cases|composition)/",
    "^apps/[^/]+/src/(?:proxy[.]ts|sentry[.]server[.]config[.]ts|instrumentation[.]ts)$",
  ]);
  assert.deepEqual(ruleByName(config, "no-unresolved-imports").from, {
    pathNot: "^apps/[^/]+/(?:src/routes[.]d[.]ts|next-env[.]d[.]ts)$",
  });
});

// next-generic-entry: a Next app with src/main.ts and src/index.ts next to its src/proxy.ts.
test("host: next drops the generic main.ts and index.ts unless the app names them", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules("next-generic-entry", layout({ scope: "@acme/", host: "next" }))),
    ["app-code-in-layers: apps/web/src/index.ts", "app-code-in-layers: apps/web/src/main.ts"],
  );
  assert.deepEqual(
    fromPaths(await violatedRules("next-generic-entry", layout({ scope: "@acme/" }))),
    ["app-code-in-layers: apps/web/src/proxy.ts"],
  );
  const named = layout({ scope: "@acme/", host: "next", appEntryFiles: ["main.ts"] });
  assert.equal(
    ruleByName(named, "app-code-in-layers").module.pathNot[1],
    "^apps/[^/]+/src/(?:main[.]ts|proxy[.]ts|instrumentation[.]ts)$",
  );
});

test("an unknown host throws and names the known hosts", () => {
  for (const host of ["remix", "Next", "", null, 1]) {
    assert.throws(
      () => layout({ scope: "@acme/", host }),
      /^TypeError: layout\(\): unknown host .*\. Known hosts: next\.$/u,
    );
  }
});

test("composition-imports-packages-only reports every app import from composition, tests included", async () => {
  const violations = await violatedRules(
    "violations/composition-imports-packages-only",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "composition-imports-packages-only: apps/web/src/composition/index.ts -> apps/web/src/delivery/route.ts",
    "composition-imports-packages-only: apps/web/src/composition/index.ts -> apps/web/src/server/loop.ts",
    "composition-imports-packages-only: apps/web/src/composition/index.ts -> apps/web/src/use-cases/show.ts",
    "composition-imports-packages-only: apps/web/src/composition/tests/app.test.ts -> apps/web/src/use-cases/show.ts",
  ]);
});

test("use-cases-do-not-import-composition reports a use-case, not its tests, delivery, server or app tests", async () => {
  const violations = await violatedRules(
    "violations/use-cases-do-not-import-composition",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "use-cases-do-not-import-composition: apps/web/src/use-cases/show.ts -> apps/web/src/composition/index.ts",
  ]);
});

test("layers.composition renames the composition folder", () => {
  const config = layout({ scope: "@acme/", layers: { composition: "wiring" } });
  assert.deepEqual(ruleByName(config, "composition-imports-packages-only").from, {
    path: "^apps/[^/]+/src/wiring(?:/|$)",
  });
  assert.deepEqual(ruleByName(config, "use-cases-do-not-import-composition").to, {
    path: "^apps/[^/]+/src/wiring(?:/|$)",
    reachable: true,
  });
});

// Refresh after an intentional rule change:
// node -e 'console.log(JSON.stringify(require("./src/dependency-cruiser.cjs").layout({ scope: "@acme/", host: "next" }), null, 2))' > tests/fixtures/dependency-cruiser/layout-acme-next.snapshot.json
test("layout() with host: next matches its snapshot", async () => {
  const snapshot = JSON.parse(
    await readFile(path.join(FIXTURES, "layout-acme-next.snapshot.json"), "utf8"),
  );
  assert.deepEqual(layout({ scope: "@acme/", host: "next" }), snapshot);
});

test("renaming layers.useCases moves the use-cases rules to the new folder", async () => {
  assert.deepEqual(fromPaths(await violatedRules("renamed-layers", layout({ scope: "@acme/" }))), [
    "app-code-in-layers: apps/web/src/application/show.ts",
  ]);
  assert.deepEqual(
    await violatedRules(
      "renamed-layers",
      layout({ scope: "@acme/", layers: { useCases: "application" } }),
    ),
    [
      {
        rule: "use-cases-do-not-import-outer-layers",
        from: "apps/web/src/application/show.ts",
        to: "apps/web/src/delivery/route.ts",
      },
    ],
  );
});
