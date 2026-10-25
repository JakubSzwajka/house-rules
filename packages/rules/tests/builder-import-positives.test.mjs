import assert from "node:assert/strict";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

it("keeps direct import renames and builder type queries but requires each real door", () => {
  const lint = (source) =>
    new Linter()
      .verify(source, plugin.configs.features, { filename: "apps/api/src/features/show/index.ts" })
      .filter((m) => m.ruleId === "house-rules/feature-builders");
  assert.deepEqual(
    lint(
      'import {defineFeature as feature} from "@house-rules/application/contract"; export const show = feature("show", {}); export type Builder = typeof feature;',
    ),
    [],
  );
  for (const [name, door] of [
    ["defineFeature", "@house-rules/application"],
    ["defineWay", "@house-rules/application/contract"],
    ["bindOperation", "@house-rules/application/contract"],
    ["defineOperation", "@house-rules/domain"],
    ["endpoint", "@house-rules/application"],
  ])
    assert.deepEqual(
      lint(`import {${name}} from "${door}"; ${name}({});`).map(({ ruleId, messageId }) => ({
        ruleId,
        messageId,
      })),
      [{ ruleId: "house-rules/feature-builders", messageId: "named" }],
    );
});
