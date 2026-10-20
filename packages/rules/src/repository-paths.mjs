import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const GIT_OUTPUT_LIMIT = 512 * 1024 * 1024;
const topLevelByDirectory = new Map();

// Git hooks export GIT_DIR (and sometimes GIT_INDEX_FILE, GIT_PREFIX), which pins every call to one repo and
// makes `--show-toplevel` return the cwd. Drop the repo-local variables, the list `git rev-parse --local-env-vars`
// prints, so git discovers the repo from each file's folder. Honouring GIT_WORK_TREE alone would not help: hooks
// set GIT_DIR without it.
const REPO_LOCAL_GIT_ENV = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

function discoveryEnv() {
  const env = { ...process.env };
  for (const name of REPO_LOCAL_GIT_ENV) delete env[name];
  return env;
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    env: discoveryEnv(),
    encoding: "utf8",
    maxBuffer: GIT_OUTPUT_LIMIT,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function realDirectory(directory) {
  try {
    return realpathSync(directory);
  } catch {
    return directory;
  }
}

function gitTopLevel(directory) {
  if (!topLevelByDirectory.has(directory)) {
    let topLevel = null;
    try {
      topLevel = realDirectory(
        path.resolve(git(["rev-parse", "--show-toplevel"], directory).trim()),
      );
    } catch {
      topLevel = null;
    }
    topLevelByDirectory.set(directory, topLevel);
  }
  return topLevelByDirectory.get(directory);
}

// Untracked files and ignore rules can change without touching the index. Read once per linted file.
function gitCandidateFiles(topLevel) {
  try {
    const files = new Set(
      git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], topLevel)
        .split("\0")
        .filter(Boolean),
    );
    const ignored = git(
      ["ls-files", "--cached", "--ignored", "--exclude-standard", "-z"],
      topLevel,
    ).split("\0");
    for (const file of ignored) files.delete(file);
    return files;
  } catch {
    return new Set();
  }
}

function existsWithExactCase(root, relativePath) {
  let directory = root;
  for (const segment of relativePath ? relativePath.split("/") : []) {
    try {
      if (!readdirSync(directory).includes(segment)) return false;
    } catch {
      return false;
    }
    directory = path.join(directory, segment);
  }
  return true;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function inside(root, absolute) {
  const relative = path.relative(root, absolute);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function candidateFile(root, relativePath, files, boundary = "", seen = new Set()) {
  if (!files.has(relativePath) || seen.has(relativePath)) return false;
  seen.add(relativePath);
  const absolute = path.resolve(root, relativePath);
  const limit = path.resolve(root, boundary);
  if (!inside(limit, absolute) || !existsWithExactCase(root, relativePath)) return false;
  try {
    // Resolve on disk before normalizing symlink text: `alias/..` can cross a real boundary.
    const canonical = realpathSync.native(absolute);
    if (!inside(limit, canonical) || !statSync(absolute).isFile()) return false;
    if (!files.has(toPosix(path.relative(root, canonical)))) return false;
    let current = root;
    const parts = relativePath.split("/");
    for (const [index, segment] of parts.entries()) {
      current = path.join(current, segment);
      if (!lstatSync(current).isSymbolicLink()) continue;
      if (!files.has(toPosix(path.relative(root, current)))) return false;
      const target = path.resolve(
        path.dirname(current),
        readlinkSync(current),
        ...parts.slice(index + 1),
      );
      if (!inside(limit, target)) return false;
      return candidateFile(root, toPosix(path.relative(root, target)), files, boundary, seen);
    }
    return true;
  } catch {
    return false;
  }
}

export function repositoryPathsFor(filename, cwd) {
  const absolute = path.resolve(cwd, filename);
  const directory = realDirectory(path.dirname(absolute));
  const topLevel = gitTopLevel(directory);
  const root = topLevel ?? realDirectory(path.resolve(cwd));
  const fromFile = toPosix(path.relative(root, path.join(directory, path.basename(absolute))));
  if (!fromFile || fromFile === ".." || fromFile.startsWith("../") || path.isAbsolute(fromFile))
    return null;

  if (topLevel) {
    const files = gitCandidateFiles(topLevel);
    return {
      fromFile,
      has: (relativePath, boundary) => candidateFile(root, relativePath, files, boundary),
    };
  }
  return { fromFile, has: (relativePath) => existsWithExactCase(root, relativePath) };
}
