import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the framework package ships its AGENTS.md", () => {
  it("packages/stack lists, packs and structures AGENTS.md and DESIGN.md", () => {
    const manifest = JSON.parse(read("packages/stack/package.json"));
    for (const file of ["AGENTS.md", "DESIGN.md", "README.md"]) {
      assert.ok(manifest.files.includes(file), `packages/stack files must list ${file}`);
    }
    const guide = read("packages/stack/AGENTS.md");
    assert.match(guide, /^# @house-rules\/stack\n/u);
    for (const section of [
      "## What it does",
      "## How an app mounts it",
      "## Fixed rules",
      "## Tests",
    ]) {
      assert.ok(guide.includes(section), `packages/stack/AGENTS.md needs "${section}"`);
    }
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: new URL("../packages/stack", import.meta.url),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    for (const file of ["AGENTS.md", "DESIGN.md"]) {
      assert.ok(
        packed.files.some(({ path }) => path === file),
        `npm pack of packages/stack must contain ${file}`,
      );
    }
  });

  it("root AGENTS.md and the house-rules skill point at the package guide", () => {
    assert.match(read("AGENTS.md"), /packages\/stack\/AGENTS\.md/u);
    assert.match(read("skills/house-rules/SKILL.md"), /packages\/stack\/DESIGN\.md/u);
  });
});
