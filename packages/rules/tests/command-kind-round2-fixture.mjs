import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
export async function verifyRoundTwo({ ESLint, houseRules, root }) {
  const put = (file, code) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, code);
    return target;
  };
  put("package.json", '{"name":"round-two-consumer","private":true,"type":"module"}');
  put("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "modules/*"\n');
  for (const kit of ["application", "domain"])
    put(`packages/${kit}/package.json`, JSON.stringify({ name: `@house-rules/${kit}` }));
  put("modules/bridge/package.json", '{"name":"@round/bridge","exports":{".":"./src/index.ts"}}');
  put("modules/bridge/src/index.ts", 'export * from "@house-rules/application/contract";');
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: houseRules.configs.recommended,
  });
  const failures = [];
  const check = async (name, file, code, rejected = true) => {
    const target = put(file, code);
    const [result] = await eslint.lintFiles([target]);
    const messages = result.messages;
    const expected = rejected
      ? messages.length > 0 &&
        messages.every(
          ({ ruleId, severity }) => ruleId === "house-rules/command-kind" && severity === 2,
        )
      : messages.length === 0;
    if (!expected) failures.push({ name, file, rejected, messages });
    console.log(`physical recommended-only ${expected ? "PASS" : "FAIL"}: ${name} (${file})`);
  };
  const kit = 'import { defineFeature } from "@house-rules/application/contract";';
  const call = 'make("probe", { flags: { readOnly: true } })';
  const command = `${kit} export const probe = defineFeature("probe", { flags: { readOnly: true } });`;
  const feature = "apps/api/src/features/probe/index.ts";
  for (const [name, body] of [
    [
      "operation-first",
      'const edge = defineOperation("edge", {}); return defineFeature(n, { ...o, edges: [edge] });',
    ],
    [
      "feature-first",
      'const feature = defineFeature(n, o); const edge = defineOperation("edge", {}); return feature;',
    ],
    [
      "nested-operation",
      'return defineFeature(n, { ...o, edges: [defineOperation("edge", {})] });',
    ],
  ]) {
    put(
      `apps/api/src/tests/${name}.ts`,
      `${kit} import { defineOperation } from "@house-rules/domain/contract"; export const make = (n, o) => { ${body} };`,
    );
    await check(
      `mixed wrapper ${name}`,
      feature,
      `import { make } from "../../tests/${name}.ts"; export const probe = ${call};`,
    );
  }
  for (const [name, file, from] of [
    ["src tests", "apps/api/src/tests/forged.ts", "../../tests/forged.ts"],
    ["workspace scripts", "apps/api/scripts/forged.ts", "../../../scripts/forged.ts"],
    ["root scripts", "scripts/forged.ts", "../../../../../scripts/forged.ts"],
  ]) {
    put(file, command.replace("probe", "forged"));
    await check(
      `finished descriptor ${name}`,
      feature,
      `import { forged } from "${from}"; export const probe = forged;`,
    );
    await check(
      `finished descriptor namespace ${name}`,
      feature,
      `import * as fixtures from "${from}"; export const probe = fixtures.forged;`,
    );
    await check(
      `finished descriptor re-export ${name}`,
      feature,
      `export { forged } from "${from}";`,
    );
    put(
      "apps/api/src/tests/barrel.ts",
      `export { forged } from "${path
        .relative(path.join(root, "apps/api/src/tests"), path.join(root, file))
        .split(path.sep)
        .join("/")
        .replace(/^(?!\.)/u, "./")}";`,
    );
    await check(
      `re-exported finished descriptor ${name}`,
      "apps/api/src/features/index.ts",
      'import { forged } from "../tests/barrel.ts"; export const Features = { forged };',
    );
  }
  for (const extension of ["js", "mjs", "cjs", "ts", "cts"])
    for (const [name, prelude] of [
      ["require", 'const { defineFeature: make } = require("@house-rules/application/contract");'],
      [
        "require template",
        "const { defineFeature: make } = require(`@house-rules/application/contract`);",
      ],
      ["require bridge", 'const { defineFeature: make } = require("@round/bridge");'],
      [
        "require sequence",
        'const { defineFeature: make } = (0, require)("@house-rules/application/contract");',
      ],
      [
        "require Reflect.apply",
        'const { defineFeature: make } = Reflect.apply(require, null, ["@house-rules/application/contract"]);',
      ],
      [
        "require alias",
        'const load = require; const { defineFeature: make } = load("@house-rules/application/contract");',
      ],
      [
        "require call",
        'const { defineFeature: make } = require.call(null, "@house-rules/application/contract");',
      ],
      [
        "require apply",
        'const { defineFeature: make } = require.apply(null, ["@house-rules/application/contract"]);',
      ],
      [
        "require bind",
        'const load = require.bind(null); const { defineFeature: make } = load("@house-rules/application/contract");',
      ],
      [
        "global require",
        'const { defineFeature: make } = globalThis.require("@house-rules/application/contract");',
      ],
      [
        "destructured require",
        'const { require: load } = module; const { defineFeature: make } = load("@house-rules/application/contract");',
      ],
      [
        "module require",
        'const { defineFeature: make } = module.require("@house-rules/application/contract");',
      ],
      [
        "createRequire rename",
        'import { createRequire as factory } from "node:module"; const load = factory(import.meta.url); const { defineFeature: make } = load("@house-rules/application/contract");',
      ],
      [
        "createRequire destructure",
        'import * as nodeModule from "node:module"; const { createRequire: factory } = nodeModule; const load = factory(import.meta.url); const { defineFeature: make } = load("@house-rules/application/contract");',
      ],
      [
        "require createRequire",
        'const { createRequire: factory } = require("node:module"); const load = factory(import.meta.url); const { defineFeature: make } = load("@house-rules/application/contract");',
      ],
      ["unknown require", "const { defineFeature: make } = require(source);"],
    ])
      await check(
        `${name} ${extension}`,
        feature.replace(/ts$/u, extension),
        `${prelude} const probe = ${call};`,
      );
  for (const [name, prelude] of [
    [
      "template import destructure",
      "const { defineFeature: make } = await import(`@house-rules/application/contract`);",
    ],
    [
      "template import namespace",
      "const kit = await import(`@house-rules/application/contract`); const make = kit.defineFeature;",
    ],
    ["template import bridge", "const { defineFeature: make } = await import(`@round/bridge`);"],
    [
      "dynamic createRequire",
      'const { createRequire: factory } = await import(`node:module`); const load = factory(import.meta.url); const { defineFeature: make } = load("@house-rules/application/contract");',
    ],
    ["unknown dynamic import", "const { defineFeature: make } = await import(source);"],
  ])
    await check(name, feature, `${prelude} export const probe = ${call};`);
  for (const extension of ["ts", "cts"])
    for (const [name, prelude] of [
      [
        "import equals",
        'import kit = require("@house-rules/application/contract"); const { defineFeature: make } = kit;',
      ],
      [
        "import equals bridge",
        'import kit = require("@round/bridge"); const { defineFeature: make } = kit;',
      ],
      [
        "import equals module",
        'import nodeModule = require("node:module"); const load = nodeModule.createRequire(import.meta.url); const { defineFeature: make } = load("@house-rules/application/contract");',
      ],
    ])
      await check(
        `${name} ${extension}`,
        feature.replace(/ts$/u, extension),
        `${prelude} const probe = ${call};`,
      );
  for (const file of [
    "scripts/probe.ts",
    "apps/api/scripts/probe.ts",
    "apps/api/src/tests/probe.ts",
    "apps/api/src/ways-in/tests/tests/probe.ts",
    "packages/application/src/probe.ts",
  ])
    await check(`genuine exception ${file}`, file, command, false);
  for (const file of [
    feature,
    "apps/api/src/ways-in/tests/way.ts",
    "apps/api/src/ways-in/test/way.ts",
    "apps/api/src/ways-in/tests/page/probe.ts",
  ])
    await check(`production scope ${file}`, file, command);
  put(
    "apps/api/src/operations.ts",
    'import { defineOperation } from "@house-rules/domain/contract"; export const finished = defineOperation("op", {});',
  );
  await check(
    "finished operation value loader",
    feature,
    'const { finished } = require("../../operations.ts");',
    false,
  );
  put("apps/api/src/features/valid/index.ts", command.replace("readOnly: true", "readOnly: false"));
  await check(
    "production command registry",
    "apps/api/src/features/index.ts",
    'import { probe } from "./valid/index.ts"; export const Features = { probe };',
    false,
  );
  await check(
    "production command re-export",
    "apps/api/src/features/index.ts",
    'export { probe } from "./valid/index.ts";',
    false,
  );
  await check(
    "literal false",
    feature,
    command.replace("readOnly: true", "readOnly: false"),
    false,
  );
  await check(
    "direct query",
    "apps/api/src/read-models/probe/index.ts",
    command
      .replace("defineFeature", "defineReadModel")
      .replace("defineFeature", "defineReadModel")
      .replace("flags: { readOnly: true }", "edges: []"),
    false,
  );
  for (const [name, code] of [
    ["foreign require", 'const { defineFeature: make } = require("foreign");'],
    [
      "shadowed Reflect",
      'function local(Reflect) { return Reflect.apply(require, null, ["@house-rules/application/contract"]); }',
    ],
    [
      "foreign require Reflect.apply",
      'const { defineFeature: make } = Reflect.apply(require, null, ["foreign"]);',
    ],
    ["foreign require call", 'const { defineFeature: make } = require.call(null, "foreign");'],
    ["foreign require apply", 'const { defineFeature: make } = require.apply(null, ["foreign"]);'],
    [
      "foreign required factory",
      'const { createRequire: factory } = require("foreign"); const load = factory(import.meta.url); load("@house-rules/application/contract");',
    ],
    ["foreign dynamic import", "const { defineFeature: make } = await import(`foreign`);"],
    [
      "shadowed require",
      'function local(require) { const { defineFeature: make } = require("@house-rules/application/contract"); return make("p", {}); }',
    ],
    [
      "shadowed module",
      'function local(module) { return module.require("@house-rules/application/contract"); }',
    ],
    [
      "foreign factory",
      'import { createRequire as factory } from "foreign"; const load = factory(import.meta.url); const { defineFeature: make } = load("@house-rules/application/contract");',
    ],
    [
      "shadowed factory",
      'import { createRequire } from "node:module"; function local(createRequire) { const load = createRequire("x"); return load("@house-rules/application/contract"); }',
    ],
    [
      "foreign import equals",
      'import kit = require("foreign"); const { defineFeature: make } = kit;',
    ],
    [
      "nonbuilder named kit value",
      'import { value } from "@house-rules/application/contract"; export const probe = value;',
    ],
  ])
    await check(name, feature, code, false);
  assert.deepEqual(
    failures,
    [],
    "physical round two fixtures must match the recommended-only policy",
  );
}
