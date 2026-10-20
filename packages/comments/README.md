# @house-rules/comments

Comments owns flat, plain-text comments on an app's objects. It exposes `list`, `add`, `edit`, `remove`, `removeTarget` and `erase`. User methods take an explicit Actor. Writes join an open unit of work; they never open one.

Mount `Comments.layerPostgres(options)` or `Comments.layerMemory(options)` in composition and fill the required `CommentTargets` host port. Options name allowed target kinds and cap body length and page size. `Comments.presets.default` supplies limits of 4000 UTF-16 code units and 100 items, but never chooses target kinds. Register the package in `migrations.json`.

Acquire the service once and pass it to `bindComments(service)` when building the app's `NodeRuntime`. App nodes call its shipped descriptors through declared edges:

```text
listComments   comments:read    readOnly
addComment     comments:write   transactional
editComment    comments:write   transactional
removeComment  comments:write   transactional + destructive
```

All four have empty edges and require a person. No approval flag is added. Only app nodes become entries. The browser-safe `/contract` door exports these descriptors with schemas, errors and permissions, not the service or bindings.

Object policy stays in the module. Owners read, write and moderate; members read and write. Only authors edit. Missing targets, missing comments and denied access all look like `CommentTargetNotFound`, including calls from a system caller. Expected errors carry kinds at definition; a way may change their message, not their status or code.

The app must call `removeTarget` when deleting a target and `erase` when deleting an author, in the same unit. Targets have no cross-module foreign keys. Comments stores plain text and hard-deletes rows; it adds no rendering, threads or history.

Version 0.2.0 is prepared for release. Pin domain 0.1.0, application 0.2.0 and Effect 4.0.3 exactly. Published packages load built `dist/`; the workspace loads `src/`. Consumers whose rules preset requires a contract trust list add `@house-rules/comments` to `trustedContractPackages`, trusting only `/contract`. See [AGENTS.md](AGENTS.md) for mounting and checks.
