import { execFileSync } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { compileGlob } from "./file-globs.mjs";
import { languageFor } from "./non-js-comment-syntax.mjs";

const pruned = new Set([".git", "node_modules"]);
const magic = /[*?[{]/u;

function normalizeInput(cwd, input) {
  if (input.startsWith("-")) throw new Error("Usage: house-rules-comments [quoted file globs...]");
  if (input.split(path.sep).includes(".."))
    throw new Error(`parent paths are not allowed: ${input}`);
  const relative = path.relative(cwd, path.resolve(cwd, input));
  if (relative === ".." || relative.startsWith(`..${path.sep}`))
    throw new Error(`outside cwd: ${input}`);
  if (relative.split(path.sep).some((part) => pruned.has(part)))
    throw new Error(`excluded metadata or dependency path: ${input}`);
  return relative.split(path.sep).join("/");
}

async function inspect(cwd, file, optional = false) {
  let current = cwd;
  for (const part of file.split("/")) {
    current = path.join(current, part);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (optional && error.code === "ENOENT") return null;
      throw error;
    }
    if (info.isSymbolicLink()) {
      if (optional) return null;
      throw new Error(`symlink paths are not allowed: ${file}`);
    }
  }
  return lstat(current);
}

async function walk(dir, root, matcher, matched) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (pruned.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const file = path.relative(root, full).split(path.sep).join("/");
    if (entry.isDirectory()) await walk(full, root, matcher, matched);
    else if (matcher.test(file)) {
      if (entry.isSymbolicLink()) throw new Error(`symlink paths are not allowed: ${file}`);
      if (entry.isFile()) matched.push(file);
    }
  }
}

export async function selectCommentFiles(cwd, inputs) {
  if (!inputs.length) {
    const output = execFileSync(
      "git",
      ["-C", cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    );
    const files = [];
    for (const file of new Set(output.split("\0").filter(Boolean))) {
      if (!languageFor(file)) continue;
      if ((await inspect(cwd, file, true))?.isFile()) files.push(file);
    }
    return files;
  }
  const files = new Set();
  for (const input of inputs) {
    const pattern = normalizeInput(cwd, input);
    let matched;
    if (!magic.test(pattern)) {
      const info = await inspect(cwd, pattern);
      if (!info.isFile()) throw new Error(`not a regular file: ${input}`);
      matched = [pattern];
    } else {
      const parts = pattern.split("/");
      const prefix = parts
        .slice(
          0,
          parts.findIndex((part) => magic.test(part)),
        )
        .join("/");
      if (prefix && !(await inspect(cwd, prefix)).isDirectory())
        throw new Error(`not a directory: ${prefix}`);
      matched = [];
      await walk(path.join(cwd, prefix), cwd, compileGlob(pattern), matched);
    }
    if (!matched.length) throw new Error(`no files matched: ${input}`);
    for (const file of matched) {
      if (!languageFor(file)) throw new Error(`unsupported file type: ${file}`);
      files.add(file);
    }
  }
  return [...files];
}
