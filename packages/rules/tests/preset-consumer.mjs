import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

// A consumer directory that resolves this package by name through node_modules, as an install would.
export async function withConsumer(files, run, links = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "house-rules-presets-"));
  try {
    await mkdir(path.join(directory, "node_modules/@house-rules"), { recursive: true });
    await symlink(repositoryRoot, path.join(directory, "node_modules/@house-rules/rules"), "dir");
    for (const [name, target] of Object.entries(links)) {
      await mkdir(path.dirname(path.join(directory, "node_modules", name)), { recursive: true });
      await symlink(target, path.join(directory, "node_modules", name), "dir");
    }
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(
        path.join(directory, name),
        typeof content === "string" ? content : JSON.stringify(content),
      );
    }
    return await run((command, args) => {
      const result = spawnSync(command, args, { cwd: directory, encoding: "utf8" });
      return { status: result.status, output: `${result.stdout}${result.stderr}` };
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
