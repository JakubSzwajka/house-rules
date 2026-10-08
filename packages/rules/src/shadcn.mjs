import { plugin } from "@shadcn/lint";
import tsParser from "@typescript-eslint/parser";

const PREFIX = "shadcn";
const SEVERITIES = ["off", "warn", "error"];
// The five core rules as shadcn-ui/lint docs/adoption.md (tag @shadcn/lint@0.2.0) enables them, plus
// no-unknown-classes at warn, as the same page advises.
const RECOMMENDED = {
  "no-restyle": ["error", { allow: ["layout"] }],
  "no-raw-colors": ["error"],
  "no-arbitrary-values": ["error", { allow: ["layout"] }],
  "no-inline-styles": ["error"],
  "require-static-classes": ["error"],
  "no-unknown-classes": ["warn"],
};
const COMPONENT_RULES_OFF = ["no-restyle", "no-arbitrary-values", "require-static-classes"];
const DEFAULT_FILES = ["**/*.{jsx,tsx}"];
const DEFAULT_COMPONENTS = ["**/components/ui/**"];

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new TypeError(`shadcn(): ${label} must be an array of non-empty strings.`);
  }
  return value;
}

function checkSeverity(value, label) {
  if (!SEVERITIES.includes(value)) {
    throw new TypeError(`shadcn(): ${label} must be one of ${SEVERITIES.join(", ")}.`);
  }
  return value;
}

function isOptions(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidRule(name) {
  return new TypeError(
    `shadcn(): rules["${name}"] must be false, a severity, an options object, or [severity, options].`,
  );
}

function ruleEntry(name, setting, severity) {
  const [defaultSeverity, defaultOptions] = RECOMMENDED[name];
  const level = severity ?? defaultSeverity;
  const withOptions = (entrySeverity, options) =>
    entrySeverity === "off" || !options ? entrySeverity : [entrySeverity, options];

  if (setting === undefined) return withOptions(level, defaultOptions);
  if (setting === false) return "off";
  if (typeof setting === "string")
    return withOptions(checkSeverity(setting, `rules["${name}"]`), defaultOptions);
  if (Array.isArray(setting)) {
    if (setting.length !== 2 || !isPlainObject(setting[1])) throw invalidRule(name);
    checkSeverity(setting[0], `rules["${name}"][0]`);
    return [...setting];
  }
  if (isPlainObject(setting)) return withOptions(level, { ...defaultOptions, ...setting });
  throw invalidRule(name);
}

// Builds flat-config blocks for @shadcn/lint: one block for the app's JSX and TSX, and one that turns off
// the three rules a component folder needs off. Pass `components: false` to skip the second block.
export function shadcn({
  files = DEFAULT_FILES,
  components = DEFAULT_COMPONENTS,
  severity,
  rules = {},
  settings,
} = {}) {
  stringArray(files, "files");
  if (severity !== undefined) checkSeverity(severity, "severity");
  if (!isPlainObject(rules)) {
    throw new TypeError("shadcn(): rules must be an object keyed by rule name.");
  }
  for (const name of Object.keys(rules)) {
    if (!Object.hasOwn(RECOMMENDED, name)) {
      throw new TypeError(
        `shadcn(): unknown rule "${name}". Known rules: ${Object.keys(RECOMMENDED).join(", ")}.`,
      );
    }
  }
  if (settings !== undefined && !isOptions(settings)) {
    throw new TypeError("shadcn(): settings must be an object, the value of settings.shadcn.");
  }

  const blocks = [
    {
      files,
      languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: { [PREFIX]: plugin },
      ...(settings ? { settings: { shadcn: settings } } : {}),
      rules: Object.fromEntries(
        Object.keys(RECOMMENDED).map((name) => [
          `${PREFIX}/${name}`,
          ruleEntry(name, rules[name], severity),
        ]),
      ),
    },
  ];
  if (components !== false) {
    stringArray(components, "components");
    blocks.push({
      // Each inner array is an AND: a file in the component folder that the first block also lints.
      files: components.flatMap((folder) => files.map((pattern) => [folder, pattern])),
      plugins: { [PREFIX]: plugin },
      rules: Object.fromEntries(COMPONENT_RULES_OFF.map((name) => [`${PREFIX}/${name}`, "off"])),
    });
  }
  return blocks;
}

export default shadcn;
