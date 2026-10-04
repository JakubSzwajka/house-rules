import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atSourceRef, siteRoot, SOURCE_REF } from "./site-map.ts";

export const retargetHtml = (distDir: string, ref: string = SOURCE_REF): number => {
  let changed = 0;
  for (const entry of readdirSync(distDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) {
      continue;
    }
    const file = join(entry.parentPath, entry.name);
    const html = readFileSync(file, "utf8");
    const retargeted = atSourceRef(html, ref);
    if (retargeted !== html) {
      writeFileSync(file, retargeted);
      changed += 1;
    }
  }
  return changed;
};

if (import.meta.main) {
  const count = retargetHtml(join(siteRoot, "dist"));
  process.stdout.write(`source links: ${count} HTML pages now point at ${SOURCE_REF}\n`);
}
