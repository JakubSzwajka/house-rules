import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const BUILT = ["capability", "migrations", "call-audit"];
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
      const extra = folder === "call-audit" ? ["migrations"] : [];
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

  it("call-audit peers on the capability version this repo ships", () => {
    assert.equal(
      manifest("call-audit").peerDependencies["@house-rules/capability"],
      manifest("capability").version,
    );
  });

  it("CI runs the packed consumer", () => {
    assert.match(read(".github/workflows/ci.yml"), /^\s+- run: pnpm run packed-consumer$/mu);
  });
});
