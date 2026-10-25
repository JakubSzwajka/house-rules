#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runGit = (args) => execFileSync("git", args, { encoding: "utf8" });
const folders = [
  "rules",
  "domain",
  "application",
  "auth-jwt",
  "identity",
  "party",
  "migrations",
  "call-audit",
  "comments",
  "node-host",
  "work-items",
  "notes",
  "relations",
  "event-log",
  "contacts",
  "notifications",
  "push",
  "push-node",
  "email",
  "projects",
];
const retiredRecoveryOnlyFolders = ["capability"];
const CURRENT_NAME =
  /^@house-rules\/(?:rules|domain|application|auth-jwt|identity|party|migrations|call-audit|comments|node-host|work-items|notes|relations|event-log|contacts|notifications|push|push-node|email|projects)$/u;
const RECOVERABLE_NAME =
  /^@house-rules\/(?:rules|domain|application|auth-jwt|identity|party|migrations|call-audit|comments|node-host|work-items|notes|relations|event-log|contacts|notifications|push|push-node|email|projects|capability)$/u;

function publishedTags(summary, names = CURRENT_NAME) {
  assert.ok(Array.isArray(summary.publishedPackages), "publish summary needs publishedPackages");
  const tags = summary.publishedPackages.map(({ name, version }) => {
    assert.match(name, names);
    assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
    return `${name}@${version}`;
  });
  assert.equal(new Set(tags).size, tags.length, "publish summary repeats a package tag");
  return tags;
}

export function tagPublished(summary, git = runGit, { dryRun = false, names = CURRENT_NAME } = {}) {
  const tags = publishedTags(summary, names);
  if (tags.length === 0) return [];
  const head = git(["rev-parse", "HEAD"]).trim();
  const missing = tags.filter((tag) => {
    const ref = `refs/tags/${tag}`;
    const exists = git(["tag", "--list", tag]).trim();
    if (exists === "") return true;
    assert.equal(
      git(["rev-parse", `${ref}^{commit}`]).trim(),
      head,
      `${tag} points at another commit`,
    );
    return false;
  });
  if (dryRun) return missing;
  for (const tag of missing) git(["tag", tag, head]);
  // Retry the push even when a failed earlier push left all the tags locally.
  git(["push", "--atomic", "origin", ...tags.map((tag) => `refs/tags/${tag}`)]);
  return missing;
}

export function readPublishSummary(read = readFileSync) {
  try {
    return JSON.parse(read("pnpm-publish-summary.json", "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error("No publish summary; no tags created. Run --recover at the release commit.", {
      cause: error,
    });
  }
}

export function npmVersion({ name, version }, npm = execFileSync) {
  try {
    return JSON.parse(
      npm(
        "npm",
        ["view", `${name}@${version}`, "--json", "--registry=https://registry.npmjs.org"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
  } catch (error) {
    // Only a registry 404 means unpublished. Network and auth failures must stop recovery.
    let code;
    try {
      code = JSON.parse(error.stdout ?? "{}").error?.code;
    } catch {
      // Keep the original subprocess error when npm did not return JSON.
    }
    if (code === "E404") return undefined;
    throw error;
  }
}

const repository = "https://github.com/JakubSzwajka/house-rules";
const provenanceType = "https://slsa.dev/provenance/v1";

export function commitFromAttestations(json) {
  const commits = [];
  for (const attestation of json?.attestations ?? []) {
    const payload = attestation?.bundle?.dsseEnvelope?.payload;
    assert.equal(typeof payload, "string", "unreadable attestation payload");
    const statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    if (statement.predicateType !== provenanceType) continue;
    const build = statement.predicate?.buildDefinition;
    assert.equal(
      build?.externalParameters?.workflow?.repository,
      repository,
      "provenance names another repository",
    );
    const sources = (build?.resolvedDependencies ?? []).filter((dep) =>
      dep.uri?.startsWith(`git+${repository}@`),
    );
    assert.equal(sources.length, 1, "provenance needs one house-rules source");
    const commit = sources[0].digest?.gitCommit;
    assert.match(commit ?? "", /^[0-9a-f]{40}$/u, "invalid provenance source commit");
    commits.push(commit);
  }
  assert.equal(commits.length, 1, "attestations need one SLSA provenance statement");
  return commits[0];
}

export async function fetchAttestations(url, fetcher = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `provenance fetch failed: ${response.status} ${url}`);
  return response.json();
}

export async function recoverPublished(
  packages,
  git = runGit,
  registry = npmVersion,
  { attestations = fetchAttestations, dryRun = false, report = () => {} } = {},
) {
  publishedTags({ publishedPackages: packages }, RECOVERABLE_NAME);
  const head = git(["rev-parse", "HEAD"]).trim();
  const publishedPackages = [];
  for (const pkg of packages) {
    const published = registry(pkg);
    if (published === undefined) continue;
    assert.equal(published.name, pkg.name, "npm returned another package");
    assert.equal(published.version, pkg.version, "npm returned another version");
    const url = published.dist?.attestations?.url;
    assert.equal(typeof url, "string", `${pkg.name}@${pkg.version} has no provenance URL`);
    assert.ok(url.length > 0, `${pkg.name}@${pkg.version} has no provenance URL`);
    const commit = commitFromAttestations(await attestations(url));
    if (commit !== head) {
      report(`recovery skip: ${pkg.name}@${pkg.version} source ${commit} is not HEAD ${head}`);
      continue;
    }
    publishedPackages.push(pkg);
    report(`recovery match: ${pkg.name}@${pkg.version} commit ${commit}`);
  }
  return tagPublished({ publishedPackages }, git, { dryRun, names: RECOVERABLE_NAME });
}

export function workspacePackages(read = readFileSync) {
  return [...folders, ...retiredRecoveryOnlyFolders].flatMap((folder) => {
    let source;
    try {
      source = read(`packages/${folder}/package.json`, "utf8");
    } catch (error) {
      // Historical release commits can predate a package; only an absent manifest is skipped.
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const manifest = JSON.parse(source);
    assert.equal(manifest.name, `@house-rules/${folder}`);
    assert.notEqual(manifest.private, true, "cannot recover a private package");
    assert.match(manifest.version ?? "", /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
    return [{ name: manifest.name, version: manifest.version }];
  });
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  assert.ok(
    args.every((arg) => ["--recover", "--dry-run"].includes(arg)) &&
      new Set(args).size === args.length,
    "use --recover and/or --dry-run, or no arguments",
  );
  const dryRun = args.includes("--dry-run");
  const tags = args.includes("--recover")
    ? await recoverPublished(workspacePackages(), runGit, npmVersion, {
        dryRun,
        report: console.log,
      })
    : tagPublished(readPublishSummary(), runGit, { dryRun });
  console.log(
    `${dryRun ? "dry-run tags to create" : "published tags"}: ${tags.join(", ") || "none"}`,
  );
}
