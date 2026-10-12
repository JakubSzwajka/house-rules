import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import plugin from "../src/index.mjs";

test("configs.nextHost is one global-ignores block for .next and next-env.d.ts", () => {
  assert.deepEqual(plugin.configs.nextHost, [
    { name: "house-rules/next-host", ignores: ["**/.next/**", "**/next-env.d.ts"] },
  ]);
});

// ESLint ignores only node_modules and .git by default, so a Next app lints its build output and
// the generated next-env.d.ts unless the host block is spread in.
test("with configs.nextHost, ESLint skips Next's build output and generated declaration only", async () => {
  const app = await mkdtemp(path.join(os.tmpdir(), "house-rules-next-host-"));
  try {
    const files = {
      "apps/web/.next/server/chunk.js": "export const chunk = 1;\n",
      "apps/web/next-env.d.ts": '/// <reference types="next" />\n',
      "apps/web/src/app/page.tsx": "export const page = 1;\n",
      "apps/web/src/next-env.d.ts.bak.ts": "export const kept = 1;\n",
    };
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(app, file)), { recursive: true });
      await writeFile(path.join(app, file), text);
    }
    const linted = async (config) => {
      const eslint = new ESLint({ cwd: app, overrideConfigFile: true, overrideConfig: config });
      const results = await eslint.lintFiles(["."]);
      return results
        .map(({ filePath }) => path.relative(app, filePath).split(path.sep).join("/"))
        .sort();
    };
    const every = Object.keys(files).sort();
    assert.deepEqual(await linted(plugin.configs.recommended), every);
    assert.deepEqual(await linted([...plugin.configs.nextHost, ...plugin.configs.recommended]), [
      "apps/web/src/app/page.tsx",
      "apps/web/src/next-env.d.ts.bak.ts",
    ]);
  } finally {
    await rm(app, { recursive: true, force: true });
  }
});
