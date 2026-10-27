import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { layout } from "../src/dependency-cruiser.cjs";
import {
  cruiseFixture,
  fromPaths,
  ruleNames,
  violatedRules,
} from "./dependency-cruiser-helpers.mjs";

const layoutBin = fileURLToPath(new URL("../bin/layout.mjs", import.meta.url));

// A package may declare one more entry, src/contract.ts, for browsers; these rules keep it honest.
test("the contract entry is fixed, and its rule follows every reachable import", () => {
  const rule = layout({
    scope: "@acme/",
    packagesDir: "libs",
    publicEntry: "src/main.ts",
  }).forbidden.find(({ name }) => name === "contract-entry-is-browser-safe");
  assert.deepEqual(rule.from, { path: "^libs/[^/]+/src/contract[.]ts$" });
  assert.equal(rule.severity, "error");
  assert.equal(rule.to.reachable, true);
});

test("packages-public-entry-only lets another workspace import a declared contract entry, and nothing else", async () => {
  assert.deepEqual(
    fromPaths(
      await violatedRules("violations/packages-public-entry-only", layout({ scope: "@acme/" })),
    ),
    [
      "packages-public-entry-only: apps/web/src/main.ts -> packages/a/src/private/secret.ts",
      "packages-public-entry-only: apps/web/src/main.ts -> packages/c/src/private/client.ts",
    ],
  );
});

test("contract-entry-is-browser-safe reports server code a contract entry reaches, directly or not", async () => {
  const violations = await violatedRules(
    "violations/contract-entry-is-browser-safe",
    layout({ scope: "@acme/" }),
  );
  // Another package's contract entry, the package's own subjects and effect stay allowed.
  assert.deepEqual(
    fromPaths(violations).map((line) => line.replace(/node_modules\/.*$/u, "node_modules/...")),
    [
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> fs",
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> node_modules/...",
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> packages/a/src/adapters/memory/booking-store.ts",
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> packages/a/src/facade.ts",
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> packages/a/src/storage.ts",
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> packages/b/src/index.ts",
    ],
  );
  assert.ok(
    violations.some(({ to }) => /node_modules\/pg\//u.test(to)),
    JSON.stringify(violations),
  );
});

test("contract-entry-is-browser-safe refuses effect's adapter imports", () => {
  const safe = layout({ scope: "@acme/" }).forbidden.find(
    (rule) => rule.name === "contract-entry-is-browser-safe",
  ).to.pathNot;
  const allowed = (source) => safe.some((pattern) => new RegExp(pattern, "u").test(source));
  const store = "node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist";
  assert.equal(allowed(`${store}/Schema.js`), true);
  assert.equal(allowed(`${store}/index.js`), true);
  assert.equal(allowed(`${store}/encoding/index.js`), true);
  for (const file of [
    "encoding.js",
    "encoding/Base64Url.js",
    "encoding/private.js",
    "encoding/internal/index.js",
    "encoding/index.js/extra",
    "encoding/index.d.ts",
    "internal/encoding/index.js",
  ])
    assert.equal(allowed(`${store}/${file}`), false, file);
  assert.equal(allowed(`${store}/http/index.js`), true);
  assert.equal(allowed(`${store}/http/HttpClient.js`), true);
  assert.equal(allowed(`${store}/sql/SqlClient.js`), false);
  assert.equal(allowed(`${store}/persistence/PersistedQueue.js`), false);
  assert.equal(allowed(`${store}/process/index.js`), false);
  assert.equal(allowed(`${store}/ai/index.js`), false);
  assert.equal(allowed(`${store}/unstable/http/index.js`), true);
  assert.equal(allowed(`${store}/unstable/http/HttpClient.js`), true);
  assert.equal(allowed(`${store}/unstable/sql/SqlClient.js`), false);
  assert.equal(allowed(`${store}/unstable/persistence/PersistedQueue.js`), false);
  assert.equal(allowed(`${store}/unstable/process/index.js`), false);
  assert.equal(allowed(`${store}/internal/schema/schema.js`), false);
  assert.equal(allowed("node_modules/@acme/x/src/contract.ts"), false);
  assert.equal(allowed("node_modules/@house-rules/application/src/contract.ts"), true);
  assert.equal(allowed("node_modules/@house-rules/application/src/index.ts"), false);
  assert.equal(allowed("node_modules/@house-rules/domain/src/contract.ts"), true);
  assert.equal(allowed("node_modules/@house-rules/domain/dist/contract.js"), true);
  assert.equal(allowed("node_modules/@house-rules/domain/src/index.ts"), false);
  assert.equal(allowed("node_modules/@house-rules/identity/src/contract.ts"), true);
  assert.equal(allowed("node_modules/@house-rules/identity/dist/contract.js"), true);
  assert.equal(allowed("node_modules/@house-rules/identity/dist/contract.d.ts"), true);
  assert.equal(allowed("node_modules/@house-rules/identity/dist/index.js"), false);
  assert.equal(allowed("node_modules/@house-rules/capability/src/contract.ts"), false);
  // Installed from the registry, the entry is its build in dist/.
  const built =
    "node_modules/.pnpm/@house-rules+application@0.13.1/node_modules/@house-rules/application";
  assert.equal(allowed(`${built}/dist/contract.js`), true);
  assert.equal(allowed(`${built}/dist/contract.d.ts`), true);
  assert.equal(allowed(`${built}/dist/index.js`), false);
  assert.equal(allowed(`${built}/dist/contract/contract.js`), false);
  assert.equal(allowed("node_modules/@acme/x/dist/contract.js"), false);
  assert.equal(allowed("node_modules/@acme/x/src/index.ts"), false);
  assert.equal(allowed("packages/a/src/booking/tests/booking.test.ts"), false);
  assert.equal(allowed("packages/a/src/booking/booking.ts"), true);
});

// Installed dependencies are not followed. Their browser contract trust is explicit.
test("contract-entry-is-browser-safe trusts only allowlisted effect modules and vouched-for installed contract entries", async () => {
  const lines = (violations) =>
    fromPaths(violations).map((line) => line.replace(/node_modules\/.*?node_modules\//u, ""));
  assert.deepEqual(
    lines(await violatedRules("contract-entry-imports", layout({ scope: "@acme/" }))),
    [
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> effect/dist/unstable/persistence/PersistedQueue.js",
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> effect/dist/unstable/process/index.js",
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> node_modules/@acme/installed/src/contract.ts",
    ],
  );
  assert.deepEqual(
    lines(
      await violatedRules(
        "contract-entry-imports",
        layout({ scope: "@acme/", trustedContractPackages: ["@acme/installed"] }),
      ),
    ),
    [
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> effect/dist/unstable/persistence/PersistedQueue.js",
      "contract-entry-is-browser-safe: packages/a/src/contract.ts -> effect/dist/unstable/process/index.js",
    ],
  );
  assert.throws(
    () => layout({ scope: "@acme/", trustedContractPackages: ["../escape"] }),
    /trustedContractPackages/u,
  );
});

test("installed identity contract is trusted, not its main door", async () => {
  const at = "packages/a/src/contract.ts";
  const tree = {
    "packages/a/package.json": '{"name":"@acme/a","exports":"./src/index.ts"}',
    [at]: 'export { bindLogin } from "@house-rules/identity/contract";',
  };
  assert.deepEqual(await violatedRules(tree, layout({ scope: "@acme/" })), []);
  const bad = await violatedRules(
    { ...tree, [at]: 'export { bindLogin } from "@house-rules/identity";' },
    layout({ scope: "@acme/" }),
  );
  assert.deepEqual(ruleNames(bad), ["contract-entry-is-browser-safe"]);
});

test("browser roots accept the exact public Effect encoding module through a package contract", async () => {
  const tree = {
    "packages/a/package.json": JSON.stringify({
      name: "@acme/a",
      exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
    }),
    "packages/a/src/index.ts": "export {};",
    "packages/a/src/contract.ts": 'export { cursor } from "./cursor/cursor-codec.js";',
    "packages/a/src/cursor/cursor-codec.ts":
      'import { Base64Url } from "effect/encoding"; export const cursor = Base64Url;',
    "apps/web/src/features/show/index.ts": 'export { cursor } from "@acme/a/contract";',
    "apps/web/src/features/index.ts": 'export { cursor } from "./show/index.js";',
    "apps/web/src/read-models/list/contract.ts": 'export { cursor } from "@acme/a/contract";',
    "apps/web/src/ways-in/http/endpoints.ts": 'export { cursor } from "@acme/a/contract";',
  };
  assert.deepEqual(await violatedRules(tree, layout({ scope: "@acme/" })), []);
  for (const source of [
    "effect/encoding/Base64Url",
    "effect/encoding/Hex",
    "effect/encoding/private",
    "effect/internal/encoding",
    "effect/sql",
    "effect/sql/SqlClient",
    "effect/unstable/sql/SqlClient",
    "effect/unstable/process",
    "@effect/sql-pg",
    "@effect/platform-node",
    "pg",
    "node:fs",
    "@house-rules/application",
  ]) {
    const violations = await violatedRules(
      { ...tree, "packages/a/src/cursor/cursor-codec.ts": `export * from "${source}";` },
      layout({ scope: "@acme/" }),
    );
    assert.ok(
      violations.some(({ rule }) => rule === "contract-entry-is-browser-safe"),
      `${source}: ${JSON.stringify(violations)}`,
    );
  }
});

const runLayoutBin = (config) =>
  cruiseFixture("contract-entry-exports", config, ({ workspace }) => {
    writeFileSync(
      path.join(workspace, ".dependency-cruiser.cjs"),
      `module.exports = ${JSON.stringify(config)};\n`,
    );
    return spawnSync(process.execPath, [layoutBin, "--cwd", workspace], { encoding: "utf8" });
  });

// The rules match the resolved file, so only the manifest shows what an exports key or pattern reaches.
test("house-rules-layout fails every export but . and ./contract, and any target but their own file", async () => {
  const { status, stderr } = await runLayoutBin(layout({ scope: "@acme/" }));
  assert.equal(status, 1, stderr);
  assert.match(stderr, /contract-entry-is-browser-safe: 7 package manifest\(s\)/u);
  assert.match(stderr, /packages\/a\/package\.json: "\.\/alias" is exported/u);
  assert.match(stderr, /packages\/b\/package\.json: "\.\/browser" is exported/u);
  assert.match(stderr, /packages\/c\/package\.json: "\.\/contract" points at src\/index\.ts/u);
  assert.doesNotMatch(stderr, /packages\/d\//u);
  // A pattern export reaches every src file, src/contract.ts and the facade included.
  assert.match(stderr, /packages\/e\/package\.json: "\.\/browser\/\*" is exported/u);
  assert.match(
    stderr,
    /packages\/f\/package\.json: "\." points at src\/facade\.ts, not src\/index\.ts/u,
  );
  assert.match(stderr, /packages\/g\/package\.json: "\.\/extra" is exported/u);
  // publishConfig.exports replaces exports on publish; its targets may be the build in dist/.
  assert.doesNotMatch(stderr, /packages\/h\//u);
  assert.match(
    stderr,
    /packages\/i\/package\.json: publishConfig\.exports "\.\/contract" points at dist\/facade\.js, not src\/contract\.ts or its build, dist\/contract\.js or dist\/contract\.d\.ts/u,
  );
  assert.match(
    stderr,
    /packages\/i\/package\.json: publishConfig\.exports "\.\/dist\/\*" is exported/u,
  );
  assert.match(stderr, /rules\/#contract-entry-is-browser-safe/u);
});

test("house-rules-layout reads the public entry from the config and skips excluded packages", async () => {
  const config = layout({ scope: "@acme/", publicEntry: "src/main.ts" });
  const base = layout({ scope: "@acme/" });
  base.options.exclude.path = `${base.options.exclude.path}|^packages/[a-fi]/`;
  const excluded = await runLayoutBin(base);
  assert.equal(excluded.status, 1, excluded.stderr);
  assert.match(excluded.stderr, /1 package manifest\(s\)/u);
  assert.match(excluded.stderr, /packages\/g\//u);
  const moved = await runLayoutBin(config);
  assert.match(
    moved.stderr,
    /packages\/d\/package\.json: "\." points at src\/index\.ts, not src\/main\.ts/u,
  );
});

test("package-root-files allows contract.ts, and subjects treat it as a barrel", async () => {
  assert.deepEqual(
    fromPaths(await violatedRules("contract-entry-layout", layout({ scope: "@acme/" }))),
    [
      "package-root-files: packages/a/src/contracts.ts",
      "subjects-do-not-import-package-root: packages/a/src/one/contract-user.ts -> packages/a/src/contract.ts",
    ],
  );
});
