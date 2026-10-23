import { writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { Effect } from "effect";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (
  args.some((arg) => !["--json", "--mermaid", "--write"].includes(arg)) ||
  (args.includes("--json") && args.includes("--mermaid"))
)
  throw new Error("Use --json or --mermaid, and optionally --write");
const output = new URL("../dist/map.mjs", import.meta.url);
await build({
  entryPoints: [new URL("./map.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["effect", "@effect/*", "@house-rules/rules/app-map"],
  outfile: output.pathname,
});
const { mapSnapshot, renderMap } = await import(output.href);
const snapshot = await Effect.runPromise(mapSnapshot);
const format = args.includes("--json") ? "json" : args.includes("--mermaid") ? "mermaid" : "text";
process.stdout.write(renderMap(snapshot, format));
if (args.includes("--write"))
  await writeFile(
    new URL("../MAP.md", import.meta.url),
    `# App map\n\n\`\`\`text\n${renderMap(snapshot, "text")}\`\`\`\n`,
  );
