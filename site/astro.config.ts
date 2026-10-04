import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";
import { relativeLinks } from "./scripts/link-plugin.ts";
import { TOOLS } from "./scripts/rule-rows.ts";
import { GITHUB_REPO, SECTIONS, SITE_SUMMARY, SITE_TITLE, SITE_URL } from "./scripts/site-map.ts";

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  image: { service: passthroughImageService() },
  integrations: [
    relativeLinks(),
    starlight({
      title: SITE_TITLE,
      description: SITE_SUMMARY,
      social: [{ icon: "github", label: "GitHub", href: GITHUB_REPO }],
      customCss: ["./src/styles/theme.css"],
      head: [
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
