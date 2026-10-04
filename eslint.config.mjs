import houseRules from "@house-rules/rules";
import houseRulesMarkdown from "@house-rules/rules/markdown";

export default [
  { ignores: ["**/node_modules/", "**/dist/", "**/coverage/", "**/generated/", ".agent_sources/"] },
  ...houseRules.configs.recommended,
  ...houseRules.configs.capability,
  ...houseRulesMarkdown,
  {
    files: ["packages/rules/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: { "house-rules/comment-discipline": "off" },
  },
];
