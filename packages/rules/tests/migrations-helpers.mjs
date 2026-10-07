import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const script = fileURLToPath(new URL("../bin/migrations.mjs", import.meta.url));

export const WORKSPACE = {
  "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  - packages/*\n',
  "package.json": "{}",
  "apps/web/package.json": "{}",
  "packages/trips/package.json": "{}",
  "packages/auth/package.json": "{}",
  "packages/db/package.json": "{}",
};

export const AUTH_MIGRATION = 'create table if not exists "user" (\n  id text primary key\n);\n';
export const TRIPS_MIGRATION = `-- The trips module owns trip and place.
create table trip (
  id text primary key,
  owner_id text not null
);
create table public.place (
  id text primary key,
  trip_id text not null references trip (id)
);
`;

// Lists every workspace package that has migrations, so a test about SQL ownership needs no list of its own.
const listFor = (files) => {
  const workspaces = new Set(
    Object.keys(files).flatMap((file) => {
      const match = /^((?:apps|packages)\/[^/]+)\/migrations\//u.exec(file);
      return match === null ? [] : [match[1]];
    }),
  );
  return JSON.stringify({ modules: [...workspaces].sort().map((workspace) => ({ workspace })) });
};

// With `cwd`, the defaults and the run happen in that folder of the scratch root, so a test can put files beside it.
export const run = (files, { list = true, cwd = "." } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "house-rules-migrations-"));
  const inCwd = (entries) =>
    Object.fromEntries(Object.entries(entries).map(([path, text]) => [join(cwd, path), text]));
  const withList =
    list && !(join(cwd, "migrations.json") in files) && !("migrations.json" in files)
      ? inCwd({ "migrations.json": listFor(files) })
      : {};
  try {
    for (const [path, content] of Object.entries({ ...inCwd(WORKSPACE), ...withList, ...files })) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return spawnSync(process.execPath, [script], { cwd: join(dir, cwd), encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const problemLines = (result) =>
  result.stderr
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => line.trim().split(": ")[0]);
