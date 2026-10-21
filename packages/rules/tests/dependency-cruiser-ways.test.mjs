import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { violatedRules } from "./dependency-cruiser-helpers.mjs";

const base = JSON.parse(
  readFileSync(new URL("./fixtures/dependency-cruiser/v2-app/tree.json", import.meta.url), "utf8"),
);
const root = "apps/api/src/";
const rule = "ways-in-import-contracts-only";
const tree = {
  ...base,
  "packages/bookings/package.json": JSON.stringify({
    name: "@example/bookings",
    exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
  }),
  "packages/bookings/src/index.ts": "export const Bookings = {};",
  "packages/bookings/src/contract.ts": "export const Booking = {};",
  "node_modules/@house-rules/domain/package.json": JSON.stringify({
    name: "@house-rules/domain",
    exports: { ".": "./dist/index.js", "./contract": "./dist/contract.js" },
  }),
  "node_modules/@house-rules/domain/dist/index.js": "export const defineOperation = {};",
  "node_modules/@house-rules/domain/dist/contract.js": "export const Actor = {};",
};
for (const [name, source, extra = {}] of [
  ["workspace main", "import {Bookings} from '@example/bookings';"],
  ["installed main", "import {bindLogin} from '@house-rules/identity';"],
  ["installed unscoped main", "import {it} from 'test-runner';"],
  ["builtin", "import {readFile} from 'node:fs';"],
  [
    "value barrel",
    "import {Bookings} from './barrel.ts';",
    { [root + "ways-in/web/barrel.ts"]: "export {Bookings} from '@example/bookings';" },
  ],
  [
    "export-star barrel",
    "import * as bookings from './barrel.ts';",
    { [root + "ways-in/web/barrel.ts"]: "export * from '@example/bookings';" },
  ],
])
  it(`ways reject ${name}`, async () => {
    const violations = await violatedRules(
      { ...tree, ...extra, [root + "ways-in/web/way.ts"]: source },
      layout({ scope: "@acme/" }),
    );
    assert.ok(
      violations.some((v) => v.rule === rule),
      JSON.stringify(violations),
    );
    if (name.includes("barrel"))
      assert.ok(violations.some((v) => v.rule === rule && v.from.endsWith("/barrel.ts")));
  });

const allowed = [
  "import {Booking} from '@example/bookings/contract';",
  "import {bindLogin} from '@house-rules/identity/contract';",
  "import * as contract from '@acme/installed/contract';",
  "import type {Bookings} from '@example/bookings';",
  "import type {bindLogin} from '@house-rules/identity';",
  "import {Effect} from 'effect';",
  "import {May} from '@house-rules/application';",
  "import {endpoint} from '@house-rules/application/contract';",
  "import {defineOperation} from '@house-rules/domain';",
  "import {Actor} from '@house-rules/domain/contract';",
  "import {root} from '../../composition/index.ts';",
  "import {show} from '../../features/show/index.ts';",
  "import {Booking} from './barrel.ts';",
].join("\n");
it("ways allow contracts, main types, kits, effect, composition, features and own barrels", async () => {
  const good = {
    ...tree,
    [root + "ways-in/web/way.ts"]: allowed,
    [root + "ways-in/web/barrel.ts"]: "export {Booking} from '@example/bookings/contract';",
    [root + "ways-in/web/tests/way.test.ts"]: "import {Bookings} from '@example/bookings';",
  };
  assert.deepEqual(await violatedRules(good, layout({ scope: "@acme/" })), []);
  const custom = Object.fromEntries(
    Object.entries(good).map(([file, code]) => [
      file.replace(/^apps\//u, "examples/booking/apps/").replace("/ways-in/", "/pages/"),
      code.replaceAll("./ways-in/", "./pages/"),
    ]),
  );
  assert.deepEqual(
    await violatedRules(
      custom,
      layout({
        scope: "@acme/",
        appsDir: ["apps", "examples/*/apps"],
        layers: { waysIn: "pages" },
      }),
    ),
    [],
  );
});
it("workspace kits retain their value doors", async () => {
  for (const name of ["application", "domain"]) {
    const kit = {
      ...base,
      [`packages/${name}/package.json`]: JSON.stringify({
        name: `@house-rules/${name}`,
        exports: { ".": "./src/index.ts" },
      }),
      [`packages/${name}/src/index.ts`]: "export const kit = {};",
      [root + "ways-in/web/way.ts"]: `import {kit} from '@house-rules/${name}';`,
    };
    assert.deepEqual(await violatedRules(kit, layout({ scope: "@acme/" })), []);
  }
});
