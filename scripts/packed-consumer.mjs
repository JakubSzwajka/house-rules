#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertCleanTarball, assertTarballRulesAreLive } from "./tarball-content.mjs";
import { assertNextHost } from "./packed-next-host.mjs";
import { assertPackedExpressHost, expressConsumerFiles } from "./packed-express-host.mjs";
import { workspaceConsumerFiles } from "./packed-workspace.mjs";
import {
  assertContractRuleIsLive,
  assertFrameworkContents,
  assertPackedComments,
  commentsConsumerFiles,
} from "./packed-comments.mjs";
import { assertPackedAuth, authConsumerFiles } from "./packed-auth.mjs";
import { SUPPORT_MODULES, supportImportLines } from "./packed-support-modules.mjs";

const root = path.resolve(import.meta.dirname, "..");
const PUBLISHED_IN_BUILD_ORDER = [
  "migrations",
  "domain",
  "application",
  "auth-jwt",
  "identity",
  "party",
  "call-audit",
  "comments",
  "node-host",
  "express-host",
  "rules",
  ...SUPPORT_MODULES,
];
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
  assertFrameworkContents(source, packed, files);
  if (source.publishConfig?.exports === undefined) return;
  assert.deepEqual(packed.exports, source.publishConfig.exports, `${source.name} exports`);
  for (const target of targets(source.publishConfig.exports)) {
    assert.ok(files.includes(target), `${source.name}: ${target} is missing from the tarball`);
  }
  assert.ok(!files.some((file) => file.startsWith("src/")), `${source.name} ships src/`);
  assert.ok(!files.some((file) => /(?:^|\/)tests\//u.test(file)), `${source.name} ships tests`);
}

const sourceState = () => ({
  head: run("git", ["rev-parse", "HEAD"], root, { capture: true }).trim(),
  status: run("git", ["status", "--porcelain=v1", "--untracked-files=all"], root, {
    capture: true,
  }).trim(),
});
const work = mkdtempSync(path.join(os.tmpdir(), "house-rules-consumer-"));
const proof = {
  command: `${process.env.KEEP === "1" ? "KEEP=1 " : ""}pnpm run packed-consumer`,
  cwd: root,
  node: process.version,
  startedAt: new Date().toISOString(),
  source: sourceState(),
  tarballs: {},
  exitCode: 1,
};
try {
  const packs = path.join(work, "packs");
  const tarballs = {};
  for (const folder of PUBLISHED_IN_BUILD_ORDER) {
    const out = run(
      "pnpm",
      ["pack", "--pack-destination", packs],
      path.join(root, "packages", folder),
      { capture: true },
    );
    const tarball = out.trim().split("\n").pop().trim();
    assert.match(tarball, /\.tgz$/u, `pnpm pack printed no tarball for ${folder}:\n${out}`);
    checkTarball(folder, tarball);
    const name = readJson(path.join(root, "packages", folder, "package.json")).name;
    tarballs[name] = tarball;
    const bytes = readFileSync(tarball);
    proof.tarballs[name] = {
      path: tarball,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    };
  }

  const pins = readJson(path.join(root, "package.json")).devDependencies;
  const effect = readJson(path.join(root, "packages/application/package.json")).peerDependencies
    .effect;
  const platformNode = readJson(path.join(root, "packages/migrations/package.json"))
    .devDependencies["@effect/platform-node"];
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
        "@effect/platform-node": platformNode,
        "@effect/platform-node-shared": effect,
      },
      devDependencies: {
        "@shadcn/lint": pins["@shadcn/lint"],
        "@swc/core": pins["@swc/core"],
        "dependency-cruiser": pins["dependency-cruiser"],
        eslint: pins.eslint,
      },
    },
    "run.mjs": `import assert from "node:assert/strict";
${supportImportLines()}
import * as domain from "@house-rules/domain";
import * as domainContract from "@house-rules/domain/contract";
import * as application from "@house-rules/application";
import * as contract from "@house-rules/application/contract";
import * as migrations from "@house-rules/migrations";
import * as callAudit from "@house-rules/call-audit";
import { NodeRuntime as NodePlatform, NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, Schema } from "effect";
assert.equal(typeof domain.defineOperation, "function");
assert.equal(typeof domain.errorKind, "function");
assert.equal(typeof application.bindOperation, "function");
assert.equal(typeof application.defineFeature, "function");
assert.equal(typeof application.defineWay, "function");
for (const name of ["implement", "defineContract", "Grant", "route", "toTool", "toMcpHandler", "mount", "problemView"])
  assert.equal(Object.hasOwn(application, name), false, name);
for (const name of ["defineContract", "toTool", "NoInput", "defineOperation", "errorKind"])
  assert.equal(Object.hasOwn(contract, name), false, name);
assert.equal(contract.defineFeature, application.defineFeature);
assert.equal(typeof domain.defineModule, "function");
for (const { name, main, contract } of supportPackages) {
  assert.ok(Object.keys(main).length > 0, name + " main entry exports");
  if (contract !== null) assert.ok(Object.keys(contract).length > 0, name + " contract entry exports");
}
assert.equal(domainContract.ActorId, domain.ActorId);
assert.equal(domainContract.UnitOfWorkFailed, domain.UnitOfWorkFailed);
assert.notEqual(migrations.Migrations, undefined);
assert.notEqual(callAudit.CallAudit, undefined);
const actor = domain.Actor.make({ id: domain.ActorId.make("cold") });
const state = { builds: 0, releases: 0, channel: "" };
const write = domain.defineOperation("cold_write_operation", {
  description: "Check installed transactions and Node services.",
  input: domain.NoInput, output: Schema.String, failure: Schema.Never,
  permission: null, transactional: true,
});
const feature = application.defineFeature("cold_write", {
  ...write, edges: [write], handler: (input, { call }) => call(write, input),
});
const binding = application.bindOperation(write, () => Effect.gen(function* () {
  yield* domain.UnitOfWork.required;
  return "stable";
}));
const features = [feature];
const who = { resolve: () => Effect.succeed(actor) };
const way = application.defineWay({ name: "web", path: "/", protocol: "http", features,
  endpoints: [application.endpoint(feature)], who, mean: application.Mean.no });
const ways = [way];
const lifecycle = Layer.effectDiscard(Effect.acquireRelease(
  Effect.sync(() => { state.builds++; }), () => Effect.sync(() => { state.releases++; })));
const watch = Layer.succeed(application.CallWatch, application.CallWatch.of({ around: (_entry, _input, work) => Effect.gen(function* () {
  state.channel = yield* application.CallChannel;
  return yield* work;
}) }));
const Probe = Context.Reference("cold/Probe", { defaultValue: () => ({}) });
const probeLayer = Layer.succeed(Probe, {});
const modules = { mounts: [{ service: Probe, operations: [write], bind: () => [binding], layer: probeLayer }],
  layer: Layer.mergeAll(application.StepTrace.layer(), domain.memoryUnitOfWork, lifecycle, watch) };
const layer = application.Runtime.layer({ mounts: modules.mounts, features, ways }).pipe(Layer.provideMerge(Layer.merge(probeLayer, modules.layer)));
const app = application.composition({ modules, features, ways, may: Effect.succeed(application.May.fixed([])), system: [] });
const router = application.toFetchHandler(app);
const incoming = { headers: new Headers(), url: "http://packed.test/" };
assert.equal(state.builds, 0);
try {
  const deniedWay = application.defineWay({ ...way, name: "denied", who: { resolve: () => Effect.fail(new application.Refused({ status: 401, code: "missing", message: "Sign in." })) } });
  const denied = application.composition({ modules, features, ways: [deniedWay], may: Effect.succeed(application.May.fixed([])), system: [] });
  try { assert.equal((await application.admit(denied, incoming, { way: "denied" })).ok, false); }
  finally { await denied.dispose(); }
  const admitted = await application.admit(app, incoming, { way: "web", channel: "api" });
  assert.equal(admitted.ok, true);
  if (!admitted.ok) throw new Error("Expected admission to succeed.");
  assert.deepEqual(await application.call(app, feature, {}, incoming, { way: "web", admitted: admitted.value }), { ok: true, value: "stable" });
  assert.equal(state.channel, "api");
  const response = await router(new Request("http://packed.test/cold_write", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
  assert.equal(response.status, 200);
  assert.equal(await response.json(), "stable");
  assert.equal(state.builds, 2);
} finally { await router.dispose(); await app.dispose(); }
assert.equal(state.releases, 2);
assert.equal((await router(new Request("http://packed.test/cold_write"))).status, 503);
assert.equal((await application.call(app, feature, {}, incoming, { way: "web" })).ok, false);
NodePlatform.runMain(Effect.gen(function* () {
  assert.equal(yield* (yield* FileSystem.FileSystem).exists("package.json"), true);
  const value = yield* application.runFeature(feature, {}).pipe(
    Effect.provideContext(application.May.context(application.May.fixed([]), { features, system: [], via: "node" })),
    Effect.provideService(application.CurrentActor, actor));
  assert.equal(value, "stable");
  yield* Effect.log("cold install: transactional feature, admission, in-process call, router, lazy build/disposal and Node services pass");
}).pipe(Effect.provide(Layer.merge(layer, NodeServices.layer))));
`,
    ...commentsConsumerFiles,
    ...authConsumerFiles,
    ...expressConsumerFiles,
    "rules.mjs": [
      'import assert from "node:assert/strict";',
      'import rules from "@house-rules/rules";',
      'assert.equal(typeof rules.rules["feature-file"], "object");',
      'assert.equal(typeof rules.rules["feature-builders"], "object");',
      'assert.equal(Object.hasOwn(rules.rules, "use-case-is-capability"), false);',
      'console.log("cold install: packed rules plugin loads in plain node");',
      "",
    ].join("\n"),
    "host.mjs": [
      'import assert from "node:assert/strict";',
      'import { serve } from "@house-rules/node-host";',
      'const host = await serve(async () => new Response("packed host"), { port: 0, hostname: "127.0.0.1" });',
      "try {",
      '  assert.equal(await (await fetch(host.url)).text(), "packed host");',
      "} finally { await host.close(); }",
      'console.log("cold install: packed Node host serves a real socket");',
      "",
    ].join("\n"),
    "tsconfig.json": {
      extends: "@house-rules/rules/tsconfig/effect.json",
      compilerOptions: { allowImportingTsExtensions: true },
      include: ["run.ts", "comments.ts", "auth.ts", "apps/**/*.ts", "packages/**/*.ts"],
    },
    "tsconfig.web.json": {
      extends: "@house-rules/rules/tsconfig/web.json",
      compilerOptions: { allowImportingTsExtensions: true },
      include: ["packages/catalogue/src/contract.ts"],
    },
    ".dependency-cruiser.cjs":
      'module.exports = require("@house-rules/rules/dependency-cruiser").layout({ scope: "@consumer/", trustedContractPackages: ["@house-rules/comments"] });\n',
    ...workspaceConsumerFiles,
  });

  write(app, { "run.ts": readFileSync(path.join(app, "run.mjs"), "utf8") });
  for (const lock of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
    assert.equal(existsSync(path.join(app, lock)), false, `cold consumer has ${lock}`);
  }
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--package-lock=false"],
    app,
  );
  run("npm", ["ls", "effect", "@effect/platform-node", "@effect/platform-node-shared"], app);
  const shared = readJson(path.join(app, "node_modules/@effect/platform-node-shared/package.json"));
  assert.equal(shared.version, effect, "cold install resolves the matching Node shared package");
  console.log(
    `cold install pair: effect ${effect}, platform-node/shared ${platformNode}; no input lockfile`,
  );
  run(process.execPath, ["--no-experimental-strip-types", "host.mjs"], app);
  run(process.execPath, ["--no-experimental-strip-types", "rules.mjs"], app);
  run(process.execPath, ["--no-experimental-strip-types", "run.mjs"], app);
  assertPackedComments(app, { run, write, failure });
  assertPackedAuth(app, { run });
  const tsc = path.join(root, "node_modules/.bin/tsc");
  assertPackedExpressHost(app, tsc, { run });
  run(tsc, ["--project", "tsconfig.json"], app);
  run(tsc, ["--project", "tsconfig.web.json"], app);
  run(
    path.join(app, "node_modules/.bin/depcruise"),
    ["--config", ".dependency-cruiser.cjs", "--output-type", "err-long", "apps", "packages"],
    app,
  );
  run(process.execPath, ["node_modules/@house-rules/rules/bin/layout.mjs"], app);

  assertContractRuleIsLive(app, { write, failure });
  assertNextHost(app, tsc, { run, write, readJson, failure });
  assertTarballRulesAreLive(work, root);
  console.log("packed consumer: tarballs, plain node, tsc, layout rules and the Next host pass");
  proof.exitCode = 0;
} finally {
  proof.finishedAt = new Date().toISOString();
  proof.sourceAfter = sourceState();
  write(work, { "proof.json": proof });
  console.log(
    `packed consumer exit: ${proof.exitCode}; metadata: ${path.join(work, "proof.json")}`,
  );
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
