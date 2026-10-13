# @house-rules/comments

A private support module for flat comments on an app's objects. `Comments` exposes `list`, `add`, `edit`, `remove`, `removeTarget` and `erase`. User methods take an Actor. Writes need an open unit of work.

Mount `Comments.layerPostgres(options)` or `Comments.layerMemory(options)` in composition and fill the required `CommentTargets` host port. Options name allowed target kinds and cap body length and page size. The partial `Comments.presets.default` supplies limits but never chooses targets.

The browser-safe `/contract` entry exports `listComments`, `addComment`, `editComment` and `removeComment`, their schemas, errors and permissions. The module knows no contracts. See `AGENTS.md` for mounting and deletion hooks.
