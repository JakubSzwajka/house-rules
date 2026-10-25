import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// The thin config layout() builds. house-rules-layout and house-rules-migrations read the same file.
export const LAYOUT_CONFIG_FILE = ".dependency-cruiser.cjs";

export function layoutConfigPath(workspace) {
  return path.join(workspace, LAYOUT_CONFIG_FILE);
}

export function loadLayoutConfig(workspace) {
  const configPath = layoutConfigPath(workspace);
  const config = createRequire(path.join(workspace, "package.json"))("./.dependency-cruiser.cjs");
  if (!Array.isArray(config?.forbidden) || typeof config.options !== "object") {
    throw new Error(`${configPath} must export a Dependency Cruiser layout config`);
  }
  return config;
}

// The apps roots, as the pattern packages-do-not-import-apps forbids: "^apps/" by default.
export function appsRootPattern(config) {
  const pattern = config.forbidden.find(({ name }) => name === "packages-do-not-import-apps")?.to
    ?.path;
  if (typeof pattern !== "string") {
    throw new Error(
      `${LAYOUT_CONFIG_FILE} has no "packages-do-not-import-apps" rule from layout(), which names the apps roots`,
    );
  }
  return new RegExp(pattern, "u");
}

// The apps roots of the workspace: from its layout config, or apps/ when it has none. A config that does
// not load, or names no apps roots, throws rather than falling back.
export function readAppsRoot(workspace) {
  if (!existsSync(layoutConfigPath(workspace))) return /^apps\//u;
  return appsRootPattern(loadLayoutConfig(workspace));
}
