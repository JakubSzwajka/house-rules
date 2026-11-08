import { sourceGlob, sourceJson } from "./source-cache.mjs";
import path from "node:path";

export const sourcePackages = (cwd, packagesDir) => {
  const packages = new Map();
  for (const manifest of sourceGlob(
    cwd,
    packagesDir.map((root) => `${root}/*/package.json`),
  )) {
    try {
      const file = path.resolve(cwd, manifest);
      const json = sourceJson(file);
      const exports = json.exports ?? "./src/index.ts";
      const entry = typeof exports === "string" ? exports : exports["."];
      const target = typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
      if (typeof target === "string")
        packages.set(json.name, path.resolve(path.dirname(file), target));
    } catch {
      /* unresolved package source fails at its use */
    }
  }
  return packages;
};
