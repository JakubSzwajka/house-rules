# Comment discipline rule

Rule ID: `house-rules/comment-discipline`

The rule keeps comments close to the code whose constraint they explain. It asks the author to remove comments that restate code and to prefer a clearer name, type, constant, assertion, or test. A retained comment must be a one-line, necessary, non-obvious why beside the constrained code.

## Accepted comments

A one-line comment is accepted inside a function, concise arrow body, class body, or method body. Decorator and declaration header areas are not body areas. JSX comments follow the same physical-line rule.

```js
function retry() {
  // The deadline must survive a backwards-moving remote clock.
  return schedule();
}
```

Comments are grouped when adjacent line comments are separated only by one ECMAScript line terminator and horizontal whitespace. A group must itself be one physical line to pass. A blank line or code starts a new group.

## Rejected comments

The rule reports one diagnostic for each group that fails. It does not autofix.

- Top-level narrative comments.
- Multiline block comments and multiline JSX comments.
- Adjacent line-comment groups.
- Comments in class, function, or method headers.
- Comments in parameters, decorators, interfaces, type literals, module blocks, or TypeScript type aliases.
- Comments in bodyless TypeScript function or method signatures.
- Comments before or after a concise arrow expression rather than inside its body boundary.

The message is:

> Rework this comment: remove it if it restates the code; prefer a clearer name, type, constant, assertion, or test. Keep only a necessary, non-obvious why in one line beside the constrained code.

The rule sets `meta.docs.url` to its row on the rules page, `https://stack.kubaszwajka.com/rules/#comment-discipline`. Every rule in this plugin does the same.

## Non-JS check

`house-rules-comments` checks actual comments in these files:

| Language | File names |
| --- | --- |
| Shell | `.sh`, `.bash` |
| Python | `.py` |
| YAML | `.yml`, `.yaml`, including `.github` workflows |
| Docker | `Dockerfile`, `Dockerfile.*`, `*.Dockerfile`, `Containerfile`, `Containerfile.*`, `*.Containerfile`, excluding names ending in `.dockerignore` |
| TOML | `.toml` |
| CSS | `.css` |

Extensions are case-insensitive. Docker and Containerfile names are case-sensitive. Markdown prose and unsupported languages are out of scope.

A retained comment occupies one physical line beside code. A standalone comment must directly precede code at the same indentation, after the first code line. Headers, detached comments and adjacent standalone groups fail. CSS comment-only lines are not code. A single CSS comment before or after code on its own line is inline. Multiple CSS comments on one physical line fail. Every multiline CSS comment fails, including tool controls and legal markers.

Each failing group produces one `file:line` diagnostic with the ESLint message above. An exception never exempts nearby prose. A valid executable shebang stands apart from comment groups. The checker cannot establish whether a one-line comment is necessary or true. Review must enforce the non-obvious why requirement.

### Run the check

```sh
pnpm exec house-rules-comments
pnpm exec house-rules-comments 'config/**/*.toml' '.github/**/*.yml'
pnpm exec house-rules-comments ./scripts/build.sh
```

The template exposes `pnpm run comments` and runs it before Biome in `pnpm check`. Exit 0 prints `comments: N file(s) checked`. Exit 1 means policy findings or an input/read error. Findings go to stderr as `file:line: message`; input errors begin with `comments:`. There is no autofix or suppression option.

With no arguments, run inside a Git worktree. The bin selects supported tracked and non-ignored untracked regular files under the current directory. It skips tracked deletions, symlinks and paths with symlink parents. Hidden workflow directories remain in scope.

Explicit inputs accept relative paths, `./` paths, absolute file paths inside the current directory, and quoted globs. Every input must match. Unsupported matched file types, missing files, directories, symlinks, options, `..` segments and paths outside the current directory fail visibly. Explicit inputs do not apply Git ignores. Traversal prunes `.git` and `node_modules` directories, including nested ones; explicit paths into them fail. Narrow globs start traversal at their literal directory prefix, not at the repository root.

Globs support `**`, `*`, `?`, character classes and `{a,b}` alternatives. Wildcards do not match a leading dot unless the pattern names it. Use `'.github/**/*.yml'`, not `'**/*.yml'`, to include hidden workflows.

### Non-JS exceptions

These are the only exceptions. Tool controls must fit on one physical line. The checker recognizes syntax but does not run the owning tool.

| Language | Accepted forms |
| --- | --- |
| All supported languages | Before code: `SPDX-License-Identifier: ID`, optionally `WITH EXCEPTION`; `@license`, `@preserve`, or copyright notices. SPDX cannot carry trailing narrative. CSS headers must also be single-line. |
| Shell and Python | Unindented first-line executable shebang, with an absolute interpreter path or `/bin/env` or `/usr/bin/env`, optionally `-S`. Shell interpreters: `sh`, `bash`, `dash`, `ksh`, `zsh`. Python: `python`, `python2`, `python3`, optionally a minor version. Arguments are `-` options, optionally with `=value`. Shell `-o`/`-O` and Python `-X`/`-W` also accept one word value. Other shebang argument grammars are outside this closed list. |
| Shell | `shellcheck disable=SC1234`, with comma-separated SC codes. |
| Python | PEP 263 forms `coding: utf-8`, `coding=utf-8`, `-*- coding: utf-8 -*-`, or `vim: set fileencoding=utf-8 :`. The Emacs form permits a trailing semicolon. Vim accepts `vi`, `ex`, `fenc`, and optional `set`. Only lines one or two qualify; line two requires a blank or comment-only first line. Prose wrappers do not qualify. |
| Python | `noqa`, optionally colon and comma-separated error codes; `type: ignore`, optionally bracketed codes; `pyright: ignore`, `strict`, `basic`, `standard`, or `off`, optionally bracketed codes. |
| YAML | `yaml-language-server: $schema=URL`, with a non-whitespace URL. |
| Docker | A leading contiguous parser-directive block: `syntax=IMAGE`, `escape=` followed by backslash or backtick, `check=skip=NAME[,NAME]`, `check=error=true` or `false`, or skip followed by `;error=true` or `false`. Skip accepts `all` or PascalCase names. Each lowercase key occurs once. A blank line, ordinary comment or instruction ends the block. Invalid or later directive-like comments fail even beside code. |
| Docker | `hadolint ignore=DL1234`, with comma-separated DL codes. |
| CSS | `eslint-disable`, `eslint-enable`, `eslint-disable-line`, `eslint-disable-next-line`, optionally comma-separated rule names; `# sourceMappingURL=URL`, with a non-whitespace URL. |
| TOML | No language-specific tool control. |

### Scanner limits

The bin tracks quoted strings, Python and TOML triple-quoted strings, simple shell heredocs, YAML block scalars and CSS comments. Python docstrings are strings, not checked prose. This policy is not a string linter.

Shell single-quoted backslashes are literal. Escaped hashes, arithmetic shifts and here-strings do not open comments or heredocs. Heredocs support one literal word delimiter, optionally quoted, with `<<` or tab-stripping `<<-`. Expanded or multiple delimiters and nested shell substitution contexts are outside the scanner's grammar.

YAML block scalars include mapping and sequence forms, with indentation and chomping indicators. Only unquoted code can open a block scalar, never a trailing comment. Scalar contents are data, not embedded shell or Python. The scanner tracks ordinary single-line YAML quoted values, not complete flow-collection or multiline quoted-scalar grammar. It does not validate a file's language grammar.

## Closed exceptions

Exceptions are syntax-owned forms. The rule accepts only their precise forms, and a nearby exception does not exempt prose in the same comment group.

- TypeScript line directives: `@ts-check`, `@ts-nocheck`, `@ts-ignore`, and `@ts-expect-error`. Single-line block forms are limited to `@ts-ignore` and `@ts-expect-error`.
- TypeScript triple-slash directives before code: `reference` with `path`, `types`, `lib`, or `no-default-lib`; `amd-module`; and `amd-dependency`, with their accepted attributes.
- ESLint block controls: `eslint-disable`, `eslint-enable`, and inline `eslint` rule settings. Line controls are limited to `eslint-disable-line` and `eslint-disable-next-line`.
- ESLint `global`, `globals`, and `exported` block comments.
- Biome `biome-ignore` and `biome-ignore-all` lint, format, and assist directives with a non-empty reason.
- Coverage directives from Istanbul, c8, v8, and Node coverage controls.
- `sourceMappingURL` comments.
- Block `@vite-ignore` and precise webpack magic comments for chunk names, mode, prefetch, preload, fetch priority, exports, include, exclude, and ignore.
- Block `#__PURE__`, `@__PURE__`, `#__NO_SIDE_EFFECTS__`, and `@__NO_SIDE_EFFECTS__` markers.
- Legal headers before the first code token: SPDX identifiers, `@license`, `@preserve`, and copyright notices.

A line form that its owning tool ignores is intentionally rejected. For example, `// eslint-disable`, `// eslint-env node`, and `// @vite-ignore` do not pass.
