import { createRequire } from "node:module";
import path from "node:path";

// The thin config layout() builds. house-rules-layout reads the same file.
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
