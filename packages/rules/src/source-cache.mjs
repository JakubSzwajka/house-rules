import * as fs from "node:fs";
import path from "node:path";

// Shared values, including ASTs and scope managers, are read-only. Callers must not mutate them.
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
  const watch = () => {
    const directories = new Set([cwd]);
    for (const entry of fs.globSync([...prefixes], { ...options, withFileTypes: true })) {
      const file = path.resolve(entry.parentPath, entry.name);
      if (
        entry.isDirectory() ||
        (entry.isSymbolicLink() && fs.statSync(file, { throwIfNoEntry: false })?.isDirectory())
      )
        directories.add(file);
    }
    return directories;
  };
  const directories = [...watch()].map((file) => [file, stamp(file)]);
  const files = fs.globSync(patterns, options);
  const after = watch();
  // Stamp before globbing, then check stamps and membership, or a concurrent addition can stay hidden.
  if (
    after.size === directories.length &&
    directories.every(([file, version]) => after.has(file) && stamp(file) === version)
  )
    remember(scans, key, { files, directories }, 128);
  else scans.delete(key);
  return files;
};
