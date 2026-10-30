import * as fs from "node:fs";
import path from "node:path";
import { cachedFile, sourceGlob } from "./source-cache.mjs";

// The workspace packages, as pnpm finds them: each folder that a `packages:` glob in pnpm-workspace.yaml
// matches and that holds a package.json, so a nested glob such as examples/*/packages/* counts too.
const DEFAULT_WORKSPACES = ["apps/*", "packages/*"];
const WORKSPACE_LIST_ITEM = /^\s+-\s+["']?([^"'#\s]+)["']?\s*$/u;

const readPatterns = (file) => {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "packages:");
  const patterns = [];
  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    const item = WORKSPACE_LIST_ITEM.exec(line);
    if (item === null) break;
    patterns.push(item[1]);
  }
  return patterns.length > 0 ? patterns : DEFAULT_WORKSPACES;
};

export const workspaceRoot = (cwd) => {
  let owner;
  for (let directory = path.resolve(cwd); ; directory = path.dirname(directory)) {
    if (fs.existsSync(path.join(directory, "pnpm-workspace.yaml"))) return directory;
    if (!owner && fs.existsSync(path.join(directory, "package.json"))) owner = directory;
    if (path.dirname(directory) === directory) return owner ?? cwd;
  }
};

export const workspaceDirectories = (cwd = process.cwd()) => {
  const file = path.join(cwd, "pnpm-workspace.yaml");
  const patterns = fs.existsSync(file) ? cachedFile(file, readPatterns) : DEFAULT_WORKSPACES;
  return sourceGlob(
    cwd,
    patterns.map((pattern) => `${pattern}/package.json`),
    true,
  )
    .map((manifest) => path.dirname(manifest).split(path.sep).join("/"))
    .sort();
};
