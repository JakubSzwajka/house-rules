# @house-rules/comments

A domain addition: a public support module for flat comments on an app's objects. Its module comes from `@house-rules/domain`, and its shipped contracts from `@house-rules/application/contract`. `Comments` exposes `list`, `add`, `edit`, `remove`, `removeTarget` and `erase`. User methods take an Actor. Writes need an open unit of work.

Version 0.2.0 is release-ready, not yet live on npm; 0.1.0 is. Pin `@house-rules/domain` 0.1.0, `@house-rules/application` 0.2.0 and Effect 4.0.3 exactly. The package ships built JavaScript and declarations in `dist/`, this guide, `AGENTS.md` and its SQL migrations. The workspace still imports `src/`; the packed package exports `dist/` with no bundler or type-stripping loader needed.

Mount `Comments.layerPostgres(options)` or `Comments.layerMemory(options)` in composition and fill the required `CommentTargets` host port. Options name allowed target kinds and cap body length and page size. The partial `Comments.presets.default` supplies limits but never chooses targets.

For a consumer on rules 0.17.0 whose own contract entry imports comments, add `trustedContractPackages: ["@house-rules/comments"]` to its existing `layout(...)` options. This trusts only the installed `/contract` entry, not the server entry. The packed-consumer check traverses its actual dependencies, including the domain and application contract entries and Effect, and rejects built-ins, direct contract imports of SQL, SQL drivers, storage adapters, server entries and unresolved imports without a bundler. Effect\'s root entry also reaches pure SQL abstractions through its own persistence exports. Those contain no drivers or Node imports and remain browser-loadable; this is not blanket trust for `@effect/*`.

The browser-safe `/contract` entry exports `listComments`, `addComment`, `editComment` and `removeComment`, their schemas, errors and permissions. The module knows no contracts. See `AGENTS.md` for mounting and deletion hooks.
