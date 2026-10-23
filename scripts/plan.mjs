import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPlanCommand } from "../packages/application/src/index.ts";

const resolve = (file) =>
  // pnpm runs root scripts from the repository root; INIT_CWD is where the user typed the command.
  path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
const result = await runPlanCommand(process.argv.slice(2), (file) =>
  readFile(resolve(file), "utf8"),
);
if (result.output !== undefined) {
  await writeFile(resolve(result.output.path), result.output.content);
}
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
