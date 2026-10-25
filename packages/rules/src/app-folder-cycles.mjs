import path from "node:path";
import { findCycles } from "./subject-folder-cycles.mjs";

export const findAppFolderCycles = (modules, config, baseDir) => {
  const tests = new RegExp(
    config.forbidden.find(({ name }) => name === "production-does-not-import-tests").to.path,
  );
  const nodes = config.forbidden.find(({ name }) => name === "features-do-not-import-outer-folders")
    .from.path;
  const patterns = [["no-app-feature-cycles", new RegExp(nodes)]];
  const normalize = (file) =>
    path.isAbsolute(file) ? path.relative(baseDir, file).split(path.sep).join("/") : file;
  const bySource = new Map(modules.map((module) => [normalize(module.source), module]));
  return patterns.flatMap(([rule, pattern]) => {
    if (!pattern) return [];
    const graph = new Map();
    for (const module of modules) {
      const source = normalize(module.source);
      if (tests.test(source)) continue;
      const from = pattern.exec(source)?.[1];
      if (!from) continue;
      if (!graph.has(from)) graph.set(from, new Set());
      const app = from.slice(0, from.indexOf("/src/") + 1);
      const follow = (dependencies, seen = new Set()) => {
        for (const dep of dependencies) {
          const target = normalize(dep.resolved);
          if (tests.test(target) || seen.has(target)) continue;
          const to = pattern.exec(target)?.[1];
          if (to) {
            if (from === to) continue;
            graph.get(from).add(to);
            if (!graph.has(to)) graph.set(to, new Set());
          } else if (target.startsWith(app)) {
            follow(bySource.get(target)?.dependencies ?? [], new Set([...seen, target]));
          }
        }
      };
      follow(module.dependencies);
    }
    return findCycles(graph).map((cycle) => ({ rule, cycle }));
  });
};
