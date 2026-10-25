import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const FRAMEWORK_PACKAGES = [
  "domain",
  "application",
  "auth-jwt",
  "identity",
  "party",
  "call-audit",
  "comments",
  "migrations",
  "node-host",
];
const MOUNT_SECTION = {
  domain: "## Mounting modules and storage",
  application: "## Plug sockets and open ways",
  comments: "## Mount and bind",
  party: "## Mount and bind",
  identity: "## Mount and bind",
  "call-audit": "## Mount the Record socket",
};
const FIXED_SECTION = {
  application: "## HTTP, clients and errors",
  comments: "## Options and fixed rules",
  party: "## Service and fixed rules",
  identity: "## Service and fixed rules",
};

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("every framework package an app mounts ships an AGENTS.md", () => {
  for (const name of FRAMEWORK_PACKAGES) {
    it(`packages/${name}`, () => {
      const folder = `packages/${name}`;
      assert.ok(
        existsSync(new URL(`../${folder}/AGENTS.md`, import.meta.url)),
        `${folder}/AGENTS.md is missing`,
      );
      const manifest = JSON.parse(read(`${folder}/package.json`));
      assert.ok(
        manifest.files.includes("AGENTS.md"),
        `${folder}/package.json files must list AGENTS.md`,
      );
      const guide = read(`${folder}/AGENTS.md`);
      assert.match(guide, new RegExp(`^# ${manifest.name.replace("/", "\\/")}`, "u"));
      for (const section of [
        "## What it does",
        MOUNT_SECTION[name] ?? "## How an app mounts it",
        FIXED_SECTION[name] ?? "## Fixed rules",
      ]) {
        assert.ok(guide.includes(section), `${folder}/AGENTS.md needs "${section}"`);
      }
      const [packed] = JSON.parse(
        execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
          cwd: new URL(`../${folder}`, import.meta.url),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
      assert.ok(
        packed.files.some((file) => file.path === "AGENTS.md"),
        `npm pack of ${folder} must contain AGENTS.md`,
      );
    });
  }

  it("root AGENTS.md and the house-rules skill state the convention", () => {
    assert.match(read("AGENTS.md"), /framework package an app mounts[^\n]*AGENTS\.md/u);
    assert.match(read("skills/house-rules/SKILL.md"), /framework package[^\n]*AGENTS\.md/u);
  });
});
