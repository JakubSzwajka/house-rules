---
name: write-a-docs-page
description: Change a page on the House Rules docs site in site/. Know which of its two pages is hand-written and which is generated, link by relative path, and prove the build, llms.txt and the checks.
---

# Write a docs page

The docs site lives in `site/`. It is for people deciding on the template and starting a repo from it. Agents read `AGENTS.md` in their own repo, not the site. The site is two pages on purpose. Ask the owner before you add a third.

## 1. Know the pages

| Page | File | Edit |
| --- | --- | --- |
| Home, `/` | `site/src/content/docs/index.md` and `site/src/components/` | by hand |
| Start, `/start/` | `site/src/content/docs/start/index.md` | by hand |
| Rules, `/rules/` | `site/src/content/docs/rules/index.md` | generated from `packages/rules` |

To change the rules page, change its source: the rules table in `packages/rules/README.md`, or an ESLint rule's `meta.docs.description` in `packages/rules/src/`. Then run:

```sh
pnpm --filter @house-rules/site generate
```

Commit the regenerated page with the source change. `pnpm test` fails while it is stale.

Each row's anchor is its rule id, such as `/rules/#comment-discipline`. Error messages link to it. Never rename a rule's anchor.

## 2. Edit the start page

1. [ ] Keep it short: what House Rules is, how to make the repo, and what happens on commit.
2. [ ] Use `.md`, not `.mdx`. ESLint checks only `.md`.
3. [ ] Keep the frontmatter: `title`, a one-sentence `description`, and `sidebar.order`.
4. [ ] Start sections with `##`. Their slugs are anchors the home page links to, such as `/start/#what-it-is`; `scripts/tests/home.test.ts` checks them.
5. [ ] Use the words in `CONTEXT.md`. If `AGENTS.md` says it, cite it; do not restate the law in other words.

## 3. Link by relative path

Link to the rules page, or to a repo file, by its relative path from the page:

```md
See [the rules](../rules/index.md) and [`AGENTS.md`](../../../../../AGENTS.md).
```

ESLint's `no-broken-relative-links` checks each path against the files git tracks. At build time a page link becomes its route, and a repo link becomes a GitHub URL. Do not write `/rules/` by hand in Markdown: nothing checks it.

## 4. Keep the look

The theme is an assembly manual, and a docs page stays documentation first. Write Markdown and let the theme draw. Use a fenced code block for commands, a table for facts per item, and a `:::caution` aside for a trap. Do not add drawings, images, or inline SVG to a docs page. The figure belongs to the home page and the 404 page only.

## 5. Prove it

```sh
pnpm --filter @house-rules/site build
pnpm check
pnpm test
```

The build writes `site/dist/llms.txt`. Check that it still names both pages.

The theme lives in `site/src/styles/theme.css`, and `site/README.md` maps the rest of the look. A page never sets colors or fonts itself.
