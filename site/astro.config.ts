import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";
import { accessibleBlocksIntegration, focusableCodeBlocks } from "./scripts/accessible-blocks.ts";
import { relativeLinks } from "./scripts/link-plugin.ts";
import { TOOLS } from "./scripts/rule-rows.ts";
import { GITHUB_REPO, SECTIONS, SITE_SUMMARY, SITE_TITLE, SITE_URL } from "./scripts/site-map.ts";

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  image: { service: passthroughImageService() },
  integrations: [
    relativeLinks(),
    accessibleBlocksIntegration(),
    starlight({
      title: SITE_TITLE,
      description: SITE_SUMMARY,
      expressiveCode: { plugins: [focusableCodeBlocks] },
      social: [{ icon: "github", label: "GitHub", href: GITHUB_REPO }],
      customCss: [
        "./src/styles/fonts.css",
        "./src/styles/theme.css",
        "./src/styles/chrome.css",
        "./src/styles/content.css",
      ],
      components: {
        Hero: "./src/components/door-hero.astro",
        PageTitle: "./src/components/page-title.astro",
      },
      head: [
        {
          tag: "link",
          attrs: {
            rel: "preload",
            href: "/fonts/bungee-latin-400-normal.woff2",
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
