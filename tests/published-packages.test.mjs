import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assertPackedComments } from "../scripts/packed-comments.mjs";

const BUILT = ["capability", "migrations", "call-audit", "comments", "node-host"];
const PUBLISHED = [...BUILT, "rules"];
const DOCS = new Set(["AGENTS.md", "README.md"]);

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const manifest = (folder) => JSON.parse(read(`packages/${folder}/package.json`));

function targets(value) {
  if (typeof value === "string") return [value];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(targets);
  return [];
}

describe("published packages", () => {
  for (const folder of PUBLISHED) {
    it(`packages/${folder} is public and names its folder for provenance`, () => {
      const pkg = manifest(folder);
      assert.equal(pkg.private, undefined);
      assert.equal(pkg.publishConfig?.access, "public");
      assert.equal(pkg.repository?.url, "git+https://github.com/JakubSzwajka/house-rules.git");
      assert.equal(pkg.repository?.directory, `packages/${folder}`);
    });
  }

  for (const folder of BUILT) {
    it(`packages/${folder} ships dist/ and keeps src/ for the workspace`, () => {
      const pkg = manifest(folder);
      assert.ok(existsSync(new URL(`../packages/${folder}/tsconfig.build.json`, import.meta.url)));
      assert.equal(pkg.scripts.build, "tsc --project tsconfig.build.json");
      assert.equal(pkg.scripts.prepack, "pnpm run build");
      const extra = ["call-audit", "comments"].includes(folder) ? ["migrations"] : [];
      assert.deepEqual(
        pkg.files.filter((file) => !DOCS.has(file)),
        ["dist", ...extra],
      );
      for (const target of targets(pkg.exports)) assert.match(target, /^\.\/src\/[a-z]+\.ts$/u);
      const published = targets(pkg.publishConfig.exports);
      assert.ok(published.length > 0);
      for (const target of published) assert.match(target, /^\.\/dist\/[a-z]+\.(?:js|d\.ts)$/u);
      assert.deepEqual(Object.keys(pkg.publishConfig.exports), Object.keys(pkg.exports));
    });
  }

  it("comments and call-audit peer on capability 0.17.0 and Effect 4.0.3", () => {
    assert.equal(manifest("capability").version, "0.17.0");
    assert.equal(manifest("comments").version, "0.1.0");
    assert.equal(manifest("call-audit").version, "0.5.1");
    for (const folder of ["comments", "call-audit"]) {
      assert.deepEqual(manifest(folder).peerDependencies, {
        "@house-rules/capability": "0.17.0",
        effect: "4.0.3",
      });
      assert.equal(manifest(folder).houseRules.migrations, "migrations");
    }
  });

  it("Node platform consumers pin the shared package to the same Effect version", () => {
    const repoEffect = manifest("capability").peerDependencies.effect;
    const paths = globSync(
      ["apps/*/package.json", "packages/*/package.json", "site/package.json"],
      {
        cwd: new URL("../", import.meta.url),
      },
    );
    for (const path of paths) {
      const pkg = JSON.parse(read(path));
      const dependencies = {
        ...pkg.peerDependencies,
        ...pkg.optionalDependencies,
        ...pkg.devDependencies,
        ...pkg.dependencies,
      };
      if (!Object.hasOwn(dependencies, "@effect/platform-node")) continue;
      const effect = dependencies.effect ?? repoEffect;
      assert.equal(dependencies["@effect/platform-node"], effect, path);
      assert.equal(dependencies["@effect/platform-node-shared"], effect, path);
    }
  });

  it("packed comments helper failures escape to the consumer command", () => {
    const failure = new Error("comments process failed");
    assert.throws(
      () =>
        assertPackedComments("/unused", {
          run: () => {
            throw failure;
          },
        }),
      (error) => error === failure,
    );
    assert.match(
      read("scripts/packed-consumer.mjs"),
      /assertPackedComments\(app, \{ run, write, failure \}\);/u,
    );
  });

  it("CI runs the packed consumer", () => {
    assert.match(read(".github/workflows/ci.yml"), /^\s+- run: pnpm run packed-consumer$/mu);
  });
});
