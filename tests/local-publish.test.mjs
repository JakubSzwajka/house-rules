import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  localRegistry,
  localVersion,
  npmPublishArgs,
  rewriteManifest,
  selectPackages,
  shouldRefuseDirty,
} from "../scripts/local-publish.mjs";

const instant = new Date("2026-10-25T12:34:56.789Z");

test("local versions share a UTC millisecond timestamp and retain the base version", () => {
  assert.equal(localVersion("0.19.0", instant), "0.19.0-local.20261025123456789");
  assert.equal(
    localVersion("1.2.3", new Date("2026-10-25T14:34:56.789+02:00")),
    "1.2.3-local.20261025123456789",
  );
  for (const version of ["1.2", "1.2.3-next.1", "workspace:1.2.3"]) {
    assert.throws(() => localVersion(version, instant), /stable package version/u);
  }
});

test("packed pins become exact local versions without mutating the source", () => {
  const source = {
    name: "@house-rules/application",
    version: "0.2.0",
    dependencies: { "@house-rules/domain": "workspace:0.2.0", effect: "4.0.3" },
    devDependencies: { "@house-rules/domain": "0.2.0" },
    peerDependencies: { "@house-rules/domain": "^0.2.0" },
    optionalDependencies: { "@house-rules/domain": "workspace:*" },
    publishConfig: { registry: "https://registry.npmjs.org", exports: { ".": "./dist/index.js" } },
  };
  const original = structuredClone(source);
  const versions = {
    "@house-rules/application": "0.2.0-local.20261025123456789",
    "@house-rules/domain": "0.2.0-local.20261025123456789",
  };
  const packed = rewriteManifest(source, versions);
  assert.equal(packed.version, versions[source.name]);
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    assert.equal(packed[field]["@house-rules/domain"], versions["@house-rules/domain"]);
  }
  assert.equal(packed.dependencies.effect, "4.0.3");
  assert.deepEqual(packed.publishConfig.exports, source.publishConfig.exports);
  assert.equal(packed.publishConfig.registry, "http://127.0.0.1:4873");
  assert.equal(packed.publishConfig.tag, "local");
  assert.deepEqual(source, original);
  assert.throws(
    () => rewriteManifest(source, { [source.name]: versions[source.name] }),
    /Missing local version/u,
  );
  assert.throws(() => rewriteManifest(source, {}), /Missing local version/u);
});

test("registry guard accepts only HTTP loopback origins", () => {
  for (const url of ["http://127.0.0.1:4873", "http://localhost:4873/", "http://[::1]:4873"]) {
    assert.equal(localRegistry(url), url.replace(/\/$/u, ""));
  }
  for (const url of [
    "https://registry.npmjs.org",
    "http://192.168.1.2:4873",
    "http://0.0.0.0:4873",
    "http://localhost.evil.test",
    "http://localhost@evil.test",
    "http://user:pass@localhost:4873",
    "https://localhost:4873",
    "file:///tmp/registry",
    "http://localhost:4873/path",
    "http://localhost:4873/?registry=x",
    "http://localhost:4873/#x",
    "not a URL",
  ]) {
    assert.throws(() => localRegistry(url), undefined, url);
  }
});

test("selection includes transitive local dependencies and rejects unknown packages", () => {
  const pkg = (name, dependencies = {}) => ({
    manifest: { name: `@house-rules/${name}`, dependencies },
  });
  const packages = [
    pkg("work-items", { "@house-rules/application": "workspace:0.2.0" }),
    pkg("application", { "@house-rules/domain": "workspace:0.2.0" }),
    pkg("domain"),
    pkg("rules"),
  ];
  assert.deepEqual(
    selectPackages(packages, ["work-items"]).map((entry) => entry.manifest.name),
    ["@house-rules/domain", "@house-rules/application", "@house-rules/work-items"],
  );
  assert.equal(selectPackages(packages, ["domain", "@house-rules/domain"]).length, 1);
  assert.deepEqual(selectPackages(packages, []), []);
  assert.throws(() => selectPackages(packages, ["missing"]), /Unknown public package/u);
});

test("selected packages publish dependencies before dependents", () => {
  const pkg = (name, dependencies = {}) => ({
    manifest: { name: `@house-rules/${name}`, dependencies },
  });
  const packages = [
    pkg("consumer", { "@house-rules/library": "workspace:1.0.0" }),
    pkg("library", { "@house-rules/base": "workspace:1.0.0" }),
    pkg("base"),
    pkg("unrelated"),
  ];
  assert.deepEqual(
    selectPackages(packages, ["consumer", "unrelated"]).map((entry) => entry.manifest.name),
    [
      "@house-rules/base",
      "@house-rules/library",
      "@house-rules/consumer",
      "@house-rules/unrelated",
    ],
  );
});

test("npm publish args pin both the default and package-scope registries locally", () => {
  const args = npmPublishArgs("package.tgz", "http://127.0.0.1:4873", "user.npmrc", "global.npmrc");
  assert.ok(args.includes("--registry"));
  assert.ok(args.includes("--@house-rules:registry=http://127.0.0.1:4873"));
});

test("dirty-tree decision uses supplied git status", () => {
  assert.equal(shouldRefuseDirty(" M tracked-file\n?? untracked-file\n"), true);
  assert.equal(shouldRefuseDirty(""), false);
  assert.equal(shouldRefuseDirty(" M tracked-file\n", true), false);
});

test("CLI rejects real npm before build or manifest changes", () => {
  const manifest = new URL("../package.json", import.meta.url);
  const before = readFileSync(manifest, "utf8");
  const result = spawnSync(
    process.execPath,
    ["scripts/local-publish.mjs", "--registry", "https://registry.npmjs.org", "--allow-dirty"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /localhost registry/u);
  assert.equal(readFileSync(manifest, "utf8"), before);
});

test("CLI rejects a non-local registry from npm config environment", () => {
  const result = spawnSync(process.execPath, ["scripts/local-publish.mjs"], {
    encoding: "utf8",
    env: { ...process.env, npm_config_registry: "https://registry.npmjs.org/" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /localhost registry/u);
});
