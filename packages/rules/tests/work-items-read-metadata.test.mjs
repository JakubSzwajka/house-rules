import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import houseRules, { featuresConfig } from "../src/index.mjs";
import { verifyReadMetadata } from "./work-items-read-metadata-fixture.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

test("proves all four real workspace WorkItems read edges and transitive tree, rejecting writes and unresolved edges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "work-items-workspace-"));
  try {
    const modules = path.join(root, "node_modules/@house-rules");
    await mkdir(modules, { recursive: true });
    await symlink(
      path.join(repositoryRoot, "packages/work-items"),
      path.join(modules, "work-items"),
      "dir",
    );
    const resolved = createRequire(path.join(root, "package.json")).resolve(
      "@house-rules/work-items/contract",
    );
    assert.equal(resolved, path.join(repositoryRoot, "packages/work-items/src/contract.ts"));
    console.log(`workspace public contract: ${resolved}`);
    await verifyReadMetadata({ ESLint, houseRules, featuresConfig, root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packs and installs the public WorkItems contract before checking metadata and physical read edges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "work-items-packed-"));
  const packs = path.join(root, "packs");
  const consumer = path.join(root, "consumer");
  try {
    await mkdir(packs);
    await mkdir(consumer);
    const dependencies = {};
    for (const folder of ["domain", "application", "work-items", "rules"]) {
      execFileSync("pnpm", ["pack", "--pack-destination", packs], {
        cwd: path.join(repositoryRoot, "packages", folder),
        stdio: "pipe",
      });
      const archive = (await readdir(packs)).find((file) =>
        file.startsWith(`house-rules-${folder}-`),
      );
      assert.ok(archive, `Missing ${folder} archive`);
      const tarball = path.join(packs, archive);
      dependencies[`@house-rules/${folder}`] = `file:${tarball}`;
      console.log(
        `packed ${folder}: ${tarball} sha256=${createHash("sha256")
          .update(await readFile(tarball))
          .digest("hex")}`,
      );
    }
    const rulesManifest = JSON.parse(
      await readFile(path.join(repositoryRoot, "packages/rules/package.json"), "utf8"),
    );
    const workItemsManifest = JSON.parse(
      await readFile(path.join(repositoryRoot, "packages/work-items/package.json"), "utf8"),
    );
    dependencies.eslint = rulesManifest.devDependencies.eslint;
    dependencies.effect = workItemsManifest.peerDependencies.effect;
    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify({
        name: "work-items-packed-consumer",
        private: true,
        type: "module",
        dependencies,
      }),
    );
    await writeFile(
      path.join(consumer, "work-items-read-metadata-fixture.mjs"),
      await readFile(new URL("./work-items-read-metadata-fixture.mjs", import.meta.url)),
    );
    await writeFile(
      path.join(consumer, "verify.mjs"),
      `import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { Schema } from "effect";
import houseRules, { featuresConfig } from "@house-rules/rules";
import * as contract from "@house-rules/work-items/contract";
import { assertReadMetadata, verifyReadMetadata } from "./work-items-read-metadata-fixture.mjs";
const resolved = fileURLToPath(import.meta.resolve("@house-rules/work-items/contract"));
assert.equal(realpathSync(resolved), resolved);
assert.match(resolved, /node_modules\\/@house-rules\\/work-items\\/dist\\/contract[.]js$/u);
console.log("installed public contract: " + resolved);
assertReadMetadata({ Schema, contract });
console.log("packed descriptor metadata: all four equivalent");
await verifyReadMetadata({ ESLint, houseRules, featuresConfig, root: process.cwd() });
`,
    );
    execFileSync(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"],
      { cwd: consumer, stdio: "pipe" },
    );
    try {
      process.stdout.write(
        execFileSync(process.execPath, ["verify.mjs"], {
          cwd: consumer,
          encoding: "utf8",
          stdio: "pipe",
        }),
      );
    } catch (error) {
      process.stdout.write(error.stdout ?? "");
      process.stderr.write(error.stderr ?? "");
      throw error;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
