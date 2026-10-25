import { appendFileSync, globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

export default async function* nodeReporter(events) {
  const tests = [];
  for await (const { type, data } of events) {
    if (
      (type === "test:pass" || type === "test:fail") &&
      data.details?.type !== "suite" &&
      data.file &&
      data.name !== data.file
    ) {
      tests.push({ file: data.file, name: data.name, duration: data.details?.duration_ms });
    }
  }
  if (process.env.CI) {
    try {
      const folder = resolve(repoRoot, "coverage/slow-tests", relative(repoRoot, process.cwd()));
      mkdirSync(folder, { recursive: true });
      writeFileSync(resolve(folder, "slow-node-tests.json"), JSON.stringify({ tests }));
    } catch {
      console.warn("Slow tests: could not write Node timings.");
    }
  }
}

export function collectTests(root = process.cwd()) {
  const tests = [];
  const warnings = [];
  const reports = globSync("coverage/slow-tests/**/slow-*.json", { cwd: root });
  for (const report of reports) {
    try {
      const folder = relative("coverage/slow-tests", dirname(report));
      const pkg = JSON.parse(readFileSync(resolve(root, folder, "package.json"), "utf8")).name;
      const result = JSON.parse(readFileSync(resolve(root, report), "utf8"));
      const entries =
        result.tests ??
        result.testResults.flatMap((suite) =>
          suite.assertionResults.map((test) => ({
            file: suite.name,
            name: test.fullName,
            duration: test.duration,
          })),
        );
      for (const test of entries) {
        if (!Number.isFinite(test.duration)) continue;
        tests.push({
          package: pkg,
          file: relative(
            root,
            isAbsolute(test.file) ? test.file : resolve(root, folder, test.file),
          ),
          name: test.name,
          duration: test.duration,
        });
      }
    } catch {
      warnings.push(`Could not read ${report}.`);
    }
  }
  return {
    tests: tests.sort((a, b) => b.duration - a.duration),
    warnings,
    reports: reports.length,
  };
}

const cell = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("`", "&#96;")
    .replaceAll(/[\r\n]/gu, " ");

export function renderSummary({ tests, warnings, reports }) {
  const slow = tests.filter((test) => test.duration > 1000);
  return [
    "## Slow tests (> 1000 ms)",
    "",
    `${reports} timing reports, ${tests.length} tests, ${slow.length} over 1000 ms. Missing reports may mean a suite did not finish.`,
    "",
    "| Package | File | Test | Duration (ms) |",
    "| --- | --- | --- | ---: |",
    ...slow.map(
      (test) =>
        `| ${cell(test.package)} | ${cell(test.file)} | ${cell(test.name)} | ${test.duration.toFixed(1)} |`,
    ),
    ...warnings.map((warning) => `\n${cell(warning)}`),
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const summary = renderSummary(collectTests());
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch {
    console.warn("Slow tests: summary unavailable. Test results are unchanged.");
  }
}
