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
  assertTarballRulesAreLive(work, root);
  console.log("packed consumer: tarballs, plain node, tsc, and layout rules pass");
} finally {
  if (process.env.KEEP === "1") console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

function assertContractRuleIsLive(app) {
  // A clean run proves nothing unless the same rule still refuses the server entry.
  write(app, {
    "packages/catalogue/src/contract.ts":
      'export { showItemContract } from "./item/show-item.ts";\nexport { implement } from "@house-rules/capability";\n',
  });
  let refused = "";
  try {
    run(
      path.join(app, "node_modules/.bin/depcruise"),
      ["--config", ".dependency-cruiser.cjs", "--output-type", "err", "apps", "packages"],
      app,
      { capture: true },
    );
  } catch (error) {
    refused = `${error.stdout}${error.stderr}`;
  }
  assert.match(
    refused,
    /contract-entry-is-browser-safe: packages\/catalogue\/src\/contract\.ts → node_modules\/@house-rules\/capability\/dist\/index\.js/u,
  );
}
