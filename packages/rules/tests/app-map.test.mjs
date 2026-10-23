import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appMapSources } from "../src/app-map.mjs";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "app-map-sources-"));
  const put = async (path, content) => {
    const parts = path.split("/");
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await put("package.json", '{"name":"@test/api"}');
  await put(
    "src/features/index.ts",
    'import { read } from "./read/index.ts"; export const Features = { read };',
  );
  await put(
    "src/features/read/index.ts",
    'import { defineFeature as feature } from "@house-rules/application/contract"; export const read = feature("read", {});',
  );
  await put(
    "src/ways-in/web/way.ts",
    'import { defineWay } from "@house-rules/application"; export const web = defineWay({name:"web"});',
  );
  await mkdir(join(root, "src/read-models"), { recursive: true });
  return { root, put, options: { appDirectory: root, rootDirectory: root, packageRoots: [] } };
};
const snapshot = { modules: [], features: [{ name: "read" }], ways: [{ name: "web" }] };

test("app map source facts follow named imports and literal builder aliases", async () => {
  const { options } = await fixture();
  const result = await appMapSources(snapshot, options);
  assert.equal(result.features[0].path, "src/features/read/index.ts");
  assert.equal(result.ways[0].source, "src/ways-in/web/way.ts");
});
test("app map source facts reject duplicate feature names", async () => {
  const { options, put } = await fixture();
  await put(
    "src/features/index.ts",
    'import { read } from "./read/index.ts"; import { other } from "./other/index.ts";',
  );
  await put(
    "src/features/other/index.ts",
    'import { defineFeature } from "@house-rules/application/contract"; export const other = defineFeature("read", {});',
  );
  await assert.rejects(appMapSources(snapshot, options), /Ambiguous feature/);
});
test("app map source facts reject computed names and missing features", async () => {
  const { options, put } = await fixture();
  await assert.rejects(
    appMapSources({ ...snapshot, features: [{ name: "missing" }] }, options),
    /exactly one source/,
  );
  await put(
    "src/ways-in/web/way.ts",
    'import { defineWay } from "@house-rules/application"; export const web = defineWay({name:someName});',
  );
  await assert.rejects(appMapSources(snapshot, options), /literal source fact/);
});
test("app map source facts reject ambiguous package ownership", async () => {
  const { options, put } = await fixture();
  for (const name of ["one", "two"]) {
    await put(`packages/${name}/package.json`, JSON.stringify({ name: `@test/${name}` }));
    await put(
      `packages/${name}/src/item/operations.ts`,
      'import { defineOperation } from "@house-rules/domain/contract"; export const read = defineOperation("Items.read", {});',
    );
  }
  await assert.rejects(
    appMapSources(
      { ...snapshot, modules: [{ service: "items", operations: [{ name: "Items.read" }] }] },
      { ...options, packageRoots: ["packages"] },
    ),
    /exactly one source for items, found 2/,
  );
});
test("app map source facts skip kit packages but not module packages", async () => {
  const { options, put } = await fixture();
  const dynamic =
    'import { defineOperation } from "@house-rules/domain/contract"; export const make = (name) => defineOperation(name, {});';
  for (const name of ["domain", "application"]) {
    await put(`packages/${name}/package.json`, JSON.stringify({ name: `@house-rules/${name}` }));
    await put(`packages/${name}/src/plan.ts`, dynamic);
  }
  const result = await appMapSources(snapshot, { ...options, packageRoots: ["packages"] });
  assert.equal(result.features[0].path, "src/features/read/index.ts");
  await put("packages/items/package.json", JSON.stringify({ name: "@test/items" }));
  await put("packages/items/src/item/operations.ts", dynamic);
  await assert.rejects(
    appMapSources(snapshot, { ...options, packageRoots: ["packages"] }),
    /literal source fact/,
  );
});
