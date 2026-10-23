import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { fromPaths, violatedRules } from "./dependency-cruiser-helpers.mjs";

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
for (const name of ["react", "radix-ui", "lucide-react"]) {
  for (const file of ["way.ts", "page/panel.tsx"]) {
    it(`third-party ${name} is allowed only inside a way page (${file})`, async () => {
      const violations = await violatedRules(
        {
          ...tree,
          [`node_modules/${name}/package.json`]: JSON.stringify({ name, main: "index.js" }),
          [`node_modules/${name}/index.js`]: "export const value = {};",
          [root + "ways-in/web/" + file]: `import {value} from '${name}';`,
        },
        layout({ scope: "@acme/" }),
      );
      assert.equal(
        violations.some((v) => v.rule === rule),
        file === "way.ts",
        JSON.stringify(violations),
      );
    });
  }
}
for (const specifier of [
  "@example/bookings",
  "@house-rules/identity",
  "node:fs",
  "@effect/sql-pg",
]) {
  it(`way pages still reject ${specifier}`, async () => {
    const violations = await violatedRules(
      {
        ...tree,
        "node_modules/@effect/sql-pg/package.json": JSON.stringify({
          name: "@effect/sql-pg",
          main: "index.js",
        }),
        "node_modules/@effect/sql-pg/index.js": "export const value = {};",
        [root + "ways-in/web/page/panel.tsx"]: `import * as value from '${specifier}';`,
      },
      layout({ scope: "@acme/" }),
    );
    assert.ok(
      violations.some((v) => v.rule === rule),
      JSON.stringify(violations),
    );
  });
}
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

// Effect's SQL modules sit inside the allowed `effect` package, so ways get their own refusal.
const effectStore = "node_modules/.pnpm/effect@4.0.0/node_modules/effect/dist/";
const sqlImports = [
  ["effect/sql", "import {sql} from 'effect/sql'; export {sql};", "sql/index.js"],
  [
    "effect/sql/SqlClient",
    "import {SqlClient} from 'effect/sql/SqlClient'; export {SqlClient};",
    "sql/SqlClient.js",
  ],
  [
    "a type from effect/sql/SqlError",
    "import type {SqlError} from 'effect/sql/SqlError'; export type Failure = SqlError;",
    "sql/SqlError.js",
  ],
  [
    "effect/unstable/sql/SqlClient",
    "import {SqlClient} from 'effect/unstable/sql/SqlClient'; export {SqlClient};",
    "unstable/sql/SqlClient.js",
  ],
];
const nextTree = { "apps/web/package.json": JSON.stringify({ name: "@acme/web" }) };
const hosts = [
  ["a plain host", { scope: "@acme/" }, tree, `${root}ways-in/web/way.ts`],
  ["a plain host page", { scope: "@acme/" }, tree, `${root}ways-in/web/page/panel.tsx`],
  ["host next", { scope: "@acme/", host: "next" }, nextTree, "apps/web/src/app/page.tsx"],
  ["host next route", { scope: "@acme/", host: "next" }, nextTree, "apps/web/src/app/api/route.ts"],
];
for (const [host, options, files, file] of hosts) {
  for (const [name, source, target] of sqlImports) {
    it(`ways under ${host} reject ${name}`, async () => {
      const violations = await violatedRules({ ...files, [file]: source }, layout(options));
      assert.deepEqual(fromPaths(violations), [`${rule}: ${file} -> ${effectStore}${target}`]);
    });
  }
  it(`ways under ${host} allow effect, effect/Schema and http`, async () => {
    const source = [
      "import {Effect} from 'effect';",
      "import {Schema} from 'effect/Schema';",
      "import {HttpClient} from 'effect/unstable/http/HttpClient';",
      "export const way = {Effect, Schema, HttpClient};",
    ].join("\n");
    assert.deepEqual(await violatedRules({ ...files, [file]: source }, layout(options)), []);
  });
}
it("ways reject effect SQL even when adapterImports leaves it out", async () => {
  const file = `${root}ways-in/web/sql.ts`;
  const violations = await violatedRules(
    { ...tree, [file]: sqlImports[1][1] },
    layout({ scope: "@acme/", adapterImports: ["@effect/sql-*"] }),
  );
  assert.deepEqual(fromPaths(violations), [`${rule}: ${file} -> ${effectStore}sql/SqlClient.js`]);
});
// A scoped adapterImports entry names both an installed package and a workspace one. Ways refuse
// both the same way: main types and contract values alike.
const driverPackages = {
  "packages/driver/package.json": JSON.stringify({
    name: "@acme/driver",
    exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
  }),
  "packages/driver/src/index.ts": "export const Driver = {};",
  "packages/driver/src/contract.ts": "export const Driver = {};",
  "packages/driver-tools/package.json": JSON.stringify({
    name: "@acme/driver-tools",
    exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
  }),
  "packages/driver-tools/src/index.ts": "export const Driver = {};",
  "packages/driver-tools/src/contract.ts": "export const Driver = {};",
};
const adapterImports = ["@effect/sql-*", "@acme/installed", "@acme/driver"];
const adapterDoors = [
  ["main type", "", "import type", "src/index.ts"],
  ["contract value", "/contract", "import", "src/contract.ts"],
  ["contract type", "/contract", "import type", "src/contract.ts"],
];
for (const [host, options, files, file] of hosts) {
  for (const [kind, name, folder] of [
    ["installed", "@acme/installed", "node_modules/@acme/installed/"],
    ["workspace", "@acme/driver", "packages/driver/"],
  ]) {
    for (const [door, subpath, keyword, target] of adapterDoors) {
      it(`ways under ${host} reject the ${kind} adapter package ${door}`, async () => {
        const source = `${keyword} {Driver} from '${name}${subpath}'; export {Driver};`;
        const violations = await violatedRules(
          { ...files, ...driverPackages, [file]: source },
          layout({ ...options, adapterImports }),
        );
        assert.deepEqual(fromPaths(violations), [`${rule}: ${file} -> ${folder}${target}`]);
      });
    }
  }
  it(`ways under ${host} keep non-adapter workspace contracts beside adapter packages`, async () => {
    const source = [
      "import {Driver} from '@acme/driver-tools/contract';",
      "import type {Driver as Main} from '@acme/driver-tools';",
      "export const way = {Driver}; export type Way = Main;",
    ].join("\n");
    assert.deepEqual(
      await violatedRules(
        { ...files, ...driverPackages, [file]: source },
        layout({ ...options, adapterImports }),
      ),
      [],
    );
  });
}
it("way tests and read-model adapters keep effect SQL", async () => {
  const fixture = {
    ...tree,
    [`${root}ways-in/web/tests/way.test.ts`]: sqlImports[1][1],
    [`${root}read-models/report/adapters/postgres/rows.ts`]: sqlImports[1][1],
    [`${root}read-models/report/adapters/postgres/statement.ts`]: sqlImports[0][1],
  };
  assert.deepEqual(await violatedRules(fixture, layout({ scope: "@acme/" })), []);
  assert.deepEqual(
    await violatedRules(fixture, layout({ scope: "@acme/", host: "next" })).then((found) =>
      found.filter(({ rule: name }) => name !== "app-folders"),
    ),
    [],
  );
});
// Features and read-model contract doors were already closed; these pin the rules that close them.
for (const [door, file, expected] of [
  ["feature index", `${root}features/show/index.ts`, "contract-entry-is-browser-safe"],
  [
    "read-model contract",
    `${root}read-models/report/contract.ts`,
    "adapter-imports-only-in-adapters",
  ],
]) {
  for (const [name, source] of [sqlImports[1], sqlImports[2]]) {
    it(`a ${door} importing ${name} fails ${expected}`, async () => {
      const violations = await violatedRules(
        { ...tree, [file]: `${source}\nexport const show = {}; export const report = {};` },
        layout({ scope: "@acme/" }),
      );
      assert.ok(
        violations.some((v) => v.rule === expected && v.from === file),
        JSON.stringify(violations),
      );
    });
  }
}
