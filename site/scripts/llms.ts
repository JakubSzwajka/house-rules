import { join } from "node:path";
import { writeLlmsFiles } from "./llms-files.ts";
import { siteRoot } from "./site-map.ts";

const count = writeLlmsFiles(join(siteRoot, "dist"));
process.stdout.write(
  `llms: wrote llms.txt, llms-full.txt and ${count - 2} Markdown pages to dist/\n`,
);
