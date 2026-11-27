import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/comments.mjs", import.meta.url));

export function withWorkspace(run) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "house-rules-comments-"));
  try {
    mkdirSync(path.join(cwd, ".github", "workflows"), { recursive: true });
    writeFileSync(path.join(cwd, "package.json"), "{}\n");
    run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

export function invoke(cwd, ...args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
}
