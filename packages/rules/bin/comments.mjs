#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { selectCommentFiles } from "../src/comment-files.mjs";
import { checkNonJsComments } from "../src/non-js-comments.mjs";

async function main() {
  const cwd = process.cwd();
  const files = await selectCommentFiles(cwd, process.argv.slice(2));
  const diagnostics = [];
  for (const file of files)
    diagnostics.push(...checkNonJsComments(file, await readFile(path.resolve(cwd, file), "utf8")));
  for (const diagnostic of diagnostics)
    console.error(`${diagnostic.file}:${diagnostic.line}: ${diagnostic.message}`);
  if (diagnostics.length) process.exitCode = 1;
  else console.log(`comments: ${files.length} file(s) checked`);
}

try {
  await main();
} catch (error) {
  console.error(`comments: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
