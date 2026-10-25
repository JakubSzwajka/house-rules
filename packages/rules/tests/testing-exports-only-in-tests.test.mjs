import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const RULE = "house-rules/testing-exports-only-in-tests";
const PRODUCTION_FILE = "apps/web/src/composition/event-dispatcher.ts";

function lint(code, filename = PRODUCTION_FILE) {
  const messages = new Linter().verify(code, plugin.configs.features, { filename });
  assert.equal(
    messages.some((message) => message.fatal),
    false,
    messages.map((message) => message.message).join("\n"),
  );
  return messages
    .filter(({ ruleId }) => ruleId === RULE)
    .map(({ message, line }) => [message.split(" ")[0], line]);
}

test("flags named and aliased imports of a testing export", () => {
  const code = `import { EventLog, EventLogTesting } from "@board/event-log";
import { DbTesting as TestDb, Db } from "@board/db";
import { "QueueTesting" as Queue } from "@board/queue";
import { MigrationsTesting } from "../index.ts";
export const run = () => [EventLog, EventLogTesting, TestDb, Db, Queue, MigrationsTesting];`;
  assert.deepEqual(lint(code), [
    ["EventLogTesting", 1],
    ["DbTesting", 2],
    ["QueueTesting", 3],
    ["MigrationsTesting", 4],
  ]);
});

test("flags a testing export read through a namespace import", () => {
  const code = `import * as EventLogModule from "@board/event-log";
import * as Db from "@board/db";
export const stored = EventLogModule.EventLogTesting.storedPayloads(1n);
export const layer = Db["DbTesting"].layer({ label: "x" });
const { DbTesting: TestDb, Db: Live } = Db;
export const both = [TestDb, Live, Db.Db];`;
  assert.deepEqual(lint(code), [
    ["EventLogTesting", 3],
    ["DbTesting", 4],
    ["DbTesting", 5],
  ]);
});

test("flags a re-export of a testing export by package name", () => {
  const code = `export { EventLogTesting } from "@board/event-log";
export { DbTesting as TestDb, Db } from "@board/db";`;
  assert.deepEqual(lint(code, "packages/work/src/index.ts"), [
    ["EventLogTesting", 1],
    ["DbTesting", 2],
  ]);
});

test("a file that only imports a testing export, and exports no Testing value, fails", () => {
  const code = `import { MigrationsTesting } from "@house-rules/migrations";
export const makeDbTestingLayer = () => MigrationsTesting.database({ label: "db" });
export type DbTestingOptions = { label: string };
export { MigrationsTesting };`;
  assert.deepEqual(lint(code, "packages/db/src/test-database/testing.ts"), [
    ["MigrationsTesting", 1],
  ]);
});

test("a file that exports a Testing value of its own may build on testing exports", () => {
  for (const code of [
    `import { MigrationsTesting } from "@house-rules/migrations";
export const DbTesting = { layer: () => MigrationsTesting.database({ label: "db" }) };`,
    `import * as Migrations from "@house-rules/migrations";
const build = () => Migrations.MigrationsTesting.database({ label: "db" });
export { build as DbTesting };`,
    `import { MigrationsTesting } from "@house-rules/migrations";
export function QueueTesting() { return MigrationsTesting; }
export { DbTesting } from "@board/db";`,
  ]) {
    assert.deepEqual(lint(code, "packages/db/src/facade.ts"), [], code);
  }
});

test("a dummy Testing export does not launder a helper into production", () => {
  const files = {
    "packages/db/src/real.mjs": `export const DbTesting = { storedPayloads: () => "testing only" };`,
    "packages/db/src/bridge.mjs": `import { DbTesting } from "./real.mjs";
export const XTesting = {};
export const live = DbTesting;`,
    "packages/db/src/production.mjs": `import { live } from "./bridge.mjs";
export const observed = live.storedPayloads();`,
  };
  assert.deepEqual(
    Object.entries(files).map(([filename, code]) => [filename, lint(code, filename)]),
    [
      ["packages/db/src/real.mjs", []],
      ["packages/db/src/bridge.mjs", [["DbTesting", 1]]],
      ["packages/db/src/production.mjs", []],
    ],
  );
});

test("a file with any runtime export not named Testing is not testing code", () => {
  for (const tail of [
    "export const Db = {};",
    "export default DbTesting;",
    'export * from "./db.ts";',
    'export * as LiveTesting from "./db.ts";',
    "const live = 1;\nexport { live };",
    "export const { XTesting: QTesting, live } = { XTesting: 1, live: 2 };",
    "export function run() {}",
    "export class Store {}",
    'export { DbTesting as live } from "@board/db";',
  ]) {
    const code = `import { DbTesting } from "@board/db";
export const XTesting = () => DbTesting;
${tail}`;
    const names = lint(code, "packages/db/src/facade.ts").map(([name]) => name);
    assert.ok(names.includes("DbTesting"), tail);
  }
});

test("type exports neither qualify nor disqualify testing code", () => {
  const typeTail = `import { DbTesting } from "@board/db";
export const XTesting = () => DbTesting;
export type Live = string;
export interface Options { label: string }
export declare const ambient: string;
export type { Db } from "@board/db";
export type * from "./db.ts";`;
  assert.deepEqual(lint(typeTail, "packages/db/src/facade.ts"), []);
  const onlyTypes = `import { DbTesting } from "@board/db";
export type XTesting = typeof DbTesting;
export declare const YTesting: string;`;
  assert.deepEqual(lint(onlyTypes, "packages/db/src/facade.ts"), [["DbTesting", 1]]);
});

test("an erased namespace neither qualifies nor disqualifies testing code", () => {
  // Bypass: TypeScript erases this XTesting, so the bridge has no Testing value of its own.
  const bridge = `import { DbTesting } from "./real.js";
export namespace XTesting { export type Marker = string; }
DbTesting.storedPayloads();`;
  assert.deepEqual(lint(bridge, "packages/db/src/bridge.ts"), [["DbTesting", 1]]);
  for (const erased of [
    "export namespace XTesting {}",
    "export namespace XTesting { export interface I {} }",
    "export namespace XTesting { export namespace Inner { export type M = string; } }",
    'export namespace XTesting { import alias = Db.Db; }\nimport * as Db from "@board/db";',
    "export namespace A.BTesting { export type M = string; }",
    "export declare namespace XTesting { const value: string; }",
    "namespace XTesting { export type M = string; }\nexport { XTesting };",
    "type XTesting = string;\nexport { XTesting };",
  ]) {
    const code = `import { DbTesting } from "./real.js";\n${erased}\nDbTesting.storedPayloads();`;
    assert.deepEqual(lint(code, "packages/db/src/bridge.ts"), [["DbTesting", 1]], erased);
  }
  // False positive: Options is erased, so XTesting is the only runtime export.
  for (const erased of [
    "export namespace Options { export type Marker = string; }",
    "export declare namespace Options { const value: string; }",
    'declare global { interface Window { x: string } }\ndeclare module "@board/other" {}',
    "namespace Options { export type M = string; }\nexport { Options };",
    "interface Options {}\nexport { Options };",
  ]) {
    const code = `import { DbTesting } from "./real.js";\nexport const XTesting = () => DbTesting;\n${erased}`;
    assert.deepEqual(lint(code, "packages/db/src/facade.ts"), [], erased);
  }
});

test("a namespace that emits a value counts as a value export under its name", () => {
  for (const namespace of [
    "export namespace XTesting { export const helper = () => DbTesting; }",
    "export namespace XTesting { declare const ambient: string; }",
    "export namespace XTesting { export const enum Kind { A } }",
    "export namespace XTesting { export import alias = Db.Db; }",
    "export namespace XTesting.Inner { export const value = 1; }",
    "namespace XTesting { export const value = 1; }\nexport { XTesting };",
  ]) {
    const code = `import { DbTesting } from "./real.js";
import * as Db from "@board/db";
${namespace}`;
    assert.deepEqual(lint(code, "packages/db/src/facade.ts"), [], namespace);
  }
  for (const namespace of [
    "export namespace Live { export const value = 1; }",
    "export namespace Live.Inner { export const value = 1; }",
    "namespace Live { export const value = 1; }\nexport { Live };",
  ]) {
    const code = `import { DbTesting } from "./real.js";
export const XTesting = () => DbTesting;
${namespace}`;
    assert.deepEqual(lint(code, "packages/db/src/facade.ts"), [["DbTesting", 1]], namespace);
  }
});

test("flags a testing export read through a TypeScript import alias", () => {
  const files = {
    "packages/db/src/real.ts": `export class DbTesting { static storedPayloads() { return "testing only"; } }`,
    "packages/db/src/bridge.ts": `import * as Db from "./real.js";
export const XTesting = {};
export import live = Db.DbTesting;`,
    "packages/db/src/production.ts": `import { live } from "./bridge.js";
export const observed = live.storedPayloads();`,
  };
  assert.deepEqual(
    Object.entries(files).map(([filename, code]) => [filename, lint(code, filename)]),
    [
      ["packages/db/src/real.ts", []],
      ["packages/db/src/bridge.ts", [["DbTesting", 3]]],
      ["packages/db/src/production.ts", []],
    ],
  );
  const code = `import * as Db from "@board/db";
import live = Db.DbTesting;
import deep = Db.DbTesting.inner;
import Required = require("@board/db");
import again = Required;
import viaRequire = again.EventLogTesting;
Required.DbTesting;
const { QueueTesting } = again;
export { live, deep, viaRequire, QueueTesting };`;
  assert.deepEqual(lint(code), [
    ["DbTesting", 2],
    ["DbTesting", 3],
    ["EventLogTesting", 6],
    ["DbTesting", 7],
    ["QueueTesting", 8],
  ]);
  const passes = `import * as Db from "@board/db";
namespace Local { export const XTesting = 1; }
import local = Local.XTesting;
import type Types = require("@board/db");
export const values = [local, Db.Db];
export type T = Types.DbTesting;`;
  assert.deepEqual(lint(passes), []);
  // `export import XTesting = ...` passes a value on and does not make the file testing code.
  const passOn = `import * as Db from "@board/db";
export import XTesting = Db.DbTesting;`;
  assert.deepEqual(lint(passOn, "packages/db/src/facade.ts"), [["DbTesting", 2]]);
});

test("a destructured Testing export counts as the file's own", () => {
  for (const declaration of [
    "export const { XTesting } = { XTesting: () => DbTesting };",
    "export const { a: XTesting = DbTesting, ...RestTesting } = {};",
    "export const [XTesting, { b: YTesting = 1 }, ...RestTesting] = [DbTesting, {}];",
    "export let [, XTesting] = [0, DbTesting];",
  ]) {
    const code = `import { DbTesting } from "@board/db";
${declaration}`;
    assert.deepEqual(lint(code, "packages/db/src/facade.ts"), [], declaration);
  }
});

test("a re-export by path keeps the Testing name", () => {
  const code = `export { DbTesting as live } from "./db.ts";
export { EventLogTesting as default } from "../event-log.ts";
export { DbTesting } from "./db.ts";
export { DbTesting as TestDbTesting } from "./db.ts";
export { Db as DbTesting2, Db as live2 } from "./db.ts";`;
  const messages = new Linter()
    .verify(code, plugin.configs.features, { filename: "packages/db/src/index.ts" })
    .filter(({ ruleId }) => ruleId === RULE)
    .map(({ messageId, message, line }) => [messageId, message.split(".")[0], line]);
  assert.deepEqual(messages, [
    ["renamedTestingExport", "DbTesting is a testing export re-exported as live", 1],
    ["renamedTestingExport", "EventLogTesting is a testing export re-exported as default", 2],
  ]);
});

test("flags testing exports read through casts, const aliases, dynamic imports and require", () => {
  const code = `import * as Db from "@board/db";
(Db as typeof Db).DbTesting;
Db!["DbTesting"];
const alias = Db;
const again = alias;
alias.DbTesting;
again.DbTesting;
let x;
({ DbTesting: x } = Db);
({ DbTesting: x } = alias);
const { DbTesting: y } = await import("@board/db");
(await import(\`@board/db\`)).DbTesting;
const { DbTesting: z } = require("@board/db");
require("@board/db").DbTesting;
const mod = require("@board/db");
mod.DbTesting;
export const all = [x, y, z];`;
  assert.deepEqual(lint(code), [
    ["DbTesting", 2],
    ["DbTesting", 3],
    ["DbTesting", 6],
    ["DbTesting", 7],
    ["DbTesting", 9],
    ["DbTesting", 10],
    ["DbTesting", 11],
    ["DbTesting", 12],
    ["DbTesting", 13],
    ["DbTesting", 14],
    ["DbTesting", 16],
  ]);
});

test("passes reads it cannot name statically", () => {
  const code = `import * as Db from "@board/db";
import { createRequire } from "node:module";
let alias = Db;
alias = {};
alias.DbTesting;
const local = { DbTesting: 1 };
({ DbTesting: local.x } = local);
const require = createRequire(import.meta.url);
require("@board/db").DbTesting;
const viaResolve = await import(require.resolve("@board/db"));
viaResolve.DbTesting;
const name = "@board/db";
(await import(name)).DbTesting;
(await import(\`@board/\${name}\`)).DbTesting;
export const rest = [Db.Db];`;
  assert.deepEqual(lint(code), []);
});

test("a package index re-exports its own testing export by path", () => {
  const code = `export { Migrations } from "./migrations/migrations.ts";
export { MigrationsTesting, type TestDatabaseOptions } from "./test-database/test-database.ts";
export { EventLogTesting } from "../adapters/postgres/event-log-testing.ts";`;
  assert.deepEqual(lint(code, "packages/migrations/src/index.ts"), []);
});

test("passes type-only uses, other names, shadowed namespaces and test files", () => {
  const code = `import type { DbTesting } from "@board/db";
import { type EventLogTesting, EventLog } from "@board/event-log";
import { DbTestingOptions, Db as DbTesting2 } from "@board/db";
import * as Db from "@board/db";
export type { QueueTesting } from "@board/queue";
export { type CacheTesting } from "@board/cache";
export const live = [EventLog, DbTestingOptions, DbTesting2, Db.Db];
function inner(Db) {
  return Db.DbTesting;
}
const other = { DbTesting: 1 };
export const value = [inner, other.DbTesting];`;
  assert.deepEqual(lint(code), []);
});

test("test files may import testing exports, by the same paths the other checks name", () => {
  const code = `import { DbTesting } from "@board/db";
export { EventLogTesting } from "@board/event-log";
export const layer = DbTesting.layer({ label: "x" });`;
  for (const filename of [
    "apps/web/src/features/show/tests/support.ts",
    "packages/work/src/adapters/tests/support.ts",
    "packages/db/src/test/fixtures.ts",
    "src/__tests__/deep/x.ts",
    "tests/wiring.test.mjs",
    "src/thing.spec.tsx",
    "src/thing.test.js",
    `${process.cwd()}/packages/db/src/tests/db.test.ts`,
  ]) {
    assert.deepEqual(lint(code, filename), [], filename);
  }
  for (const filename of [
    "apps/web/src/composition/event-dispatcher.ts",
    "packages/db/src/testing/x.ts",
    "packages/db/src/test-database/testing.ts",
    "src/contest/x.ts",
    "src/x.tests.ts",
  ]) {
    assert.deepEqual(
      lint(code, filename),
      [
        ["DbTesting", 1],
        ["EventLogTesting", 2],
      ],
      filename,
    );
  }
});

test("the testing preset holds the rule, and the nodes preset includes it", () => {
  assert.equal(plugin.configs.testing.length, 1);
  assert.deepEqual(plugin.configs.testing[0].files, ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"]);
  assert.equal(plugin.configs.testing[0].plugins["house-rules"], plugin);
  assert.deepEqual(plugin.configs.testing[0].rules, { [RULE]: "error" });
  assert.equal(plugin.configs.features[0].rules[RULE], "error");
  assert.equal(
    plugin.configs.recommended.some((entry) => RULE in (entry.rules ?? {})),
    false,
  );
  const messages = new Linter().verify(
    'import { DbTesting } from "@board/db";\nexport const db = DbTesting;\n',
    plugin.configs.testing,
    { filename: PRODUCTION_FILE },
  );
  assert.deepEqual(
    messages.map(({ ruleId }) => ruleId),
    [RULE],
  );
  assert.match(
    plugin.rules["testing-exports-only-in-tests"].meta.messages.testingExport,
    /Import it only in a test file/,
  );
});
