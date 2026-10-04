import { GENERATE_COMMAND } from "./generated-page.ts";
import { generatedPages, staleGeneratedPages, writeGeneratedPages } from "./generation.ts";

const pages = generatedPages();

if (process.argv.includes("--check")) {
  const stale = staleGeneratedPages(pages);
  if (stale.length > 0) {
    process.stderr.write(`Generated docs pages are stale. Run: ${GENERATE_COMMAND}\n`);
    process.stderr.write(`${stale.map((line) => `  ${line}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`generate: ${pages.length} generated pages are fresh\n`);
} else {
  writeGeneratedPages(pages);
  process.stdout.write(`generate: wrote ${pages.length} pages\n`);
}
