import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { FIXTURES, fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

const rule = (config, name) => config.forbidden.find((item) => item.name === name);
test("Next owns app, proxy, instrumentation, declarations and build exclusions", async () => {
  const ordinary = fromPaths(await violatedRules("next-app", layout({ scope: "@acme/" })));
  assert.deepEqual(ordinary, [
    "app-folders: apps/web/src/app/global-error.tsx",
    "app-folders: apps/web/src/app/page.tsx",
    "app-folders: apps/web/src/instrumentation.ts",
    "app-folders: apps/web/src/proxy.ts",
    "no-unresolved-imports: apps/web/.next/server/chunk.js -> ./missing-chunk",
    "no-unresolved-imports: apps/web/next-env.d.ts -> ./.next/types/routes.d.ts",
  ]);
  assert.deepEqual(await violatedRules("next-app", layout({ scope: "@acme/", host: "next" })), []);
});
test("Next page cannot use proxy as a bridge to module values", async () => {
  const violations = await violatedRules("next-bridge", layout({ scope: "@acme/", host: "next" }));
  assert.deepEqual(fromPaths(violations), [
    "ways-in-import-app-folders-only: apps/web/src/app/page.tsx -> apps/web/src/proxy.ts",
    "ways-in-import-contracts-only: apps/web/src/app/page.tsx -> apps/web/src/proxy.ts",
  ]);
});
test("Next route files and private folders get npm imports, but loose app files do not", async () => {
  const tree = JSON.parse(await readFile(path.join(FIXTURES, "next-routes/tree.json"), "utf8"));
  assert.deepEqual(await violatedRules(tree, layout({ scope: "@acme/", host: "next" })), []);

  const forbiddenImports = [
    ["workspace main", "import {Bookings} from '@example/bookings';"],
    ["non-kit house-rules main", "import {bindLogin} from '@house-rules/identity';"],
    ["Node builtin", "import {randomUUID} from 'node:crypto';"],
    ["SQL adapter", "import {PgClient} from '@effect/sql-pg';"],
    ["platform adapter", "import {NodeServices} from '@effect/platform-node';"],
  ];
  for (const [name, source] of forbiddenImports) {
    const violations = await violatedRules(
      { ...tree, "apps/web/src/app/kanban/page.tsx": source },
      layout({ scope: "@acme/", host: "next" }),
    );
    assert.ok(
      violations.some(({ rule: name }) => name === "ways-in-import-contracts-only"),
      `${name}: ${JSON.stringify(violations)}`,
    );
  }
  for (const [specifier, file] of [
    ["effect/sql/SqlClient", "apps/web/src/app/api/v1/tasks/route.ts"],
    ["effect/unstable/sql/SqlClient", "apps/web/src/app/_http/sql.ts"],
    ["@effect/platform-node", "apps/web/src/app/api/v1/tasks/route.ts"],
  ]) {
    const violations = await violatedRules(
      { ...tree, [file]: `import {SqlClient} from '${specifier}';` },
      layout({ scope: "@acme/", host: "next" }),
    );
    assert.ok(
      violations.some(({ rule: name }) => name === "ways-in-import-contracts-only"),
      `${specifier}: ${JSON.stringify(violations)}`,
    );
  }
  for (const file of [
    "apps/web/src/app/tasks/[id]/task-once.ts",
    "apps/web/src/app/tasks/task_once.ts",
    "apps/web/src/app/sitemap.helper.ts",
    "apps/web/src/app/robots.anything.ts",
  ]) {
    const loose = await violatedRules(
      { ...tree, [file]: "import React from 'react';" },
      layout({ scope: "@acme/", host: "next" }),
    );
    assert.ok(
      loose.some(({ rule: name }) => name === "ways-in-import-contracts-only"),
      `${file}: ${JSON.stringify(loose)}`,
    );
  }
  const nextPattern = layout({ scope: "@acme/", host: "next" }).forbidden.find(
    (item) =>
      item.name === "ways-in-import-contracts-only" && item.from.path.includes("page|layout"),
  ).from.path;
  assert.equal(new RegExp(nextPattern).test("apps/web/src/app/icon"), false);
  const routesOverride = layout({ scope: "@acme/", host: "next", layers: { waysIn: "routes" } });
  assert.deepEqual(
    await violatedRules(
      {
        ...Object.fromEntries(
          Object.entries(tree).filter(([file]) => !file.startsWith("apps/web/src/app/")),
        ),
        "apps/web/src/routes/tasks/page.tsx": "import React from 'react';",
        "apps/web/src/routes/tasks/route.ts": "import React from 'react';",
      },
      routesOverride,
    ),
    [],
  );
  const readModel = await violatedRules(
    {
      ...tree,
      "apps/web/src/app/kanban/page.tsx":
        "import {report} from '../../read-models/report/index.ts';",
    },
    layout({ scope: "@acme/", host: "next" }),
  );
  assert.ok(readModel.some(({ rule: name }) => name === "ways-in-do-not-import-read-model-values"));

  const withoutHost = await violatedRules(tree, layout({ scope: "@acme/" }));
  assert.deepEqual(
    withoutHost.map(({ rule: name }) => name),
    ["app-folders", "app-folders", "app-folders", "app-folders", "app-folders"],
  );
  assert.equal(
    rule(layout({ scope: "@acme/" }), "ways-in-import-contracts-only").from.pathNot[1],
    "^(apps/[^/]+/src)/ways-in/[^/]+/page/",
  );
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
    [
      "contract-entry-is-browser-safe",
      "features-do-not-import-outer-folders",
      "ways-in-import-app-folders-only",
      "ways-in-do-not-import-read-model-values",
      "ways-in-import-contracts-only",
      "ways-in-import-contracts-only",
      "ways-in-import-contracts-only",
      "ways-in-do-not-import-other-ways",
      "composition-does-not-import-ways-in",
      "no-unresolved-imports",
      "app-folders",
      "contract-entry-is-browser-safe",
    ],
  );
  assert.deepEqual(rule(next, "app-folders").module.pathNot.slice(0, 2), [
    "^apps/[^/]+/src/(?:features|read-models|app|composition)/",
    "^apps/[^/]+/src/(?:proxy[.]ts|instrumentation[.]ts)$",
  ]);
  assert.deepEqual(rule(next, "no-unresolved-imports").from, {
    pathNot: "^apps/[^/]+/(?:next-env[.]d[.]ts)$",
  });
  assert.equal(
    next.options.exclude.path,
    "^(?!.*node_modules/)(?:|.*/)(?:dist|coverage|generated|[.]turbo|[.]agent_sources|[.]next)(?:/|$)",
  );
  assert.deepEqual({ ...next.options, exclude: plain.options.exclude }, plain.options);
});
test("explicit area overrides win and host lists add to consumer lists", () => {
  const config = layout({
    scope: "@acme/",
    host: "next",
    layers: { waysIn: "pages" },
    appEntryFiles: ["proxy.ts", "sentry.server.config.ts"],
    generatedDeclarationFiles: ["src/routes.d.ts"],
  });
  assert.deepEqual(rule(config, "app-folders").module.pathNot.slice(0, 2), [
    "^apps/[^/]+/src/(?:features|read-models|pages|composition)/",
    "^apps/[^/]+/src/(?:proxy[.]ts|sentry[.]server[.]config[.]ts|instrumentation[.]ts)$",
  ]);
  assert.deepEqual(rule(config, "no-unresolved-imports").from, {
    pathNot: "^apps/[^/]+/(?:src/routes[.]d[.]ts|next-env[.]d[.]ts)$",
  });
});
test("Next omits generic main/index defaults unless named", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules("next-generic-entry", layout({ scope: "@acme/", host: "next" }))),
    ["app-folders: apps/web/src/index.ts", "app-folders: apps/web/src/main.ts"],
  );
  assert.deepEqual(
    fromPaths(await violatedRules("next-generic-entry", layout({ scope: "@acme/" }))),
    ["app-folders: apps/web/src/proxy.ts"],
  );
  assert.equal(
    rule(layout({ scope: "@acme/", host: "next", appEntryFiles: ["main.ts"] }), "app-folders")
      .module.pathNot[1],
    "^apps/[^/]+/src/(?:main[.]ts|proxy[.]ts|instrumentation[.]ts)$",
  );
});
test("unknown hosts still fail closed", () => {
  for (const host of ["remix", "Next", "", null, 1])
    assert.throws(
      () => layout({ scope: "@acme/", host }),
      /^TypeError: layout\(\): unknown host .*\. Known hosts: next\.$/u,
    );
});
test("composition may reach features/modules but never ways, including from tests", async () => {
  const violations = await violatedRules(
    "violations/composition-imports-packages-only",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "composition-does-not-import-ways-in: apps/web/src/composition/index.ts -> apps/web/src/ways-in/route.ts",
  ]);
});
test("nodes cannot reach composition, but their tests can", async () => {
  const violations = await violatedRules(
    "violations/use-cases-do-not-import-composition",
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(fromPaths(violations), [
    "features-do-not-import-outer-folders: apps/web/src/features/show/handler.ts -> apps/web/src/composition/index.ts",
  ]);
});
test("composition area rename updates both sides of the fence", () => {
  const config = layout({ scope: "@acme/", layers: { composition: "wiring" } });
  assert.equal(
    rule(config, "composition-does-not-import-ways-in").from.path,
    "^apps/[^/]+/src/wiring(?:/|$)",
  );
  assert.deepEqual(rule(config, "features-do-not-import-outer-folders").to, {
    path: ["^apps/[^/]+/src/ways-in(?:/|$)", "^apps/[^/]+/src/wiring(?:/|$)"],
    reachable: true,
  });
});
test("Next snapshot records the whole config", async () =>
  assert.deepEqual(
    layout({ scope: "@acme/", host: "next" }),
    JSON.parse(await readFile(path.join(FIXTURES, "layout-acme-next.snapshot.json"), "utf8")),
  ));
test("nodes area rename moves the node fence", async () => {
  const config = layout({ scope: "@acme/", layers: { features: "application" } });
  assert.equal(
    rule(config, "features-do-not-import-outer-folders").from.path,
    "^(apps/[^/]+/src/application/[^/]+)/",
  );
  const violations = await violatedRules("renamed-layers", config);
  assert.deepEqual(fromPaths(violations), [
    "features-do-not-import-outer-folders: apps/web/src/application/show/handler.ts -> apps/web/src/ways-in/route.ts",
  ]);
});
