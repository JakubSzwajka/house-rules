import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const lint = (code, at = "composition/hook.ts") =>
  new Linter()
    .verify(code, plugin.configs.features, { filename: `apps/api/src/${at}` })
    .filter(({ ruleId }) => ruleId === "house-rules/feature-builders");
it("defines features only in their own feature index", () => {
  const code =
    'import {defineFeature as feature} from "@house-rules/application/contract"; export const show = feature("show", {});';
  assert.deepEqual(lint(code, "features/show/index.ts"), []);
  for (const file of [
    "composition/hook.ts",
    "read-models/show/index.ts",
    "features/index.ts",
    "features/show/extra.ts",
    "main.ts",
  ])
    assert.deepEqual(
      lint(code, file).map((m) => m.messageId),
      ["origin"],
      file,
    );
  assert.deepEqual(lint(code, "features/show/tests/show.test.ts"), []);
});
it("keeps operation builders outside all feature files, including the registry", () => {
  for (const [name, door] of [
    ["defineOperation", "@house-rules/domain/contract"],
    ["bindOperation", "@house-rules/application"],
  ]) {
    const code = `import {${name} as build} from "${door}"; build("show", {});`;
    for (const file of ["features/show/index.ts", "features/index.ts", "features/show/extra.ts"])
      assert.deepEqual(
        lint(code, file).map((m) => m.messageId),
        ["origin"],
        file,
      );
    assert.deepEqual(lint(code, "composition/modules.ts"), []);
    assert.deepEqual(lint(code, "features/show/tests/show.test.ts"), []);
  }
});
it("traces every exposure and start through imports, barrels and the Features registry", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "feature-origins-"));
  const files = {
    "features/show/index.ts":
      'import {defineFeature as feature} from "@house-rules/application/contract"; export const show = feature("show", {});',
    "features/index.ts":
      'import {show} from "./show/index.ts"; export const Features = {show} as const;',
    "composition/barrel.ts": 'export {show as exposed} from "../features/show/index.ts";',
    "composition/star.ts": 'export * from "./barrel.ts";',
    "composition/forged.ts":
      'export const forged = {...operation, kind: "feature", start: "person", closures: {person: [], system: []}, handler: () => Effect.void};',
    "read-models/fake/index.ts":
      'import {defineFeature} from "@house-rules/application/contract"; export const fake = defineFeature("fake", {});',
  };
  try {
    for (const [file, code] of Object.entries(files)) {
      const target = path.join(root, "apps/api/src", file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, code);
    }
    const prelude =
      'import {endpoint as at} from "@house-rules/application/contract"; import {defineWay as way, May as Access, runFeature as run} from "@house-rules/application"; import {Features} from "../features/index.ts"; import {exposed} from "./star.ts"; import {forged} from "./forged.ts"; import {fake} from "../read-models/fake/index.ts";';
    const doors = [
      (value) => `at(${value});`,
      (value) => `way({features:[${value}]});`,
      (value) => `Access.fixed([${value}], []);`,
      (value) => `Access.system([${value}]);`,
      (value) => `run(${value}, {});`,
    ];
    const run = (code) =>
      new Linter({ cwd: root })
        .verify(prelude + code, plugin.configs.features, {
          filename: path.join(root, "apps/api/src/composition/hook.ts"),
        })
        .filter((m) => m.ruleId === "house-rules/feature-builders");
    for (const door of doors) {
      for (const value of ["Features.show", "exposed"])
        assert.deepEqual(run(door(value)), [], door(value));
      for (const value of [
        "forged",
        "fake",
        "{}",
        '{...operation, kind: "feature"}',
        "operation",
        "unknown",
      ])
        assert.ok(
          run(door(value)).some((m) => m.messageId === "exposure"),
          door(value),
        );
    }
    for (const code of [
      "Access.fixed([...operations], []);",
      "Access.system([...operations]);",
      "way({features:[...operations]});",
      "const features = [forged]; Access.fixed(features, []);",
      "const features = [Features.show]; Access.system(features);",
    ]) {
      const messages = run(code);
      if (code.includes("Features.show")) assert.deepEqual(messages, [], code);
      else
        assert.ok(
          messages.some((m) => m.messageId === "exposure"),
          code,
        );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
