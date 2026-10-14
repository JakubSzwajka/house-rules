import houseRules, { capabilityConfig } from "@house-rules/rules";
import houseRulesMarkdown from "@house-rules/rules/markdown";

export default [
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/coverage/",
      "**/generated/",
      ".agent_sources/",
      ".pi/specs/**/prototypes/",
      "site/.astro/",
    ],
  },
  ...houseRules.configs.recommended,
  ...capabilityConfig({
    appsDir: ["apps", "examples/*/apps"],
    packagesDir: ["packages", "examples/*/packages"],
  }),
  ...houseRulesMarkdown,
  {
    files: ["packages/rules/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: { "house-rules/comment-discipline": "off" },
  },
  {
    files: ["packages/rules/bin/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: { "house-rules/no-computed-import": "error" },
  },
];
