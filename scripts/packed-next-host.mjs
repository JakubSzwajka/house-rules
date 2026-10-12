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
    "eslint.plain.config.mjs":
      'import houseRules from "@house-rules/rules";\nexport default [...houseRules.configs.recommended];\n',
    "apps/web/package.json": { name: "@consumer/next-web", version: "0.0.0", private: true },
    "apps/web/next-env.d.ts":
      '/// <reference types="next" />\nimport "./.next/types/routes.d.ts";\n',
    "apps/web/.next/server/chunk.js": 'import "./missing-chunk.js";\n',
    [`${src}/composition/data.json`]: '{ "title": "Ready" }\n',
    [`${src}/composition/index.ts`]:
      'import data from "./data.json";\nexport const app = { title: data.title };\n',
    [`${src}/use-cases/show-item.ts`]: "export const showItem = (id: string) => ({ id });\n",
    [`${src}/app/page.tsx`]: `${useComposition}import { showItem } from "../use-cases/show-item";\nexport default function Page() {\n  return showItem(app.title).id;\n}\n`,
    [`${src}/proxy.ts`]:
      'import { app } from "./composition/index";\nexport const proxy = () => app;\n',
    [`${src}/instrumentation.ts`]: "export const register = () => undefined;\n",
    [`${src}/server/dispatcher.ts`]: `${useComposition}export const dispatch = () => app;\n`,
    // Strict flags survive next.json: each expected error must still be there.
    [`${src}/use-cases/strict.ts`]:
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
  // A page that reaches the server through proxy.ts, an entry file, must fail.
  write(next, {
    [`${src}/proxy.ts`]: 'export { dispatch } from "./server/dispatcher";\n',
    [`${src}/app/page.tsx`]:
      'import { dispatch } from "../proxy";\nexport default function Page() {\n  return dispatch().title;\n}\n',
  });
  assert.match(
    failure(...cruise("err"), next),
    /delivery-does-not-import-server: apps\/web\/src\/app\/page\.tsx → apps\/web\/src\/server\/dispatcher\.ts/u,
  );
}
