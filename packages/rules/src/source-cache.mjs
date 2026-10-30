import * as fs from "node:fs";
import path from "node:path";

const fileCaches = new WeakMap();
const scans = new Map();
const remember = (cache, key, value, limit) => {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
};
const stamp = (file) => {
  const stat = fs.statSync(file);
  return `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
};

export const cachedFile = (filename, read) => {
  const file = path.resolve(filename);
  let cache = fileCaches.get(read);
  if (!cache) fileCaches.set(read, (cache = new Map()));
  let version;
  try {
    version = stamp(file);
  } catch (error) {
    cache.delete(file);
    throw error;
  }
  let entry = cache.get(file);
  if (entry?.version !== version) {
    try {
      entry = { version, value: read(file) };
    } catch (error) {
      entry = { version, error };
    }
  }
  remember(cache, file, entry, 2048);
  if (entry.error) throw entry.error;
  return entry.value;
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export const sourceJson = (file) => cachedFile(file, readJson);

export const sourceGlob = (cwd, patterns, followSymlinks = false) => {
  cwd = path.resolve(cwd);
  const key = JSON.stringify([cwd, patterns, followSymlinks]);
  const previous = scans.get(key);
  if (previous) {
    try {
      if (previous.directories.every(([directory, version]) => stamp(directory) === version))
        return remember(scans, key, previous, 128).files;
    } catch {
      // A removed directory invalidates the scan as well as a changed one.
    }
  }
  const options = { cwd, followSymlinks };
  const prefixes = new Set();
  for (const pattern of patterns) {
    const parts = pattern.split("/");
    for (let end = 1; end < parts.length; end++) prefixes.add(parts.slice(0, end).join("/"));
  }
  // Watch every glob ancestor, including empty roots, so additions cannot hide behind a cached list.
  const directories = [cwd];
  for (const entry of fs.globSync([...prefixes], { ...options, withFileTypes: true })) {
    const file = path.resolve(entry.parentPath, entry.name);
    if (
      entry.isDirectory() ||
      (entry.isSymbolicLink() && fs.statSync(file, { throwIfNoEntry: false })?.isDirectory())
    )
      directories.push(file);
  }
  const files = fs.globSync(patterns, options);
  remember(scans, key, { files, directories: directories.map((file) => [file, stamp(file)]) }, 128);
  return files;
};
