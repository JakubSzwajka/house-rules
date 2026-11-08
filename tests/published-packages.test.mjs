import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseWorkflow, PR_PATHS } from "./publish-workflow-assertions.mjs";

const PUBLISHED = ["rules", "stack", "domain-postgres"];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const root = new URL("../", import.meta.url);
const workspaceManifests = () =>
  globSync(
    [
      "apps/*/package.json",
      "packages/*/package.json",
      "examples/*/apps/*/package.json",
      "examples/*/packages/*/package.json",
      "site/package.json",
    ],
    { cwd: root },
  ).map((path) => ({ path, pkg: JSON.parse(read(path)) }));

function targets(value) {
  if (typeof value === "string") return [value];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(targets);
  return [];
}

describe("published packages", () => {
  it("only @house-rules/rules, @house-rules/stack and @house-rules/domain-postgres are public", () => {
    const publicNames = workspaceManifests()
      .filter(({ pkg }) => pkg.private !== true)
      .map(({ pkg }) => pkg.name)
      .sort();
    assert.deepEqual(publicNames, [
      "@house-rules/domain-postgres",
      "@house-rules/rules",
      "@house-rules/stack",
    ]);
    assert.match(
      read("scripts/packed-consumer.mjs"),
      /^const PUBLISHED = \["rules", "stack", "domain-postgres"\];$/mu,
    );
  });

  for (const folder of PUBLISHED) {
    it(`packages/${folder} is public and names its folder for provenance`, () => {
      const pkg = JSON.parse(read(`packages/${folder}/package.json`));
      assert.equal(pkg.name, `@house-rules/${folder}`);
      assert.equal(pkg.publishConfig?.access, "public");
      assert.equal(pkg.repository?.url, "git+https://github.com/JakubSzwajka/house-rules.git");
      assert.equal(pkg.repository?.directory, `packages/${folder}`);
      assert.match(pkg.version, /^\d+\.\d+\.\d+$/u);
    });
  }

  for (const folder of ["stack", "domain-postgres"]) {
    it(`packages/${folder} ships dist/ and keeps src/ for the workspace`, () => {
      const pkg = JSON.parse(read(`packages/${folder}/package.json`));
      assert.ok(existsSync(new URL(`packages/${folder}/tsconfig.build.json`, root)));
      assert.equal(pkg.scripts.build, "tsc --project tsconfig.build.json");
      assert.equal(pkg.scripts.prepack, "pnpm run build");
      assert.deepEqual(
        pkg.files.filter((file) => !file.endsWith(".md")),
        ["dist"],
      );
      assert.deepEqual(pkg.exports, { ".": "./src/index.ts" });
      assert.deepEqual(Object.keys(pkg.publishConfig.exports), Object.keys(pkg.exports));
      for (const target of targets(pkg.publishConfig.exports)) {
        assert.match(target, /^\.\/dist\/index\.(?:js|d\.ts)$/u);
      }
    });
  }

  for (const folder of ["stack", "domain-postgres"]) {
    it(`packages/${folder} peers on exact Alchemy and Effect versions that the workspace uses`, () => {
      const { peerDependencies, devDependencies } = JSON.parse(
        read(`packages/${folder}/package.json`),
      );
      for (const [name, version] of Object.entries(peerDependencies)) {
        assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, name);
        assert.equal(devDependencies[name], version, name);
      }
      for (const { path, pkg } of workspaceManifests()) {
        for (const name of Object.keys(peerDependencies)) {
          const pin = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
          if (pin !== undefined) assert.equal(pin, peerDependencies[name], `${path} ${name}`);
        }
      }
    });
  }

  it("Node platform consumers pin the shared package to the same Effect version", () => {
    for (const { path, pkg } of workspaceManifests()) {
      const dependencies = { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
      if (!Object.hasOwn(dependencies, "@effect/platform-node")) continue;
      assert.equal(dependencies["@effect/platform-node"], dependencies.effect, path);
      assert.equal(dependencies["@effect/platform-node-shared"], dependencies.effect, path);
    }
  });

  it("every PR keeps the full CI gate without a duplicate publish verification", () => {
    const ci = parseWorkflow(read(".github/workflows/ci.yml"));
    assert.deepEqual(ci.on, { pull_request: null, push: { branches: ["main"] } });
    assert.deepEqual(ci.concurrency, {
      group: "ci-${{ github.ref }}",
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
    assert.equal(ci.jobs.check["timeout-minutes"], 30);
    const steps = ci.jobs.check.steps;
    for (const command of [
      "pnpm install --frozen-lockfile",
      "pnpm check",
      "pnpm test",
      "pnpm run packed-consumer",
      "pnpm --filter @house-rules/site build",
    ]) {
      const matches = steps.filter((step) => step.run === command);
      assert.equal(matches.length, 1, command);
      assert.equal(matches[0].if, undefined, command);
      assert.equal(matches[0]["continue-on-error"], undefined, command);
    }
    assert.deepEqual(steps.find((step) => step.run === "pnpm test").env, {
      TURBO_CONCURRENCY: "2",
    });
    assert.deepEqual(
      parseWorkflow(read(".github/workflows/publish.yml")).on.pull_request.paths,
      PR_PATHS,
    );
  });

  it("CI and publish verification always report slow tests without failing the job", () => {
    for (const [file, job] of [
      ["ci", "check"],
      ["publish", "verify"],
    ]) {
      const steps = parseWorkflow(read(`.github/workflows/${file}.yml`)).jobs[job].steps;
      const summary = steps.filter((step) => step.run === "node scripts/slow-tests.mjs");
      assert.equal(summary.length, 1);
      assert.equal(summary[0].if, "always()");
      assert.equal(summary[0]["continue-on-error"], true);
      assert.ok(steps.indexOf(summary[0]) > steps.findIndex((step) => step.run === "pnpm test"));
    }
  });
});
