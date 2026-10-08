import tsParser from "@typescript-eslint/parser";
import { commentDisciplineRule } from "./comment-discipline.mjs";
import { designNoRawColorLiteralRule } from "./design-no-raw-color-literal.mjs";
import { designNoRawColorRule } from "./design-no-raw-color.mjs";
import { designNoUnknownTokenRule } from "./design-no-unknown-token.mjs";
import { designScaleValueRule } from "./design-scale-value.mjs";
import { noBrokenRelativeLinksRule } from "./no-broken-relative-links.mjs";
import { noHandRolledSurfaceRule } from "./no-hand-rolled-surface.mjs";
import { useCaseIsCapabilityRule } from "./use-case-is-capability.mjs";

const plugin = {
  meta: {
    name: "@house-rules/rules",
    version: "0.8.0",
  },
  rules: {
    "comment-discipline": commentDisciplineRule,
    "no-broken-relative-links": noBrokenRelativeLinksRule,
    "design-no-raw-color": designNoRawColorRule,
    "design-no-raw-color-literal": designNoRawColorLiteralRule,
    "design-no-unknown-token": designNoUnknownTokenRule,
    "design-scale-value": designScaleValueRule,
    "use-case-is-capability": useCaseIsCapabilityRule,
    "no-hand-rolled-surface": noHandRolledSurfaceRule,
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

plugin.configs.capability = [
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
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "house-rules/use-case-is-capability": "error",
    },
  },
];

export { plugin };
export default plugin;
