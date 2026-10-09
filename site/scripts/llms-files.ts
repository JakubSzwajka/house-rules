import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GITHUB_REPO, SECTIONS, SITE_SUMMARY, SITE_TITLE, SITE_URL } from "./site-map.ts";

export const LLMS_PATH = "llms.txt";

export const llmsText = (): string =>
  `${[
    `# ${SITE_TITLE}`,
    `> ${SITE_SUMMARY}`,
    "House Rules is a GitHub template for TypeScript monorepos. Every repo made from it gets the same checks, pins and hooks. A git hook runs `pnpm check` and then `pnpm test` before each commit.",
    [
      "## Pages",
      "",
      ...SECTIONS.map(
        (section) => `- [${section.label}](${SITE_URL}/${section.directory}/): ${section.summary}`,
      ),
    ].join("\n"),
    [
      "## For agents",
      "",
      "Working in a repo made from House Rules? Read `AGENTS.md` at its root: it is the law there, and it wins over this site. Each framework package the app mounts ships its own `AGENTS.md`, such as `node_modules/@house-rules/capability/AGENTS.md`. Read those too.",
    ].join("\n"),
    `Source: ${GITHUB_REPO}`,
  ].join("\n\n")}\n`;

export interface LlmsFile {
  readonly contentType: string;
  readonly text: string;
}

export const llmsFileAt = (urlPath: string): LlmsFile | undefined => {
  const path = decodeURIComponent(urlPath.split(/[?#]/)[0] ?? "").replace(/^\/+/, "");
  return path === LLMS_PATH
    ? { contentType: "text/plain; charset=utf-8", text: llmsText() }
    : undefined;
};

export const writeLlmsFile = (outDir: string): void => {
  writeFileSync(join(outDir, LLMS_PATH), llmsText());
};
