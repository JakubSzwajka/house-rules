import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

const CONTRACT_KEY = "./contract";
const CONTRACT_FILE = "src/contract.ts";
const PUBLIC_ENTRY = "src/index.ts";

function targets(value) {
  if (typeof value === "string") return [path.posix.normalize(value)];
  if (Array.isArray(value)) return value.flatMap(targets);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(targets);
  return [];
}

// An exports object whose keys do not start with "." holds the conditions of the "." entry.
function subpaths(field) {
  if (field === null || typeof field !== "object" || Array.isArray(field)) {
    return field === undefined ? [] : [[".", field]];
  }
  return Object.keys(field).some((key) => key.startsWith("."))
    ? Object.entries(field)
    : [[".", field]];
}

// The rules match resolved files, so only the manifest shows what a key or a pattern reaches.
// A package exports its public entry under "." and, optionally, src/contract.ts under "./contract".
// Nothing else: no other subpath, no pattern such as "./browser/*", no condition aimed elsewhere.
export function contractExportProblems(manifest, { publicEntry = PUBLIC_ENTRY } = {}) {
  const problems = [];
  const entries = { ".": publicEntry, [CONTRACT_KEY]: CONTRACT_FILE };
  for (const [key, value] of subpaths(manifest?.exports)) {
    if (!Object.hasOwn(entries, key)) {
      problems.push(`"${key}" is exported; only "." and "${CONTRACT_KEY}" may be`);
      continue;
    }
    for (const file of [...new Set(targets(value))].filter((target) => target !== entries[key])) {
      problems.push(`"${key}" points at ${file}, not ${entries[key]}`);
    }
  }
  return problems;
}

function packagesRoot(config) {
  const from = config?.forbidden?.find(({ name }) => name === "contract-entry-is-browser-safe")
    ?.from?.path;
  const root = typeof from === "string" ? /^\^(.+)\/\[\^\/\]\+\/src\//u.exec(from)?.[1] : undefined;
  if (root === undefined) throw new Error("layout config is missing the contract entry pattern");
  return unescape(root);
}

function unescape(pattern) {
  return pattern.replace(/\[\.\]/gu, ".").replace(/\\(.)/gu, "$1");
}

function publicEntryOf(config) {
  const to = config?.forbidden?.find(({ name }) => name === "packages-public-entry-only")?.to?.path;
  const entry =
    typeof to === "string" ? /\(\?:(.+)\|src\/contract\[\.\]ts\)\$\)$/u.exec(to)?.[1] : undefined;
  if (entry === undefined) throw new Error("layout config is missing the public entry pattern");
  return unescape(entry);
}

// A path the config excludes, such as the rules plugin's own folder, is outside the layout.
function excluded(config, file) {
  const pattern = config?.options?.exclude?.path;
  return typeof pattern === "string" && new RegExp(pattern, "u").test(file);
}

export async function findContractExportProblems(config, workspace) {
  const root = packagesRoot(config);
  const publicEntry = publicEntryOf(config);
  let folders;
  try {
    folders = await readdir(path.join(workspace, root), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const found = [];
  for (const folder of folders
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort()) {
    const manifestPath = `${root}/${folder}/package.json`;
    if (excluded(config, manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(workspace, manifestPath), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const problem of contractExportProblems(manifest, { publicEntry })) {
      found.push({ manifest: manifestPath, problem });
    }
  }
  return found;
}
