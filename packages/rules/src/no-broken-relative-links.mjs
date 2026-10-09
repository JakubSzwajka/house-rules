import { relativeLinkPath, resolveLink } from "./relative-links.mjs";
import { repositoryPathsFor } from "./repository-paths.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

export const noBrokenRelativeLinksRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("no-broken-relative-links"),
      description:
        "Require relative Markdown links, images, and definitions to point at a git-tracked path.",
    },
    messages: {
      broken: 'Broken relative link "{{target}}": no tracked file or directory at that path.',
    },
    schema: [
      {
        type: "object",
        properties: {
          roots: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ roots: [] }],
  },

  create(context) {
    const filename = context.physicalFilename ?? context.filename;
    const [{ roots }] = context.options;
    let repository;

    function check(node) {
      const linked = relativeLinkPath(node.url ?? "");
      if (linked === null) return;
      repository ??= repositoryPathsFor(filename, context.cwd) ?? false;
      if (!repository) return;
      const resolved = resolveLink(repository.fromFile, linked, roots);
      if (resolved !== null && repository.has(resolved)) return;
      context.report({ loc: node.position, messageId: "broken", data: { target: node.url } });
    }

    return { link: check, image: check, definition: check };
  },
};
