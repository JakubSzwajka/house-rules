import { join } from "node:path";
import { writeLlmsFile } from "./llms-files.ts";
import { siteRoot } from "./site-map.ts";

writeLlmsFile(join(siteRoot, "dist"));
process.stdout.write("llms: wrote llms.txt to dist/\n");
