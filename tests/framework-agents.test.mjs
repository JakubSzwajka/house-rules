import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const FRAMEWORK_PACKAGES = ["capability", "call-audit", "migrations"];
const SECTIONS = ["## What it does", "## How an app mounts it", "## Fixed rules"];

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
      for (const section of SECTIONS) {
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

  it("root AGENTS.md and the add-an-effect-module skill state the convention", () => {
    assert.match(read("AGENTS.md"), /framework package an app mounts[^\n]*AGENTS\.md/u);
    assert.match(
      read("skills/add-an-effect-module/SKILL.md"),
      /framework package[^\n]*AGENTS\.md/u,
    );
  });
});
