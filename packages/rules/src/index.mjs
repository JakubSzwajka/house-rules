import tsParser from "@typescript-eslint/parser";
import { commentDisciplineRule } from "./comment-discipline.mjs";
import { designCssLayersRule } from "./design-css-layers.mjs";
import { designNoRawColorLiteralRule } from "./design-no-raw-color-literal.mjs";
import { designNoRawColorRule } from "./design-no-raw-color.mjs";
import { designNoRawElementRule } from "./design-no-raw-element.mjs";
import { designNoUnknownTokenRule } from "./design-no-unknown-token.mjs";
import { designScaleValueRule } from "./design-scale-value.mjs";
import hosts from "./hosts.cjs";
import { noBrokenRelativeLinksRule } from "./no-broken-relative-links.mjs";
import { noComputedImportRule } from "./no-computed-import.mjs";
import { noHandRolledSurfaceRule } from "./no-hand-rolled-surface.mjs";
import { noHandRunEffectRule } from "./no-hand-run-effect.mjs";
import { testingExportsOnlyInTestsRule } from "./testing-exports-only-in-tests.mjs";
import { useCaseIsCapabilityRule } from "./use-case-is-capability.mjs";
import { ruleAnchor, ruleDocsUrl, RULES_PAGE_URL, SITE_URL } from "./rule-docs.mjs";

const plugin = {
  meta: {
    name: "@house-rules/rules",
    version: "0.17.0",
  },
  rules: {
    "comment-discipline": commentDisciplineRule,
    "no-broken-relative-links": noBrokenRelativeLinksRule,
    "design-no-raw-color": designNoRawColorRule,
    "design-no-raw-color-literal": designNoRawColorLiteralRule,
    "design-no-raw-element": designNoRawElementRule,
    "design-no-unknown-token": designNoUnknownTokenRule,
    "design-scale-value": designScaleValueRule,
    "design-css-layers": designCssLayersRule,
    "use-case-is-capability": useCaseIsCapabilityRule,
    "no-hand-rolled-surface": noHandRolledSurfaceRule,
    "no-hand-run-effect": noHandRunEffectRule,
    "no-computed-import": noComputedImportRule,
    "testing-exports-only-in-tests": testingExportsOnlyInTestsRule,
  },
  configs: {},
};

plugin.configs.recommended = [
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "house-rules": plugin,
    },
    rules: {
      "house-rules/comment-discipline": "error",
    },
  },
];

const testingRules = {
  "house-rules/testing-exports-only-in-tests": "error",
};

plugin.configs.testing = [
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "house-rules": plugin,
    },
    rules: { ...testingRules },
  },
];

// One packages root for the whole preset: pass the folder layout({ packagesDir }) names, so
// no-computed-import covers the same package source that contract-entry-is-browser-safe follows.
function capabilityConfig({ packagesDir = "packages" } = {}) {
  if (
    typeof packagesDir !== "string" ||
    !packagesDir ||
    packagesDir.startsWith("/") ||
    packagesDir.endsWith("/") ||
    /[*?{}[\]!]/u.test(packagesDir)
  ) {
    throw new TypeError(
      'capabilityConfig(): packagesDir must be a non-empty relative path without a leading or trailing "/" or glob characters.',
    );
  }
  return [
    {
      files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          ecmaFeatures: {
            jsx: true,
          },
        },
      },
      plugins: {
        "house-rules": plugin,
      },
      rules: {
        "house-rules/no-hand-rolled-surface": "error",
        ...testingRules,
      },
    },
    {
      files: ["**/*.{ts,tsx,mts,cts}"],
      rules: {
        "house-rules/use-case-is-capability": "error",
      },
    },
    {
      files: [
        "**/{tests,test,__tests__}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
        "**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      ],
      rules: {
        "house-rules/no-hand-run-effect": "error",
      },
    },
    // Package source a contract entry may reach. Dependency Cruiser records no edge for import(at).
    {
      files: [`${packagesDir}/*/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`],
      ignores: ["**/{tests,test,__tests__}/**", "**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
      rules: {
        "house-rules/no-computed-import": "error",
      },
    },
  ];
}

plugin.configs.capability = capabilityConfig();

// A block with only `name` and `ignores` is a global ignore: ESLint never reads those paths.
plugin.configs.nextHost = [
  { name: "house-rules/next-host", ignores: [...hosts.HOSTS.next.eslintIgnores] },
];

export { capabilityConfig, plugin, ruleAnchor, ruleDocsUrl, RULES_PAGE_URL, SITE_URL };
export default plugin;
