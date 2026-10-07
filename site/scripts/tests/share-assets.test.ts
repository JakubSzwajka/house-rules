import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { siteRoot } from "../site-map.ts";

const publicFile = (name: string): string => join(siteRoot, "public", name);

const pngSize = (name: string): { readonly width: number; readonly height: number } => {
  const bytes = readFileSync(publicFile(name));
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", `${name} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

describe("share assets", () => {
  it("ships the favicon that Starlight links to", () => {
    assert.ok(existsSync(publicFile("favicon.svg")));
  });

  it("ships an og image of exactly 1200x630", () => {
    assert.deepEqual(pngSize("og-image.png"), { width: 1200, height: 630 });
  });

  it("ships an apple touch icon of exactly 180x180", () => {
    assert.deepEqual(pngSize("apple-touch-icon.png"), { width: 180, height: 180 });
  });
});
