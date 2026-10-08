import path from "node:path";
import { readFile } from "node:fs/promises";

function findCycles(graph) {
  const state = new Map();
  const active = [];
  const cycles = [];

  const visit = (name) => {
    state.set(name, 1);
    active.push(name);

    for (const dependency of [...graph.get(name)].sort()) {
      if (state.get(dependency) === 1) {
        const start = active.indexOf(dependency);
        cycles.push([...active.slice(start), dependency]);
      } else if (state.get(dependency) === undefined) {
        visit(dependency);
      }
    }

    active.pop();
    state.set(name, 2);
  };

  for (const name of [...graph.keys()].sort()) {
    if (state.get(name) === undefined) visit(name);
  }

  return cycles;
}

function packagePatterns(config) {
  const packageRule = config?.forbidden?.find(
    ({ name }) => name === "domain-does-not-import-adapters",
  );
  const testRule = config?.forbidden?.find(
    ({ name }) => name === "production-does-not-import-tests",
  );
  const packagePath = packageRule?.from?.path;
  const testPath = testRule?.to?.path;
  if (typeof packagePath !== "string" || typeof testPath !== "string") {
    throw new Error("layout config is missing package-cycle path patterns");
  }
  return { package: new RegExp(packagePath), test: new RegExp(testPath) };
}

function normalize(source, baseDir) {
  if (typeof source !== "string") return source;
  const relative = path.isAbsolute(source) ? path.relative(baseDir, source) : source;
  return relative.split(path.sep).join("/").replace(/^\.\//u, "");
}

async function namesFromWorkspace(roots, baseDir) {
  const names = new Map();
  for (const root of [...roots].sort()) {
    const manifestPath = path.join(baseDir, root, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      throw new Error(`${manifestPath} must declare a package name`);
    }
    names.set(root, manifest.name);
  }
  return names;
}

export async function findPackageCycles(modules, config, { baseDir = process.cwd() } = {}) {
  const patterns = packagePatterns(config);
  const files = modules.map((module) => ({
    ...module,
    source: normalize(module.source, baseDir),
    dependencies: module.dependencies.map((dependency) => ({
      ...dependency,
      resolved: normalize(dependency.resolved, baseDir),
    })),
  }));
  const roots = new Set();

  for (const module of files) {
    if (patterns.test.test(module.source)) continue;
    const sourceRoot = patterns.package.exec(module.source)?.[1];
    if (sourceRoot !== undefined) roots.add(sourceRoot);
    for (const dependency of module.dependencies) {
      if (patterns.test.test(dependency.resolved)) continue;
      const targetRoot = patterns.package.exec(dependency.resolved)?.[1];
      if (targetRoot !== undefined) roots.add(targetRoot);
    }
  }

  const names = await namesFromWorkspace(roots, baseDir);
  const graph = new Map([...names.values()].map((name) => [name, new Set()]));
  const examples = new Map();

  for (const module of files) {
    if (patterns.test.test(module.source)) continue;
    const sourceRoot = patterns.package.exec(module.source)?.[1];
    const fromPackage = names.get(sourceRoot);
    if (fromPackage === undefined) continue;

    for (const dependency of module.dependencies) {
      if (patterns.test.test(dependency.resolved)) continue;
      const targetRoot = patterns.package.exec(dependency.resolved)?.[1];
      const toPackage = names.get(targetRoot);
      if (toPackage === undefined || toPackage === fromPackage) continue;

      graph.get(fromPackage).add(toPackage);
      const edge = `${fromPackage}\u0000${toPackage}`;
      if (!examples.has(edge)) {
        examples.set(edge, {
          fromPackage,
          toPackage,
          from: module.source,
          to: dependency.resolved,
        });
      }
    }
  }

  return findCycles(graph).map((cycle) => ({
    cycle,
    examples: cycle
      .slice(0, -1)
      .map((fromPackage, index) => examples.get(`${fromPackage}\u0000${cycle[index + 1]}`)),
  }));
}
