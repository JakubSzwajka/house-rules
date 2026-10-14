import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import css from "@eslint/css";
import tsParser from "@typescript-eslint/parser";
import { ESLint, RuleTester } from "eslint";
import plugin from "../src/index.mjs";

export const ACME = path.resolve(import.meta.dirname, "fixtures/acme");
export const ACME_TOKENS = path.join(ACME, "apps/web/src/styles/acme.css");
export const LANDING_TOKENS = path.join(ACME, "landing/styles/tokens.css");

// The scale-value configuration the Acme probe proposed.
export const ACME_SCALES = [
  {
    property: "^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$",
    allowed: ["2px", "3px", "4px", "5px", "6px", "8px", "10px", "12px", "999px"],
  },
  { property: "^(box|text)-shadow$", allowed: ["none"] },
  { property: "^(transition|animation)(-duration)?$", requireVar: "--t" },
];

export function rule(name) {
  return plugin.rules[name];
}

export function cssRuleTester() {
  return new RuleTester({ plugins: { css }, language: "css/css" });
}

export function sourceRuleTester() {
  return new RuleTester({
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  });
}

export function temporaryDirectory(files = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "house-rules-design-")));
  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

export function removeDirectory(root) {
  rmSync(root, { recursive: true, force: true });
}

export async function lintWith(cwd, config, patterns) {
  const eslint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: config });
  const results = await eslint.lintFiles(patterns);
  return results
    .flatMap(({ filePath, messages }) =>
      messages.map(({ ruleId, message, line, column, fatal }) => ({
        file: path.relative(cwd, filePath).split(path.sep).join("/"),
        rule: fatal ? "fatal" : ruleId.replace("house-rules/", ""),
        line,
        column,
        message,
      })),
    )
    .sort((left, right) =>
      left.file === right.file
        ? left.line - right.line || left.column - right.column
        : left.file < right.file
          ? -1
          : 1,
    );
}

export function countByRule(findings) {
  const counts = {};
  for (const { rule: ruleId } of findings) counts[ruleId] = (counts[ruleId] ?? 0) + 1;
  return counts;
}
