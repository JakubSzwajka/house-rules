import assert from "node:assert/strict";
import path from "node:path";

export function assertNextHost(app, tsc, { run, write, readJson, failure }) {
  // Each passing check of the installed Next host has a negative twin that must fail.
  const next = path.join(app, "next");
  const src = "apps/web/src";
  const useComposition = 'import { app } from "../composition/index";\n';
  write(next, {
    "tsconfig.json": { extends: "@house-rules/rules/tsconfig/next.json", include: [src] },
    "tsconfig.js.json": { extends: "@house-rules/rules/tsconfig/next.json", include: ["legacy"] },
    "legacy/legacy.js": "export const legacy = 1;\n",
    "legacy/use.ts": 'import { legacy } from "./legacy.js";\nexport const used = legacy;\n',
    ".dependency-cruiser.cjs":
      'module.exports = require("@house-rules/rules/dependency-cruiser").layout({ scope: "@consumer/", host: "next" });\n',
    "eslint.config.mjs":
      'import houseRules from "@house-rules/rules";\nexport default [...houseRules.configs.nextHost, ...houseRules.configs.recommended];\n',
    "eslint.design.config.mjs":
      'import houseRules from "@house-rules/rules";\nimport { shadcn } from "@house-rules/rules/shadcn";\nexport default [...houseRules.configs.nextHost, ...houseRules.configs.recommended, ...shadcn({ host: "next" })];\n',
    "eslint.plain.config.mjs":
      'import houseRules from "@house-rules/rules";\nexport default [...houseRules.configs.recommended];\n',
    "apps/web/package.json": { name: "@consumer/next-web", version: "0.0.0", private: true },
    "apps/web/next-env.d.ts":
      '/// <reference types="next" />\nimport "./.next/types/routes.d.ts";\n',
    "apps/web/.next/server/chunk.js": 'import "./missing-chunk.js";\n',
    [`${src}/composition/data.json`]: '{ "title": "Ready" }\n',
    [`${src}/composition/index.ts`]:
      'import data from "./data.json";\nimport { title } from "../read-models/items/index";\nexport const app = { title: data.title + title };\n',
    [`${src}/features/show-item/node.ts`]:
      'import { defineNode, NoInput } from "@house-rules/domain/contract";\nimport { Schema } from "effect";\nexport const showItem = defineNode("show_item", { description: "Show item.", input: NoInput, output: Schema.String, failure: Schema.Never, permission: null, readOnly: true });\n',
    [`${src}/features/show-item/handler.ts`]:
      'import { bindNode } from "@house-rules/application";\nimport { Effect } from "effect";\nimport { showItem } from "./node";\nexport const showItemHandler = bindNode(showItem, () => Effect.succeed("Ready"));\n',
    [`${src}/read-models/items/item/item.ts`]: 'export const title = "Private module value";\n',
    [`${src}/read-models/items/index.ts`]: 'export { title } from "./item/item";\n',
    [`${src}/read-models/items/adapters/memory/item.ts`]:
      'export const title = "Private adapter";\n',
    [`${src}/app/page.tsx`]: `${useComposition}import { showItem } from "../features/show-item/node";\nexport default function Page() {\n  return app.title + showItem.name;\n}\n`,
    [`${src}/app/global-error.tsx`]:
      '"use client";\nexport default function GlobalError() { return "Try again."; }\n',
    [`${src}/proxy.ts`]:
      'import { app } from "./composition/index";\nexport const proxy = () => app;\n',
    [`${src}/instrumentation.ts`]: "export const register = () => undefined;\n",
    [`${src}/composition/dispatcher.ts`]:
      'import { app } from "./index";\nexport const dispatch = () => app;\n',
    // Strict flags survive next.json: each expected error must still be there.
    [`${src}/features/show-item/tests/strict.ts`]:
      "const list: string[] = [];\n// @ts-expect-error noUncheckedIndexedAccess\nexport const first: string = list[0];\ntype Options = { title?: string };\n// @ts-expect-error exactOptionalPropertyTypes\nexport const options: Options = { title: undefined };\n",
  });
  run(tsc, ["--project", "tsconfig.json"], next);
  // next.json keeps allowJs off: an import of a .js file stays an untyped-module error.
  assert.match(
    failure(tsc, ["--project", "tsconfig.js.json"], next),
    /legacy\/use\.ts\(\d+,\d+\): error TS7016/u,
  );
  const depcruise = path.join(app, "node_modules/.bin/depcruise");
  const cruise = (type) => [depcruise, ["--config", ".dependency-cruiser.cjs", "-T", type, "apps"]];
  run(...cruise("err-long"), next);
  const eslint = path.join(app, "node_modules/.bin/eslint");
  const lintedFiles = (config, out) => {
    failure(eslint, ["-c", config, "-f", "json", "-o", out, "."], next);
    return readJson(path.join(next, out)).map((r) => path.relative(next, r.filePath));
  };
  const linted = lintedFiles("eslint.config.mjs", "lint.json");
  assert.ok(linted.includes(`${src}/app/page.tsx`), linted.join(", "));
  assert.ok(!linted.some((f) => /\.next\/|next-env\.d\.ts$/u.test(f)), linted.join(", "));
  // Findings make ESLint exit 1 and the negative twin lacks nextHost: only the linted files matter.
  const plain = lintedFiles("eslint.plain.config.mjs", "lint-plain.json");
  assert.ok(plain.includes("apps/web/.next/server/chunk.js"), plain.join());
  // Reject each forbidden graph at its own edge; composition may import read-model values.
  for (const target of ["read-models/items/index", "read-models/items/adapters/memory/item"]) {
    for (const hop of ["proxy", "app/reexport"]) {
      write(next, {
        [`${src}/proxy.ts`]:
          hop === "proxy"
            ? `export { title } from "./${target}";\n`
            : 'import { app } from "./composition/index";\nexport const proxy = () => app;\n',
        [`${src}/app/reexport.ts`]:
          hop === "app/reexport"
            ? `export { title } from "../${target}";\n`
            : 'export const title = "Ready";\n',
        [`${src}/app/page.tsx`]: `import { title } from "${hop === "proxy" ? "../proxy" : "./reexport"}";\nexport default function Page() { return title; }\n`,
      });
      const expected =
        hop === "proxy"
          ? `ways-in-import-app-folders-only: ${src}/app/page.tsx → ${src}/proxy.ts`
          : `ways-in-do-not-import-read-model-values: ${src}/app/reexport.ts → ${src}/${target}.ts`;
      assert.ok(failure(...cruise("err"), next).includes(expected), `${target}: ${expected}`);
    }
  }
  write(next, {
    [`${src}/app/reexport.ts`]: 'export const title = "Ready";\n',
    [`${src}/app/page.tsx`]:
      'import type { title } from "../read-models/items/index";\nexport default function Page(): typeof title { return "Private module value"; }\n',
  });
  run(...cruise("err-long"), next);
  run(tsc, ["--project", "tsconfig.json"], next);
  for (const file of ["global-error", "page"]) {
    const config = JSON.parse(
      run(
        eslint,
        ["-c", "eslint.design.config.mjs", "--print-config", `${src}/app/${file}.tsx`],
        next,
        { capture: true },
      ),
    );
    for (const rule of ["house-rules/design-no-raw-element", "shadcn/no-inline-styles"])
      assert.equal(config.rules[rule][0], file === "global-error" ? 0 : 2, `${file}: ${rule}`);
    assert.equal(config.rules["shadcn/no-raw-colors"][0], 2);
  }
}
