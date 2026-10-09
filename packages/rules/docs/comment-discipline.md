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
