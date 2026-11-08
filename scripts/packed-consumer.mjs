#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertCleanTarball, assertTarballRulesAreLive } from "./tarball-content.mjs";

const root = path.resolve(import.meta.dirname, "..");
const PUBLISHED = ["rules", "stack", "domain-postgres"];
const ALLOWED_TOP = new Set(["package.json", "README.md", "AGENTS.md", "LICENSE"]);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const run = (command, args, cwd, options = {}) => {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
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
  assert.doesNotMatch(JSON.stringify(packed), /"workspace:/u, `${source.name} ships workspace:`);
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
  assert.ok(files.includes("AGENTS.md"), `${source.name} ships no AGENTS.md`);
  assert.ok(!files.some((file) => file.startsWith("src/")), `${source.name} ships src/`);
}

const STACK_PROBE = `import * as Effect from "effect/Effect";
import { authorOf, CurrentActor, person, requirePermission, Roles, system } from "@house-rules/stack";
const permissions = await Effect.runPromise(
  Effect.gen(function* () {
    return (yield* Roles).permissionsOf(["member", "unknown"]);
  }).pipe(Effect.provide(Roles.layer({ member: ["notes:write"] }))),
);
assert.deepEqual(permissions, ["notes:write"]);
const write = Effect.map(requirePermission("notes:write"), authorOf);
assert.equal(await Effect.runPromise(Effect.provideService(write, CurrentActor, person("ann", { permissions }))), "ann");
assert.equal(
  await Effect.runPromise(Effect.provideService(write, CurrentActor, system("digest", ["notes:write"]))),
  "system:digest",
);
const refused = await Effect.runPromise(Effect.flip(Effect.provideService(write, CurrentActor, person("bob"))));
assert.equal(refused._tag, "Forbidden");
`;

const POSTGRES_PROBE = `import * as Layer from "effect/Layer";
import { fromEnv, layer, migrate, TablesMissing } from "@house-rules/domain-postgres";
assert.equal(Layer.isLayer(layer({ schema: "app" })), true);
assert.equal(Layer.isLayer(layer({ schema: "app", createTables: false })), true);
assert.equal(new TablesMissing({ schema: "app", missing: ["events"], message: "m" })._tag, "TablesMissing");
assert.equal(Layer.isLayer(fromEnv({ schema: "app" })), true);
assert.equal(typeof migrate, "function");
`;

const work = mkdtempSync(path.join(os.tmpdir(), "house-rules-consumer-"));
try {
  const packs = path.join(work, "packs");
  const tarballs = {};
  for (const folder of PUBLISHED) {
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
  const peers = readJson(path.join(root, "packages/stack/package.json")).peerDependencies;
  const app = path.join(work, "app");
  write(app, {
    "package.json": {
      name: "consumer",
      private: true,
      type: "module",
      dependencies: {
        ...Object.fromEntries(
          Object.entries(tarballs).map(([name, file]) => [name, `file:${file}`]),
        ),
        ...peers,
      },
      devDependencies: { "@swc/core": pins["@swc/core"], eslint: pins.eslint },
    },
    "stack.mjs": `import assert from "node:assert/strict";\n${STACK_PROBE}console.log("cold install: packed stack authorizes a person and a system actor");\n`,
    "stack.ts": `declare const assert: Record<"equal" | "deepEqual", (a: unknown, b: unknown) => void>;\n${STACK_PROBE}`,
    "postgres.mjs": `import assert from "node:assert/strict";\n${POSTGRES_PROBE}console.log("cold install: packed domain-postgres builds its layers");\n`,
    "postgres.ts": `declare const assert: Record<"equal", (a: unknown, b: unknown) => void>;\n${POSTGRES_PROBE}`,
    "rules.mjs": [
      'import assert from "node:assert/strict";',
      'import rules from "@house-rules/rules";',
      'assert.equal(typeof rules.rules["comment-discipline"], "object");',
      'console.log("cold install: packed rules plugin loads in plain node");',
      "",
    ].join("\n"),
    "tsconfig.json": {
      extends: "@house-rules/rules/tsconfig/effect.json",
      include: ["stack.ts", "postgres.ts"],
    },
  });
  for (const lock of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
    assert.equal(existsSync(path.join(app, lock)), false, `cold consumer has ${lock}`);
  }
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--package-lock=false"],
    app,
  );
  run(process.execPath, ["--no-experimental-strip-types", "rules.mjs"], app);
  run(process.execPath, ["--no-experimental-strip-types", "stack.mjs"], app);
  run(process.execPath, ["--no-experimental-strip-types", "postgres.mjs"], app);
  run(path.join(root, "node_modules/.bin/tsc"), ["--project", "tsconfig.json", "--noEmit"], app);
  assertTarballRulesAreLive(work, root);
  console.log(
    "packed consumer: rules, stack and domain-postgres tarballs install, load and typecheck cold",
  );
} finally {
  if (process.env.KEEP === "1") console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
