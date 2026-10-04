import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { resolveLink } from "./links.ts";

interface UrlNode {
  readonly url: string;
}

interface VisitContext {
  setProperty(node: UrlNode, key: "url", value: string): void;
}

interface FactoryContext {
  readonly fileURL: URL | undefined;
}

const linkPlugin = ({ fileURL }: FactoryContext) => {
  if (fileURL === undefined) {
    return undefined;
  }
  const file = fileURLToPath(fileURL);
  const rewrite = (node: UrlNode, context: VisitContext): void => {
    const url = resolveLink(file, node.url, "page");
    if (url !== undefined) {
      context.setProperty(node, "url", url);
    }
  };
  return { name: "house-rules-relative-links", link: rewrite, definition: rewrite };
};

export const relativeLinks = (): AstroIntegration => ({
  name: "house-rules-relative-links",
  hooks: {
    "astro:config:setup": ({ config }) => {
      // Pages link by relative file path, which ESLint checks against git; the built site needs routes.
      const processor = config.markdown.processor;
      if (processor.name !== "satteri") {
        throw new Error(
          `relativeLinks needs the satteri Markdown processor, not ${processor.name}.`,
        );
      }
      const options = processor.options as { mdastPlugins: unknown[] };
      options.mdastPlugins.push(linkPlugin);
    },
  },
});
