import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export async function verifyRoundThree({ ESLint, houseRules, root }) {
  const put = (file, code) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, code);
    return target;
  };
  put("package.json", '{"name":"round-three-consumer","private":true,"type":"module"}');
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: houseRules.configs.recommended,
  });
  const failures = [];
  const check = async (name, file, code, rejected = true) => {
    const [result] = await eslint.lintFiles([put(file, code)]);
    const expected = rejected
      ? result.messages.length > 0 &&
        result.messages.every(
          ({ ruleId, severity }) => ruleId === "house-rules/command-kind" && severity === 2,
        )
      : result.messages.length === 0;
    if (!expected) failures.push({ name, file, rejected, messages: result.messages });
    console.log(`physical recommended-only ${expected ? "PASS" : "FAIL"}: r3 ${name}`);
  };
  const feature = "apps/api/src/features/probe/index.ts";
  put(
    "apps/api/src/tests/forged.ts",
    'import { defineFeature } from "@house-rules/application/contract"; export const forged = defineFeature("forged", { flags: { readOnly: true } });',
  );
  put("apps/api/src/features/all.ts", 'export * from "../tests/forged.ts";');
  await check(
    "star barrel declaration",
    "apps/api/src/features/barrel.ts",
    'export * from "../tests/forged.ts";',
  );
  await check(
    "star barrel namespace aggregate",
    feature,
    'import * as all from "../all.ts"; export const Features = Object.values(all);',
  );
  await check(
    "star barrel namespace alias",
    feature,
    'import * as all from "../all.ts"; const entries = all; export const Features = Object.values(entries);',
  );
  put("apps/api/src/tests/safe.ts", 'export const value = 1; export { endpoint } from "foreign";');
  put("apps/api/src/features/safe.ts", 'export * from "../tests/safe.ts";');
  await check(
    "safe star declaration",
    "apps/api/src/features/safe-barrel.ts",
    'export * from "../tests/safe.ts";',
    false,
  );
  await check(
    "safe star namespace aggregate",
    feature,
    'import * as all from "../safe.ts"; export const values = Object.values(all);',
    false,
  );
  for (const [name, prelude, extension = "ts"] of [
    [
      "named Module",
      'import { Module } from "node:module"; const load = Module.createRequire(import.meta.url);',
    ],
    [
      "renamed Module",
      'import { Module as NodeModule } from "module"; const Factory = NodeModule; const load = Factory.createRequire(import.meta.url);',
    ],
    [
      "destructured Module",
      'import { Module } from "node:module"; const { createRequire: factory } = Module; const load = factory(import.meta.url);',
    ],
    [
      "builtin module",
      'const load = process.getBuiltinModule("node:module").createRequire(import.meta.url);',
    ],
    [
      "builtin module aliases",
      'const host = process; const { getBuiltinModule: builtin } = host; const nodeModule = builtin("module"); const { createRequire: factory } = nodeModule; const load = factory(import.meta.url);',
    ],
    ["main require", "const load = require.main.require;", "cjs"],
    ["main require aliases", "const main = require.main; const { require: load } = main;", "cjs"],
  ])
    for (const source of ["@house-rules/application/contract", "foreign"])
      await check(
        `${name} ${source}`,
        feature.replace(/ts$/u, extension),
        `${prelude} const { defineFeature: make } = load("${source}"); const probe = make("probe", { flags: { readOnly: true } });`,
        source !== "foreign",
      );
  for (const [name, code, extension = "ts"] of [
    [
      "foreign Module",
      'import { Module } from "foreign"; const load = Module.createRequire("x"); load("@house-rules/application/contract");',
    ],
    [
      "shadowed Module",
      'import { Module } from "node:module"; function local(Module) { return Module.createRequire("x")("@house-rules/application/contract"); }',
    ],
    [
      "shadowed process",
      'function local(process) { return process.getBuiltinModule("node:module").createRequire("x")("@house-rules/application/contract"); }',
    ],
    [
      "foreign process",
      'import process from "foreign"; process.getBuiltinModule("node:module").createRequire("x")("@house-rules/application/contract");',
    ],
    [
      "shadowed main require",
      'function local(require) { return require.main.require("@house-rules/application/contract"); }',
      "cjs",
    ],
    [
      "unrelated main require",
      'const require = { main: { require: local } }; require.main.require("@house-rules/application/contract");',
      "cjs",
    ],
  ])
    await check(name, feature.replace(/ts$/u, extension), code, false);
  assert.deepEqual(
    failures,
    [],
    "physical round three fixtures must match recommended-only policy",
  );
}
