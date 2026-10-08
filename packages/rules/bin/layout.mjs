#!/usr/bin/env node
import path from "node:path";
import { createRequire } from "node:module";
import { cruise } from "dependency-cruiser";
import { findPackageCycles } from "../src/package-cycles.mjs";
import { findSubjectFolderCycles } from "../src/subject-folder-cycles.mjs";

const usage = "Usage: house-rules-layout [--cwd <workspace>]";

function workspaceFromArgs(args) {
  let workspace = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--cwd=")) {
      workspace = arg.slice("--cwd=".length);
    } else if (arg === "--cwd") {
      workspace = args[++index];
      if (workspace === undefined || workspace.startsWith("-")) {
        throw new Error(usage);
      }
    } else {
      throw new Error(usage);
    }
  }
  return path.resolve(workspace);
}

async function check(workspace) {
  const configPath = path.join(workspace, ".dependency-cruiser.cjs");
  const config = createRequire(import.meta.url)(configPath);
  if (!Array.isArray(config?.forbidden) || typeof config.options !== "object") {
    throw new Error(`${configPath} must export a Dependency Cruiser layout config`);
  }

  const { output } = await cruise(["."], {
    ...config.options,
    baseDir: workspace,
    ruleSet: { forbidden: config.forbidden, allowed: config.allowed ?? [] },
    validate: true,
    outputType: "json",
  });
  const report = JSON.parse(output);
  const subjectCycles = findSubjectFolderCycles(report.modules, config, workspace);
  const packageCycles = await findPackageCycles(report.modules, config, { baseDir: workspace });

  if (subjectCycles.length > 0) {
    console.error(
      `no-subject-folder-cycles: ${subjectCycles.length} cycle(s) in package subject folders:`,
    );
    for (const { cycle, examples } of subjectCycles) {
      console.error(`  ${cycle.join(" -> ")}`);
      for (const { fromFolder, toFolder, from, to } of examples) {
        console.error(`    ${fromFolder} -> ${toFolder}: ${from} -> ${to}`);
      }
    }
  }

  if (packageCycles.length > 0) {
    console.error(
      `no-package-cycles: ${packageCycles.length} cycle(s) between workspace packages:`,
    );
    for (const { cycle, examples } of packageCycles) {
      console.error(`  ${cycle.join(" -> ")}`);
      for (const { fromPackage, toPackage, from, to } of examples) {
        console.error(`    ${fromPackage} -> ${toPackage}: ${from} -> ${to}`);
      }
    }
  }

  if (subjectCycles.length > 0 || packageCycles.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("layout: no package or subject-folder cycles");
}

try {
  await check(workspaceFromArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`layout: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
