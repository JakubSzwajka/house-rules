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

const dist = join(siteRoot, "dist");
const built = existsSync(join(dist, "index.html"));
const skip = built
  ? false
  : "site/dist is absent; run `pnpm --filter @house-rules/site build` first";

const docsPage = join("start", "index.html");

const metaContent = (html: string, attr: "property" | "name", key: string): string | undefined =>
  [...html.matchAll(/<meta\s[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => tag.includes(`${attr}="${key}"`))
    ?.match(/content="([^"]*)"/)?.[1];

describe("built share tags", { skip }, () => {
  for (const label of ["home page", "docs page"]) {
    it(`${label} carries absolute og and twitter images`, () => {
      const file = label === "home page" ? "index.html" : docsPage;
      const html = readFileSync(join(dist, file), "utf8");
      const image = /^https:\/\/[^/]+\/og-image\.png$/;
      for (const [attr, key] of [
        ["property", "og:image"],
        ["name", "twitter:image"],
      ] as const) {
        const value = metaContent(html, attr, key);
        assert.ok(value && image.test(value), `${file}: ${key} is ${String(value)}`);
      }
      assert.equal(metaContent(html, "property", "og:image:width"), "1200", file);
      assert.equal(metaContent(html, "property", "og:image:height"), "630", file);
    });

    it(`${label} links the apple touch icon and the favicon`, () => {
      const file = label === "home page" ? "index.html" : docsPage;
      const html = readFileSync(join(dist, file), "utf8");
      assert.match(html, /<link\s[^>]*rel="apple-touch-icon"[^>]*href="[^"]+"/, file);
      assert.match(html, /<link\s[^>]*rel="(?:shortcut )?icon"[^>]*href="[^"]*favicon[^"]*"/, file);
    });
  }
});
