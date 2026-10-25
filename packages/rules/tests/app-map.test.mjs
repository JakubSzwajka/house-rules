import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appMapSources } from "../src/app-map.mjs";

const fixture = async ({ areas = true } = {}) => {
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
  if (areas) {
    await put(
      "src/ways-in/web/way.ts",
      'import { defineWay } from "@house-rules/application"; export const web = defineWay({name:"web"});',
    );
    await mkdir(join(root, "src/read-models"), { recursive: true });
  }
  return { root, put, options: { appDirectory: root, rootDirectory: root, packageRoots: [] } };
};
const snapshot = { modules: [], features: [{ name: "read" }], ways: [{ name: "web" }] };

test("app map source facts treat missing read-model and way directories as empty", async () => {
  const { options } = await fixture({ areas: false });
  const result = await appMapSources({ ...snapshot, ways: [] }, options);
  assert.equal(result.features[0].path, "src/features/read/index.ts");
  assert.deepEqual(result.ways, []);
});
test("app map source facts use installed framework package metadata without source files", async () => {
  const { options, put } = await fixture();
  await put(
    "node_modules/@house-rules/identity/package.json",
    JSON.stringify({ name: "@house-rules/identity", version: "0.19.0" }),
  );
  await put("node_modules/@house-rules/identity/dist/index.js", "export const IdentityMount = {};");
  const result = await appMapSources(
    {
      modules: [
        {
          service: "identity/Identity",
          package: "@house-rules/identity",
          operations: [{ name: "Identity.resolve" }],
        },
      ],
      features: snapshot.features,
      ways: snapshot.ways,
    },
    options,
  );
  assert.deepEqual(
    (({ name, kind, package: packageName, version, path }) => ({
      name,
      kind,
      package: packageName,
      version,
      path,
    }))(result.modules[0]),
    {
      name: "identity",
      kind: "package",
      package: "@house-rules/identity",
      version: "0.19.0",
      path: "node_modules/@house-rules/identity",
    },
  );
});
test("app map source facts reject installed packages outside the framework scope", async () => {
  const { options, put } = await fixture();
  await put(
    "node_modules/@test/items/package.json",
    JSON.stringify({ name: "@test/items", version: "1.0.0" }),
  );
  await assert.rejects(
    appMapSources(
      {
        ...snapshot,
        modules: [
          { service: "items", package: "@test/items", operations: [{ name: "Items.read" }] },
        ],
      },
      options,
    ),
    /exactly one source for items, found 0/,
  );
});
test("app map source facts reject installed manifest identity mismatches", async () => {
  const { options, put } = await fixture();
  await put(
    "node_modules/@house-rules/identity/package.json",
    JSON.stringify({ name: "@house-rules/party", version: "0.19.0" }),
  );
  await assert.rejects(
    appMapSources(
      {
        ...snapshot,
        modules: [
          {
            service: "identity",
            package: "@house-rules/identity",
            operations: [{ name: "Identity.resolve" }],
          },
        ],
      },
      options,
    ),
    /exactly one source for identity, found 0/,
  );
});
test("app map source facts reject stale operations in linked workspace packages", async () => {
  const { root, options, put } = await fixture();
  await put(
    "packages/identity/package.json",
    JSON.stringify({ name: "@house-rules/identity", version: "0.19.0" }),
  );
  await put(
    "packages/identity/src/identity/operations.ts",
    'import { defineOperation } from "@house-rules/domain/contract"; export const read = defineOperation("Identity.read", {});',
  );
  await mkdir(join(root, "node_modules/@house-rules"), { recursive: true });
  await symlink(join(root, "packages/identity"), join(root, "node_modules/@house-rules/identity"));
  // Resolve the configured root too, not just the installed package link.
  await symlink(join(root, "packages"), join(root, "workspace-packages"));
  await assert.rejects(
    appMapSources(
      {
        ...snapshot,
        modules: [
          {
            service: "identity",
            package: "@house-rules/identity",
            operations: [{ name: "Identity.resolve" }],
          },
        ],
      },
      { ...options, packageRoots: ["workspace-packages"] },
    ),
    /exactly one source for identity, found 0/,
  );
});
test("app map source facts reject workspace packages without src", async () => {
  const { options, put } = await fixture();
  await put("packages/items/package.json", JSON.stringify({ name: "@test/items" }));
  await assert.rejects(appMapSources(snapshot, { ...options, packageRoots: ["packages"] }), {
    code: "ENOENT",
  });
});
for (const area of ["read-models", "ways-in"]) {
  test(`app map source facts preserve non-ENOENT errors reading ${area}`, async () => {
    const { options, put } = await fixture({ areas: false });
    await put(`src/${area}`, "not a directory");
    await assert.rejects(appMapSources({ ...snapshot, ways: [] }, options), { code: "ENOTDIR" });
  });
}
test("app map source facts follow named imports and literal builder aliases", async () => {
  const { options } = await fixture();
  const result = await appMapSources(snapshot, options);
  assert.equal(result.features[0].path, "src/features/read/index.ts");
  assert.equal(result.ways[0].source, "src/ways-in/web/way.ts");
});
test("app map source facts pass plugs through untouched", async () => {
  const { options } = await fixture();
  const plugs = [{ name: "Party.may", package: "@house-rules/party", fills: "May" }];
  const result = await appMapSources({ ...snapshot, plugs }, options);
  assert.deepEqual(result.plugs, plugs);
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
