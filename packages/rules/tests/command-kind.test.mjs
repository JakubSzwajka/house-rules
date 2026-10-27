import assert from "node:assert/strict";
import path from "node:path";
import { it } from "node:test";
import { commandPath, queryPath, source, lint, rejects, root } from "./command-kind-fixture.mjs";

it("recommended alone rejects the original Trainer wrong-kind feature at error", async () => {
  await rejects(source("flags: { readOnly: true },"));
  for (const flags of [
    "",
    "flags: { readOnly: false },",
    "flags: { transactional: true, needsApproval: false },",
  ])
    assert.deepEqual(await lint(source(flags)), []);
  assert.deepEqual(await lint(source("", "defineReadModel"), queryPath), []);
  assert.deepEqual(await lint(source("", "defineReadModel"), queryPath, true), []);
});

it("ports unresolved, spread, computed and nonliteral flags and closes ambiguous objects", async () => {
  for (const flags of [
    "flags: unknownFlags,",
    "flags: { ...unknownFlags },",
    "flags: { [key]: true },",
    "flags: { readOnly: value },",
    "...unknownOptions,",
    "[key]: value,",
    'flags: { readOnly: "false" },',
    "flags: { readOnly: 0 },",
    "flags: { readOnly: null },",
    "flags: { readOnly: !true },",
    "flags: { get readOnly() { return false; } },",
    "get flags() { return {}; },",
    "flags: {}, flags: {},",
    "flags: { readOnly: false, readOnly: false },",
    "flags: { readOnly() { return false; } },",
    "flags: { ...{ readOnly: false } },",
    'flags: { ["readOnly"]: false },',
  ])
    await rejects(source(flags));
  for (const prelude of [
    "const options = { flags: { readOnly: false } };",
    'import options from "./unknown.ts";',
  ])
    await rejects(
      `${prelude}${source().replace("{ edges: [],  handler: () => null }", "options")}`,
    );
  for (const prelude of [
    "const flags = { readOnly: false };",
    'import { flags } from "./unknown.ts";',
  ])
    await rejects(`${prelude}${source("flags,")}`);
});

it("unwraps TypeScript assertions without resolving options or flag aliases", async () => {
  await rejects(source("flags: ({ readOnly: (true as const) } satisfies Flags),"));
  assert.deepEqual(await lint(source("flags: ({ readOnly: (false as const) } as Flags),")), []);
  await rejects(
    source().replace(
      "{ edges: [],  handler: () => null }",
      "({ flags: { readOnly: true } } as Options)",
    ),
  );
});

it("tracks kit builder identity through renames, aliases, namespace and barrel origins", async () => {
  for (const [prelude, callee] of [
    ['import { defineFeature as make } from "@house-rules/application/contract";', "make"],
    [
      'import { defineFeature } from "@house-rules/application"; const make = defineFeature;',
      "make",
    ],
    [
      'import { defineFeature } from "@house-rules/application/contract"; let make = defineFeature;',
      "make",
    ],
    ['import * as kit from "@house-rules/application/contract";', "kit.defineFeature"],
    ['import * as kit from "@house-rules/application/contract";', 'kit["defineFeature"]'],
    ['import { make } from "../../builders.ts";', "make"],
    ['import { defineFeature as make } from "@test/bridge";', "make"],
  ])
    await rejects(
      `${prelude} export const probe = ${callee}("probe", { flags: { readOnly: true } });`,
    );
});

for (const [name, code] of [
  ["call", 'defineFeature.call(null, "probe", { flags: { readOnly: true } })'],
  ["apply", 'defineFeature.apply(null, ["probe", { flags: { readOnly: true } }])'],
  ["bind", 'defineFeature.bind(null)("probe", { flags: { readOnly: true } })'],
  ["Reflect.apply", 'Reflect.apply(defineFeature, null, ["probe", { flags: { readOnly: true } }])'],
  ["sequence callee", '(0, defineFeature)("probe", { flags: { readOnly: true } })'],
])
  it(`recommended alone rejects ${name} builder escape`, async () => {
    await rejects(`import { defineFeature } from "@house-rules/application/contract"; ${code};`);
  });

it("recommended alone rejects destructured namespaces and dynamic builder imports", async () => {
  for (const code of [
    'import * as kit from "@house-rules/application/contract"; const { defineFeature: make } = kit;',
    'const { defineFeature: make } = await import("@house-rules/application/contract");',
    'const kit = await import("@house-rules/application/contract"); const make = kit.defineFeature;',
  ])
    await rejects(`${code} export const probe = make("probe", { flags: { readOnly: true } });`);
});

it("recommended alone rejects inherited flags in JS, MJS and TS options", async () => {
  for (const extension of ["js", "mjs", "ts"])
    for (const key of ["__proto__", '"__proto__"'])
      await rejects(
        source(`${key}: { flags: { readOnly: true } },`),
        commandPath.replace(/ts$/u, extension),
      );
});

it("recommended alone fences production calls to exempt test and tooling wrappers", async () => {
  for (const from of ["../../test/make.ts", "../../tests/make.ts", "../../../scripts/make.ts"])
    for (const flags of ["true", "false"])
      await rejects(
        `import { make } from "${from}"; export const probe = make("probe", { flags: { readOnly: ${flags} } });`,
      );
});

it("recommended alone follows declared workspace roots outside packages", async () => {
  await rejects(
    'import { make } from "@custom/bridge"; export const probe = make("probe", { flags: { readOnly: true } });',
  );
});

it("recommended alone enforces commands when ESLint cwd is inside src", async () => {
  const messages = await lint(
    source("flags: { readOnly: true },"),
    commandPath,
    false,
    path.join(root, "apps/api/src"),
  );
  assert.ok(
    messages.some(
      ({ ruleId, severity }) => ruleId === "house-rules/command-kind" && severity === 2,
    ),
    JSON.stringify(messages),
  );
  assert.deepEqual(
    await lint(
      source("flags: { readOnly: false },"),
      commandPath,
      false,
      path.join(root, "apps/api/src"),
    ),
    [],
  );
  assert.deepEqual(
    await lint(source("", "defineReadModel"), queryPath, false, path.join(root, "apps/api/src")),
    [],
  );
});

it("ignores unrelated APIs and shadowed imports", async () => {
  for (const prelude of [
    'import { defineFeature } from "foreign"; defineFeature.call(null, "p", {});',
    'import * as kit from "foreign"; const { defineFeature: make } = kit; make("p", {});',
    'const { defineFeature: make } = await import("foreign"); make("p", {});',
    'import * as kit from "@house-rules/application/contract"; function local(kit) { return kit.defineFeature("p", {}); }',
    'import { defineFeature } from "@house-rules/application/contract"; function local(defineFeature) { return defineFeature.call(null, "p", {}); }',
  ])
    assert.deepEqual(await lint(prelude), [], prelude);
  assert.deepEqual(
    await lint('import { defineFeature } from "foreign"; defineFeature("x", { flags: unknown });'),
    [],
  );
  assert.deepEqual(
    await lint('const defineFeature = () => null; defineFeature("x", { flags: unknown });'),
    [],
  );
  assert.deepEqual(
    await lint(
      'import { defineFeature } from "@house-rules/application/contract"; function local(defineFeature) { return defineFeature("x", { flags: unknown }); }',
    ),
    [],
  );
});

it("covers custom and nested production roots without treating workspace names as tests", async () => {
  for (const file of [
    "examples/booking/apps/api/src/features/probe/index.ts",
    "custom/web/src/features/probe/index.ts",
    "packages/tests/src/features/probe/index.ts",
    "apps/test/src/features/probe/index.ts",
    "apps/api/src/nested/features/probe/index.ts",
    "apps/api/src/scripts/probe.ts",
    "packages/foreign/src/features/probe/index.ts",
    "examples/foreign/modules/application/src/probe.ts",
    "apps/api/src/features/test/index.ts",
    "apps/api/src/features/tests/index.ts",
    "apps/api/src/read-models/test/command.ts",
  ])
    await rejects(source("flags: { readOnly: true },"), file);
  for (const file of [
    "packages/application/src/probe.ts",
    "packages/domain/src/probe.ts",
    "examples/kits/modules/application/src/probe.ts",
    "apps/api/src/features/probe/tests/probe.ts",
    "apps/api/src/test/probe.ts",
    "apps/api/src/__tests__/probe.ts",
    "apps/api/src/probe.spec.ts",
    "scripts/probe.ts",
    "apps/api/scripts/probe.ts",
    "tests/probe.ts",
  ])
    assert.deepEqual(await lint(source("flags: { readOnly: true },"), file), [], file);
});

it("retains wrong-kind placement, opposite registries, read-edge and forged exposure fences", async () => {
  for (const [code, file, expected] of [
    [
      source("", "defineReadModel"),
      commandPath,
      ["house-rules/feature-file", "house-rules/feature-builders"],
    ],
    [source(), queryPath, ["house-rules/feature-file", "house-rules/feature-builders"]],
    [
      'import { probe } from "../read-models/probe/index.ts"; export const Features = { probe };',
      "apps/api/src/features/index.ts",
      "house-rules/feature-file",
    ],
    [
      'import { probe } from "../features/probe/index.ts"; export const ReadModels = { probe };',
      "apps/api/src/read-models/index.ts",
      "house-rules/feature-file",
    ],
    [
      source("", "defineReadModel").replace("edges: []", "edges: [unknown]"),
      queryPath,
      "house-rules/feature-builders",
    ],
    [
      'import { endpoint } from "@house-rules/application/contract"; const forged = { kind: "read-model", readOnly: true }; export const route = endpoint(forged);',
      "apps/api/src/ways-in/web/endpoints.ts",
      "house-rules/feature-builders",
    ],
  ])
    for (const rule of Array.isArray(expected) ? expected : [expected])
      assert.ok(
        (await lint(code, file, true)).some(({ ruleId }) => ruleId === rule),
        `${rule}: ${code}`,
      );
});
