import houseRules, { capabilityConfig } from "@house-rules/rules";
import design from "@house-rules/rules/design";
import houseRulesMarkdown from "@house-rules/rules/markdown";
import shadcn from "@house-rules/rules/shadcn";

const exampleApps = "examples/booking-platform/apps/*";

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
  ...design({
    tokenFiles: ["examples/booking-platform/apps/api/src/delivery/web/styles.css"],
    css: { files: [`${exampleApps}/src/**/*.css`] },
    source: { files: [`${exampleApps}/src/**/*.{ts,tsx}`] },
  }),
  ...shadcn({
    files: [`${exampleApps}/src/**/*.{jsx,tsx}`],
    components: [`${exampleApps}/src/delivery/web/components/ui/**`],
  }),
  {
    files: ["packages/rules/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: { "house-rules/comment-discipline": "off" },
  },
  {
    files: ["packages/rules/bin/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: { "house-rules/no-computed-import": "error" },
  },
];
