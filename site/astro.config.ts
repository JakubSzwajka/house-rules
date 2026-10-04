import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import type { AstroIntegration } from "astro";
import { defineConfig, passthroughImageService } from "astro/config";
import { accessibleBlocksIntegration, focusableCodeBlocks } from "./scripts/accessible-blocks.ts";
import { relativeLinks } from "./scripts/link-plugin.ts";
import { llmsFileAt } from "./scripts/llms-files.ts";
import { readRuleRows, TOOLS } from "./scripts/rule-rows.ts";
import { GITHUB_REPO, SECTIONS, SITE_SUMMARY, SITE_TITLE, SITE_URL } from "./scripts/site-map.ts";

const SHARE_IMAGE = `${SITE_URL}/og-image.png`;
const SHARE_IMAGE_ALT = "House Rules: checked rules for code that agents write.";

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

interface DevServer {
  readonly middlewares: {
    use(
      handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
    ): void;
  };
}

const devLlmsFiles = () => ({
  name: "house-rules-dev-llms",
  apply: "serve" as const, // a build gets these files in dist/ from scripts/llms.ts instead
  configureServer: (server: DevServer): void => {
    server.middlewares.use((request, response, next) => {
      const file = llmsFileAt(request.url ?? "");
      if (file === undefined) {
        next();
        return;
      }
      response.setHeader("Content-Type", file.contentType);
      response.end(file.text);
    });
  },
});

interface CodeNode {
  readonly tagName: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

interface CodeContext {
  setProperty(node: CodeNode, key: string, value: unknown): void;
  parent(node: CodeNode): CodeNode | undefined;
  textContent(node: CodeNode): string;
}

const markTokens = () => ({
  name: "house-rules-inline-tokens",
  element: {
    filter: ["code"],
    visit: (node: CodeNode, context: CodeContext): void => {
      const text = context.textContent(node);
      // hr-token keeps a path, rule name or short command on one line; browsers break after "-" and "/".
      if (context.parent(node)?.tagName === "pre" || (/\s/.test(text) && text.length > 32)) {
        return;
      }
      const className = node.properties?.["className"];
      context.setProperty(node, "className", [
        ...(Array.isArray(className) ? className : []),
        "hr-token",
      ]);
    },
  },
});

const inlineTokens = (): AstroIntegration => ({
  name: "house-rules-inline-tokens",
  hooks: {
    "astro:config:setup": ({ config }) => {
      const options = config.markdown.processor.options as { hastPlugins?: unknown[] };
      options.hastPlugins = [...(options.hastPlugins ?? []), markTokens];
    },
  },
});

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  image: { service: passthroughImageService() },
  vite: { plugins: [partsModule(), devLlmsFiles()] },
  integrations: [
    relativeLinks(),
    accessibleBlocksIntegration(),
    inlineTokens(),
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
        Footer: "./src/components/manual-footer.astro",
        Header: "./src/components/manual-header.astro",
        PageTitle: "./src/components/page-title.astro",
      },
      head: [
        ...["ibm-plex-sans-latin-400-normal", "ibm-plex-sans-condensed-latin-700-normal"].map(
          (face) => ({
            tag: "link" as const,
            attrs: {
              rel: "preload",
              href: `/fonts/${face}.woff2`,
              as: "font",
              type: "font/woff2",
              crossorigin: true,
            },
          }),
        ),
        {
          tag: "link",
          attrs: { rel: "alternate", type: "text/plain", title: "llms.txt", href: "/llms.txt" },
        },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
        { tag: "meta", attrs: { property: "og:image", content: SHARE_IMAGE } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: SHARE_IMAGE_ALT } },
        { tag: "meta", attrs: { name: "twitter:image", content: SHARE_IMAGE } },
        { tag: "meta", attrs: { name: "twitter:image:alt", content: SHARE_IMAGE_ALT } },
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
