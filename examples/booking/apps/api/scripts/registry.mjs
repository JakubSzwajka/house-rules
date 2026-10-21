import { writeFile } from "node:fs/promises";
import { build } from "esbuild";

const output = new URL("../dist/registry.mjs", import.meta.url);
await build({
  entryPoints: [new URL("../src/composition/registry.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["effect", "@effect/*"],
  outfile: output.pathname,
});
const { registryMarkdown } = await import(output.href);
await writeFile(new URL("../REGISTRY.md", import.meta.url), registryMarkdown());
