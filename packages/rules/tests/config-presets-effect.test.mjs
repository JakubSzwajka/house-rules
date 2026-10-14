import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { withConsumer } from "./preset-consumer.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

// The root tsc is patched with the Effect language service, so a floating Effect still fails (TS377001)
// when web.json's DOM libs and bundler resolution come after effect.json in the extends array.
test("extends [effect.json, web.json] keeps the Effect diagnostics on the patched tsc", async () => {
  const stackRoot = path.resolve(repositoryRoot, "../..");
  const patchedTsc = path.join(stackRoot, "node_modules/.bin/tsc");
  const effectPackage = await realpath(path.join(stackRoot, "packages/domain/node_modules/effect"));
  const files = {
    "package.json": { type: "module" },
    "tsconfig.json": {
      extends: ["@house-rules/rules/tsconfig/effect.json", "@house-rules/rules/tsconfig/web.json"],
      compilerOptions: { types: [] },
      include: ["src"],
    },
    "src/clean.ts": [
      'import { Effect } from "effect";',
      'export const titles: string[] = [...document.querySelectorAll("h1")].map((node) => node.textContent ?? "");',
      "export const ready = Effect.succeed(titles);",
      "",
    ].join("\n"),
  };
  await withConsumer(
    files,
    async (run) => {
      assert.match(run(patchedTsc, ["--version"]).output, /effect-tsgo/);
      const clean = run(patchedTsc, ["--project", "tsconfig.json"]);
      assert.equal(clean.status, 0, clean.output);
    },
    { effect: effectPackage },
  );
  await withConsumer(
    {
      ...files,
      "src/floating.ts":
        'import { Effect } from "effect";\nexport const title: string = document.title;\nEffect.succeed(title);\n',
    },
    async (run) => {
      const result = run(patchedTsc, ["--project", "tsconfig.json"]);
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /floating\.ts\(3,1\): error TS377001/);
      assert.doesNotMatch(result.output, /clean\.ts/);
    },
    { effect: effectPackage },
  );
});
