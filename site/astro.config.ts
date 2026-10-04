import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";
import { accessibleBlocksIntegration, focusableCodeBlocks } from "./scripts/accessible-blocks.ts";
import { relativeLinks } from "./scripts/link-plugin.ts";
import { readRuleRows, TOOLS } from "./scripts/rule-rows.ts";
import { GITHUB_REPO, SECTIONS, SITE_SUMMARY, SITE_TITLE, SITE_URL } from "./scripts/site-map.ts";

const PARTS_MODULE = "virtual:house-rules/parts";

const PROCEDURE_ROUTES = ["start/adopt", "guides/effect"];
const PROCEDURE_ROUTE_PREFIXES = ["skills/"];

const readFacts = (route: string): readonly (readonly [string, string])[] => {
  // The parts list shows these rows, which lets content.css hide the generated table.
  const file = fileURLToPath(new URL(`./src/content/docs/${route}.md`, import.meta.url));
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "| Field | Value |");
  if (start === -1) {
    throw new Error(`${route}: no Field | Value table for the parts list.`);
  }
  const facts: (readonly [string, string])[] = [];
  for (const line of lines.slice(start + 2)) {
    const match = /^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/.exec(line.trim());
    if (match?.[1] === undefined || match[2] === undefined) {
      break;
    }
    facts.push([match[1], match[2]]);
  }
  return facts;
};

const partsSource = (): string => {
  // Read here, in Node: a component bundled by Vite cannot find the repo root.
  const parts = readRuleRows().map((row) => {
    const route = `rules/${row.tool.slug}/${row.slug}`;
    return { route, id: row.id, catches: row.catches, facts: readFacts(route) };
  });
  const procedures = { routes: PROCEDURE_ROUTES, prefixes: PROCEDURE_ROUTE_PREFIXES };
  return [
    `export const parts = ${JSON.stringify(parts)};`,
    `export const toolCount = ${TOOLS.length};`,
    `export const procedures = ${JSON.stringify(procedures)};`,
    "",
  ].join("\n");
};
const partsModule = () => ({
  name: "house-rules-parts",
  resolveId: (id: string) => (id === PARTS_MODULE ? `\0${PARTS_MODULE}` : undefined),
  load: (id: string) => (id === `\0${PARTS_MODULE}` ? partsSource() : undefined),
});

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  image: { service: passthroughImageService() },
  vite: { plugins: [partsModule()] },
  integrations: [
    relativeLinks(),
    accessibleBlocksIntegration(),
    starlight({
      title: SITE_TITLE,
      description: SITE_SUMMARY,
      logo: { src: "./src/assets/logo.svg", alt: "" },
      disable404Route: true,
      expressiveCode: { plugins: [focusableCodeBlocks] },
      social: [{ icon: "github", label: "GitHub", href: GITHUB_REPO }],
      customCss: [
        "./src/styles/fonts.css",
        "./src/styles/theme.css",
        "./src/styles/chrome.css",
        "./src/styles/content.css",
      ],
      components: {
        Hero: "./src/components/manual-hero.astro",
        PageTitle: "./src/components/page-title.astro",
      },
      head: [
        {
          tag: "link",
          attrs: {
            rel: "preload",
            href: "/fonts/public-sans-latin-700-normal.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: true,
          },
        },
        {
          tag: "link",
          attrs: { rel: "alternate", type: "text/plain", title: "llms.txt", href: "/llms.txt" },
        },
      ],
      sidebar: SECTIONS.map((section) => ({
        label: section.label,
        items:
          section.directory === "rules"
            ? [
                "rules",
                ...TOOLS.map((tool) => ({
                  label: tool.name,
                  collapsed: true,
                  items: [{ autogenerate: { directory: `rules/${tool.slug}` } }],
                })),
              ]
            : [{ autogenerate: { directory: section.directory } }],
      })),
    }),
  ],
});
