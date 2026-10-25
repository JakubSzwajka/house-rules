import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { Effect } from "effect";

const usage = `Usage: pnpm --filter @example/api run map -- [options]
  (none)                  print the text map
  --json | --mermaid | --html
                          print another format
  --write                 also rewrite MAP.md from the text map
  --diff [plan.json]      diff the built app (before) against a plan (after);
                          the default plan is this app's plan.json
  --text                  with --diff, print the text diff instead of html
  -o <file>               write the output to a file instead of stdout`;

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const options = { formats: [], write: false, text: false };
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (["--json", "--mermaid", "--html"].includes(arg)) options.formats.push(arg.slice(2));
  else if (arg === "--write") options.write = true;
  else if (arg === "--text") options.text = true;
  else if (arg === "-o" && args[index + 1] !== undefined) options.out = args[++index];
  else if (arg === "--diff")
    options.diff =
      args[index + 1] === undefined || args[index + 1].startsWith("-") ? "" : args[++index];
  else options.bad = arg;
}
if (
  options.bad !== undefined ||
  options.formats.length > 1 ||
  (options.diff !== undefined && (options.formats.length > 0 || options.write)) ||
  (options.text && options.diff === undefined)
) {
  console.error(usage);
  process.exit(2);
}
const resolve = (file) =>
  // pnpm --filter runs here; INIT_CWD is where the user typed the command.
  path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
const output = new URL("../dist/map.mjs", import.meta.url);
await build({
  entryPoints: [new URL("./map.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["effect", "@effect/*", "@house-rules/rules/app-map"],
  outfile: output.pathname,
});
const { mapSnapshot, planCommand, renderMap } = await import(output.href);
const snapshot = await Effect.runPromise(mapSnapshot);
const emit = async (content) => {
  if (options.out === undefined) process.stdout.write(content);
  else {
    await writeFile(resolve(options.out), content);
    console.error(`Wrote ${options.out}`);
  }
};
if (options.diff !== undefined) {
  const plan =
    options.diff === "" ? new URL("../plan.json", import.meta.url).pathname : resolve(options.diff);
  const built = "built app";
  const result = await Effect.runPromise(
    planCommand(["diff", built, plan, ...(options.text ? ["--text"] : [])], (file) =>
      file === built
        ? Promise.resolve(renderMap(snapshot, "json"))
        : readFile(resolve(file), "utf8"),
    ),
  );
  process.stderr.write(result.stderr);
  if (result.exitCode === 0) await emit(result.stdout);
  process.exitCode = result.exitCode;
} else {
  await emit(renderMap(snapshot, options.formats[0] ?? "text"));
  if (options.write)
    await writeFile(
      new URL("../MAP.md", import.meta.url),
      `# App map\n\n\`\`\`text\n${renderMap(snapshot, "text")}\`\`\`\n`,
    );
}
