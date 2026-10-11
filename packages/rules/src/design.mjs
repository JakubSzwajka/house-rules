import css from "@eslint/css";
import tsParser from "@typescript-eslint/parser";
import plugin from "./index.mjs";

const PREFIX = "house-rules";
const CSS_RULES = [
  "design-no-raw-color",
  "design-no-unknown-token",
  "design-scale-value",
  "design-css-layers",
];
const SOURCE_RULES = ["design-no-raw-color-literal"];
const TOKEN_RULES = new Set([
  "design-no-raw-color",
  "design-no-unknown-token",
  "design-css-layers",
]);
// Opt-in rules: off until the app passes their options.
const OPT_IN_RULES = new Set(["design-scale-value", "design-css-layers"]);
const DEFAULT_CSS_FILES = ["**/*.css"];
const DEFAULT_SOURCE_FILES = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new TypeError(`design(): ${label} must be an array of non-empty strings.`);
  }
  return value;
}

function ruleEntry(name, setting, tokenFiles) {
  if (setting === false) return "off";
  if (OPT_IN_RULES.has(name) && setting === undefined) return "off";
  if (name === "design-scale-value") return ["error", setting];
  const options = { ...(TOKEN_RULES.has(name) ? { tokenFiles } : {}), ...setting };
  return Object.keys(options).length ? ["error", options] : "error";
}

function ruleBlock(names, settings, tokenFiles) {
  return Object.fromEntries(
    names.map((name) => [`${PREFIX}/${name}`, ruleEntry(name, settings[name], tokenFiles)]),
  );
}

// Builds flat-config blocks for design-token checks. Pass `css: false` or `source: false` to skip a block,
// and `rules: { "<rule>": false }` to turn one rule off.
export function design({ tokenFiles = [], css: cssOptions = {}, source = {}, rules = {} } = {}) {
  stringArray(tokenFiles, "tokenFiles");
  for (const name of Object.keys(rules)) {
    if (!CSS_RULES.includes(name) && !SOURCE_RULES.includes(name)) {
      throw new TypeError(
        `design(): unknown rule "${name}". Known rules: ${[...CSS_RULES, ...SOURCE_RULES].join(", ")}.`,
      );
    }
  }

  const blocks = [];
  if (cssOptions !== false) {
    blocks.push({
      files: stringArray(cssOptions.files ?? DEFAULT_CSS_FILES, "css.files"),
      plugins: { css, [PREFIX]: plugin },
      language: "css/css",
      rules: ruleBlock(CSS_RULES, rules, tokenFiles),
    });
  }
  if (source !== false) {
    blocks.push({
      files: stringArray(source.files ?? DEFAULT_SOURCE_FILES, "source.files"),
      languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: { [PREFIX]: plugin },
      rules: ruleBlock(SOURCE_RULES, rules, tokenFiles),
    });
  }
  return blocks;
}

export default design;
