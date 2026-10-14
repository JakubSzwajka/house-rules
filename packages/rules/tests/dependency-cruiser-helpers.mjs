import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cruise } from "dependency-cruiser";

export const FIXTURES = path.resolve(import.meta.dirname, "fixtures/dependency-cruiser");

// Writes a stub package. With `store`, it sits in node_modules/.pnpm/<store>/ behind a symlink, as pnpm lays it out.
async function stubPackage(workspace, manifest, files, store) {
  const real = path.join(
    workspace,
    "node_modules",
    ...(store ? [".pnpm", store, "node_modules"] : []),
    manifest.name,
  );
  for (const [file, text] of Object.entries({
    "package.json": JSON.stringify(manifest),
    ...files,
  })) {
    await mkdir(path.dirname(path.join(real, file)), { recursive: true });
    await writeFile(path.join(real, file), text);
  }
  if (store) {
    const link = path.join(workspace, "node_modules", manifest.name);
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(real, link, "dir");
  }
}

// Copies a fixture tree to a temporary workspace and links each package into node_modules, as pnpm does.
// A stub `test-runner` package stands in for a third-party import such as `@effect/vitest`, and stub
// `effect`, `@effect/sql-pg` and `@effect/platform-node` packages for the adapter imports, and `pg` for a driver.
export async function cruiseFixture(fixture, config, inspect) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "house-rules-depcruise-"));
  try {
    await cp(path.join(FIXTURES, fixture), workspace, { recursive: true });
    await mkdir(path.join(workspace, "node_modules/test-runner"), { recursive: true });
    await writeFile(
      path.join(workspace, "node_modules/test-runner/package.json"),
      '{ "name": "test-runner", "main": "index.js" }\n',
    );
    await writeFile(
      path.join(workspace, "node_modules/test-runner/index.js"),
      "exports.it = () => {};\n",
    );
    await stubPackage(
      workspace,
      {
        name: "effect",
        exports: {
          ".": "./dist/index.js",
          "./unstable/sql": "./dist/unstable/sql/index.js",
          "./unstable/http": "./dist/unstable/http/index.js",
          "./unstable/process": "./dist/unstable/process/index.js",
          "./*": "./dist/*.js",
        },
      },
      {
        "dist/index.js": "export const Effect = {};\n",
        "dist/Schema.js": "export const Schema = {};\n",
        "dist/unstable/http/index.js": "export const HttpClient = {};\n",
        "dist/unstable/http/HttpClient.js": "export const HttpClient = {};\n",
        "dist/unstable/sql/index.js": "export const sql = {};\n",
        "dist/unstable/sql/SqlClient.js": "export const SqlClient = {};\n",
        // The real module imports SqlClient; node_modules is not followed, so the rule never sees that.
        "dist/unstable/persistence/PersistedQueue.js": "export const PersistedQueue = {};\n",
        "dist/unstable/process/index.js": "export const ChildProcess = {};\n",
      },
      "effect@4.0.0",
    );
    // Installed contract entries: the framework's own, built as the registry ships it, and a
    // source one, as a git dependency ships it, that nobody vouched for.
    await stubPackage(
      workspace,
      {
        name: "@house-rules/application",
        exports: {
          ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
          "./contract": { types: "./dist/contract.d.ts", default: "./dist/contract.js" },
        },
      },
      {
        "dist/index.js": 'export * from "./facade.js";\n',
        "dist/facade.js": 'export * from "node:fs";\n',
        "dist/contract.js": 'export * from "./facade.js";\n',
      },
      "@house-rules+application@0.13.1",
    );
    await stubPackage(
      workspace,
      {
        name: "@acme/installed",
        exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
      },
      {
        "src/index.ts": 'export * from "./facade.ts";\n',
        "src/facade.ts": 'export * from "node:fs";\n',
        "src/contract.ts": 'export * from "./facade.ts";\n',
      },
    );
    for (const name of ["@effect/sql-pg", "@effect/platform-node", "pg"]) {
      await stubPackage(
        workspace,
        { name, exports: { ".": "./dist/index.js" } },
        {
          "dist/index.js": "export const PgClient = {}; export const NodeServices = {};\n",
        },
      );
    }
    const packagesDir = path.join(workspace, "packages");
    for (const name of existsSync(packagesDir) ? await readdir(packagesDir) : []) {
      const manifest = path.join(packagesDir, name, "package.json");
      if (!existsSync(manifest)) continue;
      const packageName = JSON.parse(await readFile(manifest, "utf8")).name;
      const link = path.join(workspace, "node_modules", packageName);
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(path.join(packagesDir, name), link, "dir");
    }
    const roots = ["apps", "packages"].filter((root) => existsSync(path.join(workspace, root)));
    const { forbidden, options } = config;
    const { output } = await cruise(roots, {
      ...structuredClone(options),
      baseDir: workspace,
      ruleSet: { forbidden: structuredClone(forbidden) },
      validate: true,
      outputType: "json",
    });
    const report = JSON.parse(output);
    if (inspect) return inspect({ ...report, workspace });
    return report;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function violatedRules(fixture, config) {
  const { summary } = await cruiseFixture(fixture, config);
  return summary.violations.map(({ rule, from, to }) => ({ rule: rule.name, from, to }));
}

export const ruleNames = (violations) => [...new Set(violations.map(({ rule }) => rule))].sort();

export const fromPaths = (violations) =>
  violations
    .map(({ rule, from, to }) => `${rule}: ${from}${to === from ? "" : ` -> ${to}`}`)
    .sort();
