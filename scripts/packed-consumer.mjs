#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertCleanTarball, assertTarballRulesAreLive } from "./tarball-content.mjs";

const root = path.resolve(import.meta.dirname, "..");
const PUBLISHED_IN_BUILD_ORDER = ["migrations", "capability", "call-audit", "rules"];
const ALLOWED_TOP = new Set(["package.json", "README.md", "AGENTS.md", "LICENSE"]);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const run = (command, args, cwd, options = {}) => {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, ...options.env },
  });
};
const write = (base, files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    writeFileSync(
      path.join(base, file),
      typeof text === "string" ? text : `${JSON.stringify(text, null, 2)}\n`,
    );
  }
};

function targets(value) {
  if (typeof value === "string") return [path.posix.normalize(value)];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(targets);
  return [];
}

function checkTarball(folder, tarball) {
  const source = readJson(path.join(root, "packages", folder, "package.json"));
  const files = run("tar", ["-tzf", tarball], root, { capture: true })
    .split("\n")
    .filter(Boolean)
    .map((file) => file.replace(/^package\//u, ""));
  const packed = JSON.parse(
    run("tar", ["-xzOf", tarball, "package/package.json"], root, { capture: true }),
  );
  assert.equal(packed.private, undefined, `${source.name} must not be private`);
  assert.doesNotMatch(
    JSON.stringify(packed),
    /"workspace:/u,
    `${source.name} ships a workspace: spec`,
  );
  const listed = new Set(source.files);
  for (const file of files) {
    const top = file.split("/")[0];
    assert.ok(
      ALLOWED_TOP.has(file) || listed.has(top) || listed.has(file),
      `${source.name} ships ${file}, which its files list does not name`,
    );
  }
  assertCleanTarball(source.name, tarball, root);
  if (source.publishConfig?.exports === undefined) return;
  assert.deepEqual(packed.exports, source.publishConfig.exports, `${source.name} exports`);
  for (const target of targets(source.publishConfig.exports)) {
    assert.ok(files.includes(target), `${source.name}: ${target} is missing from the tarball`);
  }
  assert.ok(!files.some((file) => file.startsWith("src/")), `${source.name} ships src/`);
  assert.ok(!files.some((file) => /(?:^|\/)tests\//u.test(file)), `${source.name} ships tests`);
}

const work = mkdtempSync(path.join(os.tmpdir(), "house-rules-consumer-"));
try {
  const packs = path.join(work, "packs");
  const tarballs = {};
  for (const folder of PUBLISHED_IN_BUILD_ORDER) {
    const out = run(
      "pnpm",
      ["pack", "--pack-destination", packs],
      path.join(root, "packages", folder),
      {
        capture: true,
      },
    );
    const tarball = out.trim().split("\n").pop().trim();
    assert.match(tarball, /\.tgz$/u, `pnpm pack printed no tarball for ${folder}:\n${out}`);
    checkTarball(folder, tarball);
    tarballs[readJson(path.join(root, "packages", folder, "package.json")).name] = tarball;
  }

  const pins = readJson(path.join(root, "package.json")).devDependencies;
  const effect = readJson(path.join(root, "packages/capability/package.json")).peerDependencies
    .effect;
  const app = path.join(work, "app");
  write(app, {
    "package.json": {
      name: "consumer",
      private: true,
      type: "module",
      workspaces: ["apps/*", "packages/*"],
      dependencies: {
        ...Object.fromEntries(
          Object.entries(tarballs).map(([name, file]) => [name, `file:${file}`]),
        ),
        effect,
      },
      devDependencies: {
        "@swc/core": pins["@swc/core"],
        "dependency-cruiser": pins["dependency-cruiser"],
        eslint: pins.eslint,
      },
    },
    "run.mjs": [
      'import assert from "node:assert/strict";',
      'import * as capability from "@house-rules/capability";',
      'import * as contract from "@house-rules/capability/contract";',
      'import * as migrations from "@house-rules/migrations";',
      'import * as callAudit from "@house-rules/call-audit";',
      'assert.equal(typeof capability.implement, "function");',
      'assert.equal(typeof contract.defineContract, "function");',
      "assert.equal(contract.defineContract, capability.defineContract);",
      "assert.notEqual(migrations.Migrations, undefined);",
      "assert.notEqual(callAudit.CallAudit, undefined);",
      'console.log("plain node: every entry loads");',
      "",
    ].join("\n"),
    "tsconfig.json": {
      extends: "@house-rules/rules/tsconfig/effect.json",
      compilerOptions: { allowImportingTsExtensions: true },
      include: ["apps/**/*.ts", "packages/**/*.ts"],
    },
    "tsconfig.web.json": {
      extends: "@house-rules/rules/tsconfig/web.json",
      compilerOptions: { allowImportingTsExtensions: true },
      include: ["packages/catalogue/src/contract.ts"],
    },
    ".dependency-cruiser.cjs":
      'module.exports = require("@house-rules/rules/dependency-cruiser").layout({ scope: "@consumer/" });\n',
    "packages/catalogue/package.json": {
      name: "@consumer/catalogue",
      version: "0.0.0",
      private: true,
      type: "module",
      exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
    },
    "packages/catalogue/src/item/show-item.ts": [
      'import { defineContract } from "@house-rules/capability/contract";',
      'import { Schema } from "effect";',
      "",
      'export class ItemNotFound extends Schema.TaggedError<ItemNotFound>()("ItemNotFound", {}) {}',
      "",
      'export const showItemContract = defineContract("show_item", {',
      '  description: "Show one catalogue item.",',
      "  input: Schema.Struct({ id: Schema.String }),",
      "  output: Schema.Struct({ id: Schema.String, title: Schema.String }),",
      "  failure: ItemNotFound,",
      '  permission: "public",',
      "  annotations: { readOnly: true },",
      "});",
      "",
      "// The shipped declarations carry real types: a wrong option must fail.",
      "// @ts-expect-error permission is required",
      'defineContract("no_permission", { description: "x", input: Schema.Struct({}), output: Schema.String, failure: ItemNotFound });',
      "",
    ].join("\n"),
    "packages/catalogue/src/contract.ts":
      'export { showItemContract } from "./item/show-item.ts";\n',
    "packages/catalogue/src/index.ts": 'export { showItemContract } from "./contract.ts";\n',
    "apps/web/package.json": {
      name: "@consumer/web",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: { "@consumer/catalogue": "0.0.0" },
    },
    "apps/web/src/main.ts": [
      'import { implement } from "@house-rules/capability";',
      'import { showItemContract } from "@consumer/catalogue";',
      'import { Effect } from "effect";',
      "",
      "export const showItem = implement(showItemContract, ({ id }) =>",
      '  Effect.succeed({ id, title: "A title" }),',
      ");",
      "",
    ].join("\n"),
  });

  run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--prefer-offline"], app);
  run(process.execPath, ["--no-experimental-strip-types", "run.mjs"], app);
  const tsc = path.join(root, "node_modules/.bin/tsc");
  run(tsc, ["--project", "tsconfig.json"], app);
  run(tsc, ["--project", "tsconfig.web.json"], app);
  run(
    path.join(app, "node_modules/.bin/depcruise"),
    ["--config", ".dependency-cruiser.cjs", "--output-type", "err-long", "apps", "packages"],
    app,
  );
  run(process.execPath, ["node_modules/@house-rules/rules/bin/layout.mjs"], app);

  assertContractRuleIsLive(app);
  assertNextHost(app, tsc);
  assertTarballRulesAreLive(work, root);
  console.log("packed consumer: tarballs, plain node, tsc, layout rules and the Next host pass");
} finally {
  if (process.env.KEEP === "1") console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

function failure(command, args, cwd) {
  try {
    run(command, args, cwd, { capture: true });
  } catch (error) {
    return `${error.stdout}${error.stderr}`;
  }
  return "";
}

function assertNextHost(app, tsc) {
  // Each passing check of the installed Next host has a negative twin that must fail.
  const next = path.join(app, "next");
  const src = "apps/web/src";
  const useComposition = 'import { app } from "../composition/index";\n';
  write(next, {
    "tsconfig.json": { extends: "@house-rules/rules/tsconfig/next.json", include: [src] },
    "tsconfig.web.json": {
      extends: "@house-rules/rules/tsconfig/web.json",
      include: [`${src}/composition`],
    },
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
    [`${src}/composition/legacy.js`]: "export const legacy = 1;\n",
    [`${src}/composition/index.ts`]:
      'import data from "./data.json";\nimport { legacy } from "./legacy.js";\nexport const app = { title: data.title, legacy };\n',
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
  // Without next.json, the same JS import fails to compile.
  assert.match(
    failure(tsc, ["--project", "tsconfig.web.json"], next),
    /composition\/index\.ts\(\d+,\d+\): error TS7016/u,
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

function assertContractRuleIsLive(app) {
  // A clean run proves nothing unless the same rule still refuses the server entry.
  write(app, {
    "packages/catalogue/src/contract.ts":
      'export { showItemContract } from "./item/show-item.ts";\nexport { implement } from "@house-rules/capability";\n',
  });
  assert.match(
    failure(
      path.join(app, "node_modules/.bin/depcruise"),
      ["--config", ".dependency-cruiser.cjs", "--output-type", "err", "apps", "packages"],
      app,
    ),
    /contract-entry-is-browser-safe: packages\/catalogue\/src\/contract\.ts → node_modules\/@house-rules\/capability\/dist\/index\.js/u,
  );
}
