#!/usr/bin/env node
import * as fs from "node:fs";
import { seeRuleLine } from "../src/rule-docs.mjs";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SUBPATH_SEGMENT = String.raw`(?!\.{1,2}(?:/|$))[^/#&\s]+`;
const COMMIT_PINNED_GIT = new RegExp(
  String.raw`^(?:github:|git\+https:\/\/|git\+ssh:\/\/)[^#]+#[0-9a-f]{40}(?:&path:\/${SUBPATH_SEGMENT}(?:\/${SUBPATH_SEGMENT})*)?$`,
  "u",
);
const WORKSPACE_LIST_ITEM = /^\s+-\s+["']?([^"'#\s]+)["']?\s*$/u;

const isExact = (spec) => {
  if (spec.startsWith("workspace:")) {
    return EXACT_VERSION.test(spec.slice("workspace:".length));
  }
  const target = spec.startsWith("npm:") ? spec.slice(spec.lastIndexOf("@") + 1) : spec;
  return EXACT_VERSION.test(target) || COMMIT_PINNED_GIT.test(spec);
};

const workspaceManifests = () => {
  const lines = fs.readFileSync("pnpm-workspace.yaml", "utf8").split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "packages:");
  const patterns = [];
  for (const line of lines.slice(start + 1)) {
    const item = WORKSPACE_LIST_ITEM.exec(line);
    if (item === null) {
      break;
    }
    patterns.push(`${item[1]}/package.json`);
  }
  if (start === -1 || patterns.length === 0) {
    console.error("pins: no `packages:` list found in pnpm-workspace.yaml");
    process.exit(1);
  }
  return ["package.json", ...fs.globSync(patterns).sort()];
};

const looseSpecs = (manifestPath) => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const loose = DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([, spec]) => !isExact(spec))
      .map(([name, spec]) => `${field}.${name}: ${spec}`),
  );
  const packageManager = manifest.packageManager;
  if (packageManager !== undefined && !EXACT_VERSION.test(packageManager.split("@").pop() ?? "")) {
    loose.push(`packageManager: ${packageManager}`);
  }
  return loose;
};

const manifestPaths = process.argv.length > 2 ? process.argv.slice(2) : workspaceManifests();
let failed = false;

for (const manifestPath of manifestPaths) {
  const loose = looseSpecs(manifestPath);
  if (loose.length > 0) {
    failed = true;
    console.error(`Dependencies in ${manifestPath} must be exact versions or full commit SHAs:`);
    for (const line of loose) {
      console.error(`  ${line}`);
    }
  }
}

if (failed) {
  console.error(seeRuleLine("Exact pins"));
  process.exit(1);
}
console.log(`pins: every dependency is exact in ${manifestPaths.join(", ")}`);
