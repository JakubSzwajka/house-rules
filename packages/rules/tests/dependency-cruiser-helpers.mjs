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
// `effect`, `@effect/sql-pg` and `@effect/platform-node` packages for the adapter imports.
export async function violatedRules(fixture, config) {
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
          "./*": "./dist/*.js",
        },
      },
      {
        "dist/index.js": "export const Effect = {};\n",
        "dist/unstable/sql/index.js": "export const sql = {};\n",
        "dist/unstable/sql/SqlClient.js": "export const SqlClient = {};\n",
      },
      "effect@4.0.0",
    );
    for (const name of ["@effect/sql-pg", "@effect/platform-node"]) {
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
      const link = path.join(
        workspace,
        "node_modules",
        JSON.parse(await readFile(manifest, "utf8")).name,
      );
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
    const { summary } = JSON.parse(output);
    return summary.violations.map(({ rule, from, to }) => ({ rule: rule.name, from, to }));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export const ruleNames = (violations) => [...new Set(violations.map(({ rule }) => rule))].sort();

export const fromPaths = (violations) =>
  violations
    .map(({ rule, from, to }) => `${rule}: ${from}${to === from ? "" : ` -> ${to}`}`)
    .sort();
