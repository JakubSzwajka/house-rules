#!/usr/bin/env node
import path from "node:path";
import { cruise } from "dependency-cruiser";
import { findAppFolderCycles } from "../src/app-folder-cycles.mjs";
import { findContractExportProblems } from "../src/contract-exports.mjs";
import { loadLayoutConfig } from "../src/layout-config.mjs";
import { findPackageCycles } from "../src/package-cycles.mjs";
import { seeRuleLine } from "../src/rule-docs.mjs";
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
  const config = loadLayoutConfig(workspace);

  const { output } = await cruise(["."], {
    ...config.options,
    baseDir: workspace,
    ruleSet: { forbidden: config.forbidden, allowed: config.allowed ?? [] },
    validate: true,
    outputType: "json",
  });
  const report = JSON.parse(output);
  const appCycles = findAppFolderCycles(report.modules, config, workspace);
  for (const { rule, cycle } of appCycles) {
    console.error(`${rule}: ${cycle.join(" -> ")}`);
    console.error(seeRuleLine(rule));
  }
  const subjectCycles = findSubjectFolderCycles(report.modules, config, workspace);
  const packageCycles = await findPackageCycles(report.modules, config, { baseDir: workspace });
  const contractExports = await findContractExportProblems(config, workspace);

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

  if (contractExports.length > 0) {
    const manifests = new Set(contractExports.map(({ manifest }) => manifest));
    console.error(
      `contract-entry-is-browser-safe: ${manifests.size} package manifest(s) export more than "." and "./contract", or point them at the wrong file:`,
    );
    for (const { manifest, problem } of contractExports) {
      console.error(`  ${manifest}: ${problem}`);
    }
  }

  if (subjectCycles.length > 0) {
    console.error(seeRuleLine("no-subject-folder-cycles"));
  }
  if (packageCycles.length > 0) {
    console.error(seeRuleLine("no-package-cycles"));
  }
  if (contractExports.length > 0) {
    console.error(seeRuleLine("contract-entry-is-browser-safe"));
  }

  if (
    appCycles.length > 0 ||
    subjectCycles.length > 0 ||
    packageCycles.length > 0 ||
    contractExports.length > 0
  ) {
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
