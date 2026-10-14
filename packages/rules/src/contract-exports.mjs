import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { rootsFromPattern } from "./layout-option-parsers.cjs";

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

// The built mirror of a source entry, as a registry package ships it: src/x.ts is dist/x.js plus
// dist/x.d.ts. An entry outside src/ has no mirror.
function builds(file) {
  if (!file.startsWith("src/") || !file.endsWith(".ts")) return [];
  const stem = `dist/${file.slice("src/".length, -".ts".length)}`;
  return [`${stem}.js`, `${stem}.d.ts`];
}

function describe(file) {
  const built = builds(file);
  return built.length ? `${file} or its build, ${built.join(" or ")}` : file;
}

// The rules match resolved files, so only the manifest shows what a key or a pattern reaches.
// A package exports its public entry under "." and, optionally, src/contract.ts under "./contract".
// Nothing else: no other subpath, no pattern such as "./browser/*", no condition aimed elsewhere.
// A target may be the entry's build in dist/. publishConfig.exports replaces exports in the published
// manifest, so it is held to the same shape.
export function contractExportProblems(manifest, { publicEntry = PUBLIC_ENTRY } = {}) {
  const problems = [];
  const entries = { ".": publicEntry, [CONTRACT_KEY]: CONTRACT_FILE };
  const fields = [
    ["", manifest?.exports],
    ["publishConfig.exports ", manifest?.publishConfig?.exports],
  ];
  for (const [field, exportsField] of fields) {
    for (const [key, value] of subpaths(exportsField)) {
      if (!Object.hasOwn(entries, key)) {
        problems.push(`${field}"${key}" is exported; only "." and "${CONTRACT_KEY}" may be`);
        continue;
      }
      const allowed = new Set([entries[key], ...builds(entries[key])]);
      for (const file of [...new Set(targets(value))].filter((target) => !allowed.has(target))) {
        problems.push(`${field}"${key}" points at ${file}, not ${describe(entries[key])}`);
      }
    }
  }
  return problems;
}

function packagesRoots(config) {
  const from = config?.forbidden?.find(({ name }) => name === "contract-entry-is-browser-safe")
    ?.from?.path;
  const root = typeof from === "string" ? /^\^(.+)\/\[\^\/\]\+\/src\//u.exec(from)?.[1] : undefined;
  if (root === undefined) throw new Error("layout config is missing the contract entry pattern");
  return rootsFromPattern(root);
}

function unescape(pattern) {
  return pattern.replace(/\[\.\]/gu, ".").replace(/\\(.)/gu, "$1");
}

async function directories(workspace, folder) {
  try {
    const entries = await readdir(path.join(workspace, folder), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => name)
      .sort();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
}

// The folders a root names: a "*" segment stands for each folder at that depth.
async function rootFolders(workspace, root) {
  let folders = [""];
  for (const segment of root.split("/")) {
    const next = [];
    for (const folder of folders) {
      const names = segment === "*" ? await directories(workspace, folder) : [segment];
      next.push(...names.map((name) => (folder ? `${folder}/${name}` : name)));
    }
    folders = next;
  }
  return folders;
}

function publicEntryOf(config) {
  const to = config?.forbidden?.find(({ name }) => name === "packages-public-entry-only")?.to?.path;
  const entry =
    typeof to === "string"
      ? /\/\(\?!\(\?:(.+)\|src\/contract\[\.\]ts\)\$\)$/u.exec(to)?.[1]
      : undefined;
  if (entry === undefined) throw new Error("layout config is missing the public entry pattern");
  return unescape(entry);
}

// A path the config excludes, such as the rules plugin's own folder, is outside the layout.
function excluded(config, file) {
  const pattern = config?.options?.exclude?.path;
  return typeof pattern === "string" && new RegExp(pattern, "u").test(file);
}

export async function findContractExportProblems(config, workspace) {
  const publicEntry = publicEntryOf(config);
  const found = [];
  for (const pattern of packagesRoots(config)) {
    for (const root of await rootFolders(workspace, pattern)) {
      for (const folder of await directories(workspace, root)) {
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
    }
  }
  return found;
}
