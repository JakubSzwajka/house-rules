# No broken relative links rule

Rule ID: `house-rules/no-broken-relative-links`

The rule runs on the `@eslint/markdown` language. A relative Markdown link, image or link reference definition must name an existing regular file inside the repository. Tracked files and non-ignored untracked files count. Missing files, ignored paths, outside-repository targets and directories fail. Use the `@house-rules/rules/markdown` preset to enable it.

```md
See the [setup guide](./setup.md).        <!-- passes when tracked or non-ignored untracked -->
See the [old guide](./old-setup.md).      <!-- reported: docs/old-setup.md is missing -->
See the [setup guide](./SETUP.md).        <!-- reported: case differs from docs/setup.md -->
```

The message names the target as written: `Broken relative link "./old-setup.md": no eligible file at that path.` The report covers the whole link, image, or definition node.

## What the rule checks

The rule visits mdast `link`, `image`, and `definition` nodes after `@eslint/markdown` has parsed the file. Code blocks, code spans, HTML blocks, HTML comments, and YAML front matter never produce those nodes, so links inside them are not checked. Footnote definitions are not link definitions and are not checked.

It skips these targets:

- an empty target
- a pure anchor such as `#install`
- a protocol-relative URL such as `//cdn.example.com/x.js`
- any target with a URI scheme, such as `https:`, `mailto:`, or `vscode:`
- any target containing `{`, which covers template placeholders such as `{pr_url}`

For every other target, the rule drops the `#fragment` and `?query`, decodes percent escapes, and resolves the result:

- A target starting with `/` resolves from the repository root.
- Any other target resolves from the linted file's directory.
- A target that climbs out of the repository root is broken.
- A directory target fails, with or without a trailing slash, even when it contains tracked files.
- A file symlink passes only when every alias and its final regular file are eligible, with exact case, inside the repository and the configured link root. Dangling links, cycles and aliases to ignored or outside targets fail. Children reached through a directory symlink are not listed candidates and fail.

The rule does not check fragments against headings. Raw HTML `href` and `src` attributes are not checked either.

## Check before commit

The rule gets candidates from `git ls-files --cached --others --exclude-standard`. It also removes tracked paths matched by Git's ignore rules. A candidate must still exist on disk as a regular file. Listing a deleted file in the index does not make it pass.

New non-ignored guides can pass before staging. This proves the links in the working checkout, not that every target is committed. CI and `pnpm acceptance`, which checks a clean clone of committed HEAD, catch links to files left out of the commit. Commit each linked file with its caller.

Path comparisons are exact and case-sensitive, even on a case-insensitive disk. So `./SETUP.md` cannot pass for `setup.md` locally and then fail on Linux.

The rule finds the repository with `git rev-parse --show-toplevel` from the linted file's directory, including linked worktrees. It refreshes candidates and tracked ignores once per linted file. Creating, renaming or deleting a file, or changing ignore rules, takes effect on the next lint without staging or restarting the editor. No index is needed. A failed listing in a known Git repository fails closed, with no filesystem fallback.

## Outside a git repository

When the linted file is not inside a git repository, or `git` is not installed, the rule does not crash. It falls back to the file system:

- `/` targets resolve from ESLint's working directory (`cwd`).
- A target counts when it exists on disk with the exact case of every path segment. This existing fallback still accepts directories and does not apply Git ignore rules.
- A target that climbs out of `cwd` is broken.
- A file outside `cwd` is not checked.

## Options

```ts
type Options = [
  {
    roots?: string[]; // default: []
  },
];
```

`roots` lists subdirectories that act as their own link root, relative to the repository root. Use it for a subtree that is published as its own repository or site, where a link that leaves the subtree breaks after publication.

For a file under one of the roots:

- A `/` target resolves from that root, not from the repository root.
- A target that climbs out of that root is broken, even when the path exists in the repository.

When roots are nested, the longest matching root wins. `./` prefixes and trailing slashes are ignored, so `"./packages/sdk/"` and `"packages/sdk"` mean the same root. Each entry must be a non-empty string, and entries must be unique.

```js
// eslint.config.mjs
import houseRulesMarkdown from "@house-rules/rules/markdown";

export default [
  ...houseRulesMarkdown,
  {
    files: ["**/*.md"],
    rules: {
      "house-rules/no-broken-relative-links": ["error", { roots: ["packages/sdk"] }],
    },
  },
];
```

With that config, `packages/sdk/docs/guide.md` may link to `/README.md`, which resolves to `packages/sdk/README.md`. A link from it to `../../docs/setup.md` is reported.

## Limitations

- ESLint `--cache` keys results on the linted file. If you delete or rename only the target file, the file holding the link is unchanged, and a cached run can miss the broken link. Run without `--cache` in CI, or clear the cache after moving files.
- The rule has no autofix.
- Only `.md` files are linted by the preset. MDX and other Markdown extensions need their own config.
