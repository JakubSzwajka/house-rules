import * as fs from "node:fs";
import path from "node:path";

export const sourcePackages = (cwd, packagesDir, workspaces) => {
  const packages = new Map();
  for (const manifest of [
    ...fs.globSync(
      packagesDir.map((root) => `${root}/*/package.json`),
      { cwd },
    ),
    ...workspaces.map((workspace) => path.join(workspace, "package.json")),
  ]) {
    try {
      const file = path.resolve(cwd, manifest);
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (["@house-rules/domain", "@house-rules/application"].includes(json.name)) continue;
      for (const [key, entry] of Object.entries(json.exports ?? { ".": "./src/index.ts" })) {
        const target = typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
        if ([".", "./contract"].includes(key) && typeof target === "string")
          packages.set(
            json.name + (key === "." ? "" : "/contract"),
            path.resolve(path.dirname(file), target),
          );
      }
    } catch {
      /* unresolved package source fails at its use */
    }
  }
  return packages;
};
