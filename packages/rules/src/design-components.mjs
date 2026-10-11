import { globSync, statSync } from "node:fs";
import path from "node:path";

const COMPONENT_FILE = /\.(?:[cm]?[jt]sx?)$/;
const indexes = new Map();

function skipped(entry) {
  const name = typeof entry === "string" ? path.basename(entry) : entry.name;
  return name === "node_modules" || name.startsWith(".");
}

function folderStamp(folders) {
  return folders
    .map((folder) => {
      try {
        return `${folder}:${statSync(folder).mtimeMs}`;
      } catch {
        return `${folder}:gone`;
      }
    })
    .join("|");
}

function scan(cwd, globs) {
  const components = new Map();
  const folders = new Set();
  for (const glob of globs) {
    for (const entry of globSync(glob, { cwd, withFileTypes: true, exclude: skipped })) {
      if (!entry.isFile() || !COMPONENT_FILE.test(entry.name)) continue;
      const folder = path.resolve(cwd, entry.parentPath);
      const file = path.join(folder, entry.name);
      folders.add(folder);
      const name = entry.name.replace(COMPONENT_FILE, "");
      if (!components.has(name))
        components.set(name, path.relative(cwd, file).split(path.sep).join("/"));
    }
  }
  const sortedFolders = [...folders].sort();
  return { components, folders: sortedFolders, stamp: folderStamp(sortedFolders) };
}

// Maps each component file name in the folders, such as `button` for button.tsx, to its path from cwd.
// A rescan happens when a folder that held components changes, so an editor session sees a new file.
export function componentIndex(cwd, globs) {
  const key = `${cwd}\0${globs.join("\0")}`;
  const cached = indexes.get(key);
  if (cached && folderStamp(cached.folders) === cached.stamp) return cached.components;
  const index = scan(cwd, globs);
  indexes.set(key, index);
  return index.components;
}

export function componentName(fileName) {
  return fileName
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}
