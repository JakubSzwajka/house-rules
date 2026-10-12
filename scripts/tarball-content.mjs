import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const FORBIDDEN_PATH = [
  [/(?:^|\/)(?:tests?|__tests__|fixtures?)(?:\/|$)/u, "a test or fixture folder"],
  [/\.(?:test|spec)\.[cm]?[jt]sx?$/u, "a test file"],
  [/(?:^|\/)\.env(?:\.|$)/u, "an .env file"],
  [/\.map$/u, "a source map"],
  [/(?:^|\/)\.(?:npmrc|git|DS_Store)(?:\/|$)/u, "a local config file"],
];
const SOURCE_MAP_COMMENT = /^\s*\/\/[#@]\s*sourceMappingURL=/mu;
const buildMachinePathPatterns = (root) =>
  [
    new RegExp(escapeRegExp(root), "u"),
    new RegExp(escapeRegExp(os.homedir()), "u"),
    new RegExp(escapeRegExp(os.tmpdir()), "u"),
    /(?:^|[^\w./-])\/(?:home|Users|root)\/[\w.-]+/u,
    /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\/u,
  ].filter((pattern) => pattern.source.length > 3);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const listFiles = (dir, base = "") =>
  readdirSync(path.join(dir, base)).flatMap((name) => {
    const rel = base === "" ? name : `${base}/${name}`;
    return statSync(path.join(dir, rel)).isDirectory() ? listFiles(dir, rel) : [rel];
  });

export function assertCleanTarball(label, tarball, root) {
  const unpacked = mkdtempSync(path.join(os.tmpdir(), "house-rules-unpacked-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
    for (const file of listFiles(unpacked)) {
      const local = file.replace(/^package\//u, "");
      for (const [pattern, what] of FORBIDDEN_PATH) {
        assert.ok(!pattern.test(local), `${label} ships ${local}, ${what}`);
      }
      const text = readFileSync(path.join(unpacked, file), "latin1");
      assert.ok(!SOURCE_MAP_COMMENT.test(text), `${label}: ${local} points at a source map`);
      for (const pattern of buildMachinePathPatterns(root)) {
        const found = pattern.exec(text);
        assert.ok(
          found === null,
          `${label}: ${local} contains the local path ${found?.[0].trim()}`,
        );
      }
    }
  } finally {
    rmSync(unpacked, { recursive: true, force: true });
  }
}

export function assertTarballRulesAreLive(work, root) {
  // A clean run proves nothing unless each rule still refuses a tarball that breaks it.
  const bad = {
    "tests/a.js": "export {};\n",
    "src/a.test.js": "export {};\n",
    "fixtures/a.json": "{}\n",
    ".env.local": "A=1\n",
    "dist/a.js.map": "{}\n",
    "dist/b.js": "export {};\n//# sourceMappingURL=b.js.map\n",
    "dist/c.js": `export const here = ${JSON.stringify(path.join(root, "x"))};\n`,
    "dist/d.js": `export const home = ${JSON.stringify(path.join(os.homedir(), "x"))};\n`,
    "dist/e.js": 'export const home = "/home/someone/x";\n',
  };
  for (const [file, text] of Object.entries(bad)) {
    const dir = path.join(work, "bad", file.replace(/\W/gu, "_"));
    mkdirSync(path.dirname(path.join(dir, "package", file)), { recursive: true });
    writeFileSync(path.join(dir, "package", file), text);
    const tarball = `${dir}.tgz`;
    execFileSync("tar", ["-czf", tarball, "-C", dir, "package"]);
    assert.throws(
      () => assertCleanTarball("bad", tarball, root),
      /ships|points at|local path/u,
      file,
    );
  }
}
