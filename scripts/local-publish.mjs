#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const defaultRegistry = "http://127.0.0.1:4873";

export function localVersion(version, date = new Date()) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`Expected a stable package version, got ${version}`);
  }
  const timestamp = date.toISOString().replace(/[-:.TZ]/gu, "");
  return `${version}-local.${timestamp}`;
}

export function localRegistry(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Local publishing requires an HTTP localhost registry without credentials or a path.",
    );
  }
  return url.origin;
}

export function rewriteManifest(manifest, versions) {
  const packed = structuredClone(manifest);
  if (!versions[packed.name]) throw new Error(`Missing local version for ${packed.name}`);
  packed.version = versions[packed.name];
  for (const field of dependencyFields) {
    for (const name of Object.keys(packed[field] ?? {})) {
      if (!name.startsWith("@house-rules/")) continue;
      if (!versions[name]) throw new Error(`Missing local version for ${name}`);
      packed[field][name] = versions[name];
    }
  }
  // A package's release registry must never override the localhost CLI argument.
  packed.publishConfig = { ...packed.publishConfig, registry: defaultRegistry, tag: "local" };
  return packed;
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const run = (command, args, cwd = root, capture = false) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

function publicPackages() {
  return readdirSync(path.join(root, "packages")).flatMap((folder) => {
    const directory = path.join(root, "packages", folder);
    const manifest = readJson(path.join(directory, "package.json"));
    return manifest.private ? [] : [{ folder, directory, manifest }];
  });
}

export function selectPackages(packages, names) {
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  const selected = new Set();
  const visiting = new Set();
  function include(name) {
    const pkg = byName.get(name);
    if (!pkg) throw new Error(`Unknown public package: ${name}`);
    if (selected.has(pkg)) return;
    if (visiting.has(pkg)) throw new Error(`Package dependency cycle at ${name}`);
    visiting.add(pkg);
    for (const field of dependencyFields) {
      for (const dependency of Object.keys(pkg.manifest[field] ?? {})) {
        if (dependency.startsWith("@house-rules/")) include(dependency);
      }
    }
    visiting.delete(pkg);
    selected.add(pkg);
  }
  for (const name of names) include(name.startsWith("@") ? name : `@house-rules/${name}`);
  return [...selected];
}

export function shouldRefuseDirty(status, allowDirty = false) {
  return !allowDirty && Boolean(status.trim());
}

export function npmPublishArgs(tarball, registry, npmrc, globalconfig) {
  return [
    "publish",
    tarball,
    "--registry",
    registry,
    `--@house-rules:registry=${registry}`,
    "--tag",
    "local",
    "--access",
    "public",
    "--ignore-scripts",
    "--userconfig",
    npmrc,
    "--globalconfig",
    globalconfig,
  ];
}

function pack(pkg, work, versions, registry) {
  // Use the same pnpm pack path as packed-consumer so publishConfig exports/files apply.
  const output = run(
    "pnpm",
    ["pack", "--ignore-scripts", "--pack-destination", path.join(work, "original")],
    pkg.directory,
    true,
  );
  const tarball = output.trim().split("\n").pop().trim();
  if (!tarball.endsWith(".tgz")) throw new Error(`pnpm pack printed no tarball: ${output}`);
  const staging = path.join(work, pkg.folder);
  mkdirSync(staging);
  run("tar", ["-xzf", tarball, "-C", staging]);
  const file = path.join(staging, "package/package.json");
  const manifest = rewriteManifest(readJson(file), versions);
  manifest.publishConfig.registry = registry;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  const rewritten = path.join(work, `${pkg.folder}.tgz`);
  run("tar", ["-czf", rewritten, "-C", staging, "package"]);
  return rewritten;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      registry: { type: "string", default: process.env.npm_config_registry ?? defaultRegistry },
      since: { type: "string" },
      "allow-dirty": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "Usage: pnpm run local-publish [package ... | --since <git-ref>] [--allow-dirty] [--registry http://127.0.0.1:4873]",
    );
    return;
  }
  const registry = localRegistry(values.registry);
  if (values.since && positionals.length)
    throw new Error("Choose package names or --since, not both.");
  if (
    shouldRefuseDirty(
      run("git", ["status", "--porcelain", "--untracked-files=all"], root, true),
      values["allow-dirty"],
    )
  ) {
    throw new Error("Refusing a dirty tree. Commit first or pass --allow-dirty.");
  }
  const packages = publicPackages();
  let names = positionals.length ? positionals : packages.map((pkg) => pkg.manifest.name);
  if (values.since) {
    const ref = run(
      "git",
      ["rev-parse", "--verify", `${values.since}^{commit}`],
      root,
      true,
    ).trim();
    const changed = run("git", ["diff", "--name-only", ref, "--"], root, true)
      .trim()
      .split("\n")
      .filter(Boolean);
    names = packages
      .filter((pkg) =>
        changed.some(
          (file) => !file.startsWith("packages/") || file.startsWith(`packages/${pkg.folder}/`),
        ),
      )
      .map((pkg) => pkg.manifest.name);
  }
  const selected = selectPackages(packages, names);
  if (!selected.length) {
    console.log("No public packages changed.");
    return;
  }
  const now = new Date();
  const versions = Object.fromEntries(
    selected.map(({ manifest }) => [manifest.name, localVersion(manifest.version, now)]),
  );
  console.log(
    `Publishing ${selected.length} packages, including internal dependencies, to ${registry}`,
  );
  const auth = Buffer.from("local:house-rules-local").toString("base64");
  const login = await fetch(`${registry}/-/user/org.couchdb.user:local`, {
    method: "PUT",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "local", password: "house-rules-local" }),
  });
  if (!login.ok)
    throw new Error(
      `Local login failed: HTTP ${login.status}. See docs/local-registry.md for one-time setup.`,
    );
  const { token } = await login.json();
  if (typeof token !== "string" || !token || /[\r\n]/u.test(token))
    throw new Error("Local login returned no valid token.");
  run("pnpm", ["build"]);
  const work = mkdtempSync(path.join(os.tmpdir(), "house-rules-local-publish-"));
  const onSignal = (signal) => {
    rmSync(work, { recursive: true, force: true });
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    // Use only the local token, never credentials from the user's npm config.
    const npmrc = path.join(work, ".npmrc");
    const globalconfig = path.join(work, "global.npmrc");
    writeFileSync(
      npmrc,
      `registry=${registry}/\n@house-rules:registry=${registry}/\n//${new URL(registry).host}/:_authToken=${token}\n`,
      { mode: 0o600 },
    );
    writeFileSync(globalconfig, "");
    const tarballs = selected.map((pkg) => [pkg, pack(pkg, work, versions, registry)]);
    const published = {};
    try {
      for (const [pkg, tarball] of tarballs) {
        run("npm", npmPublishArgs(tarball, registry, npmrc, globalconfig), work);
        published[pkg.manifest.name] = versions[pkg.manifest.name];
      }
    } finally {
      console.log("\nExact versions published (pnpm-workspace.yaml overrides):");
      console.log("overrides:");
      for (const [name, version] of Object.entries(published))
        console.log(`  '${name}': '${version}'`);
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
