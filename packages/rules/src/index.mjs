import tsParser from "@typescript-eslint/parser";
import { commentDisciplineRule } from "./comment-discipline.mjs";
import { designCssLayersRule } from "./design-css-layers.mjs";
import { designNoRawColorLiteralRule } from "./design-no-raw-color-literal.mjs";
import { designNoRawColorRule } from "./design-no-raw-color.mjs";
import { designNoRawElementRule } from "./design-no-raw-element.mjs";
import { designNoUnknownTokenRule } from "./design-no-unknown-token.mjs";
import { designScaleValueRule } from "./design-scale-value.mjs";
import hosts from "./hosts.cjs";
import layoutOptions from "./layout-option-parsers.cjs";
import { noBrokenRelativeLinksRule } from "./no-broken-relative-links.mjs";
import { noComputedImportRule } from "./no-computed-import.mjs";
import { noHandRolledSurfaceRule } from "./no-hand-rolled-surface.mjs";
import { noHandRunEffectRule } from "./no-hand-run-effect.mjs";
import { testingExportsOnlyInTestsRule } from "./testing-exports-only-in-tests.mjs";
import { featureFileRule } from "./feature-file.mjs";
import { featureBuildersRule } from "./feature-builders.mjs";
import { esmOnlyEffectRule } from "./esm-only-effect.mjs";
import { ruleAnchor, ruleDocsUrl, RULES_PAGE_URL, SITE_URL } from "./rule-docs.mjs";

const plugin = {
  meta: {
    name: "@house-rules/rules",
    version: "0.18.0",
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
    "feature-file": featureFileRule,
    "feature-builders": featureBuildersRule,
    "esm-only-effect": esmOnlyEffectRule,
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

// Use the same roots as layout(), including app descriptor dependency trees.
function featuresConfig({ packagesDir = "packages", appsDir = "apps" } = {}) {
  const caller = "featuresConfig()";
  const packageRoots = layoutOptions.rootsOption(packagesDir, "packagesDir", caller);
  const appRoots = layoutOptions.rootsOption(appsDir, "appsDir", caller);
  layoutOptions.disjointRoots(appRoots, packageRoots, caller);
  const appOptions = { appsDir: appRoots.entries };
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
      files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
      rules: {
        "house-rules/feature-file": ["error", appOptions],
        "house-rules/esm-only-effect": [
          "error",
          { ...appOptions, packagesDir: packageRoots.entries },
        ],
        "house-rules/feature-builders": [
          "error",
          { ...appOptions, packagesDir: packageRoots.entries },
        ],
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
      files: [...packageRoots.entries, ...appRoots.entries].map(
        (root) => `${root}/*/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`,
      ),
      ignores: ["**/{tests,test,__tests__}/**", "**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
      rules: {
        "house-rules/no-computed-import": "error",
      },
    },
  ];
}

plugin.configs.features = featuresConfig();

// A block with only `name` and `ignores` is a global ignore: ESLint never reads those paths.
plugin.configs.nextHost = [
  { name: "house-rules/next-host", ignores: [...hosts.HOSTS.next.eslintIgnores] },
];

export { featuresConfig, plugin, ruleAnchor, ruleDocsUrl, RULES_PAGE_URL, SITE_URL };
export default plugin;
