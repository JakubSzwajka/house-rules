import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";

export const commentsConsumerFiles = {
  "migrations.json": {
    modules: [{ package: "@house-rules/call-audit" }, { package: "@house-rules/comments" }],
  },
  "browser-contract.json": {
    forbidden: [
      {
        name: "browser-no-builtins",
        severity: "error",
        from: {},
        to: { dependencyTypes: ["core"] },
      },
      {
        name: "browser-no-direct-sql",
        severity: "error",
        from: { pathNot: "^node_modules/effect/" },
        to: { path: "^node_modules/effect/dist/(?:unstable/)?sql/" },
      },
      { name: "browser-no-unresolved", severity: "error", from: {}, to: { couldNotResolve: true } },
      {
        name: "browser-no-server",
        severity: "error",
        from: {},
        to: {
          path: "(?:^|/)(?:adapters|server)/|node_modules/@effect/(?:sql-|platform-node)|node_modules/@house-rules/(?:comments|application|domain)/dist/(?:index|facade|storage|delivery/(?:composition|fetch-handler|mcp-handler|invoke))\\.js$",
        },
      },
    ],
    options: {
      doNotFollow: { path: "^$" },
      enhancedResolveOptions: {
        conditionNames: ["browser", "import", "default"],
        exportsFields: ["exports"],
      },
    },
  },
  "comments.mjs": [
    'import assert from "node:assert/strict";',
    'import path from "node:path";',
    'import { Actor, ActorId, defineModule, memoryUnitOfWork } from "@house-rules/domain";',
    'import { CurrentActor, Grant, implement } from "@house-rules/application";',
    'import { Comments, CommentTargets, CommentTargetNotFound } from "@house-rules/comments";',
    'import * as contract from "@house-rules/comments/contract";',
    'import { Migrations } from "@house-rules/migrations";',
    'import { NodeRuntime, NodeServices } from "@effect/platform-node";',
    'import { Effect, FileSystem, Layer } from "effect";',
    'const actor = Actor.make({ id: ActorId.make("owner") });',
    'const outsider = Actor.make({ id: ActorId.make("outsider") });',
    'class Probe extends defineModule()("cold_probe", { make: Effect.succeed({ echo: (actor) => Effect.succeed(actor.id) }) }) {}',
    'const targets = Layer.succeed(CommentTargets, CommentTargets.of({ relation: (viewer) => Effect.succeed(viewer.id === actor.id ? "owner" : "none") }));',
    'const comments = Comments.layerMemory({ ...Comments.presets.default, targets: ["item"] }).pipe(Layer.provide(targets));',
    "const world = Layer.mergeAll(comments, Probe.layer, memoryUnitOfWork, Layer.succeed(CurrentActor, actor), Layer.succeed(Grant, Grant.fromPermissions(Object.values(contract.CommentPermissions))), NodeServices.layer);",
    "const add = implement(contract.addComment, ({ target, body }) => Effect.gen(function* () {",
    "  return yield* (yield* Comments).add(yield* CurrentActor, target, body);",
    "}));",
    "const list = implement(contract.listComments, ({ target, page }) => Effect.gen(function* () {",
    "  return yield* (yield* Comments).list(yield* CurrentActor, target, page);",
    "}));",
    "NodeRuntime.runMain(Effect.gen(function* () {",
    "  assert.equal(yield* (yield* Probe).echo(yield* CurrentActor), actor.id);",
    '  const target = { kind: "item", id: "packed" };',
    '  const added = yield* add.handler({ target, body: "Packed comment" });',
    "  assert.equal(added.authorId, actor.id);",
    "  const page = yield* list.handler({ target, page: { size: 10 } });",
    "  assert.deepEqual(page.items, [added]);",
    "  assert.equal(page.next, undefined);",
    "  const denied = yield* Effect.flip(list.handler({ target, page: { size: 10 } }).pipe(Effect.provideService(CurrentActor, outsider)));",
    "  assert.ok(denied instanceof CommentTargetNotFound);",
    '  const modules = yield* Migrations.readModuleList("migrations.json");',
    '  assert.deepEqual(modules.map(({ name, table }) => ({ name, table })), [{ name: "call_audit", table: "call_audit_migrations" }, { name: "comments", table: "comments_migrations" }]);',
    "  const fs = yield* FileSystem.FileSystem;",
    "  for (const module of modules) {",
    '    assert.equal(module.directory, path.resolve(`node_modules/@house-rules/${module.name.replaceAll("_", "-")}/migrations`));',
    "    const files = yield* fs.readDirectory(module.directory);",
    '    assert.ok(files.some((file) => file.endsWith(".sql")));',
    "  }",
    '  yield* Effect.log("cold install: defineModule, Actor/CurrentActor, memory comments use-cases, denied actor and installed migration resolution pass");',
    "}).pipe(Effect.provide(world)));",
    "",
  ].join("\n"),
  "comments.ts": [
    'import { Actor, ActorId, defineModule } from "@house-rules/domain";',
    'import { CurrentActor, implement } from "@house-rules/application";',
    'import { Comments, type CommentFailure, CommentTargets, type CommentRelation, CommentsOptions } from "@house-rules/comments";',
    'import { addComment, listComments, type Comment, type CommentTarget, type CommentPage, type CommentCursor, type CommentList, type CommentPermission, CommentPermissions } from "@house-rules/comments/contract";',
    'import { Effect } from "effect";',
    'export class Probe extends defineModule<Probe, { echo: (actor: Actor) => Effect.Effect<ActorId> }>()("cold_probe", { make: Effect.succeed({ echo: (actor: Actor) => Effect.succeed(actor.id) }) }) {}',
    'export const actor: Actor = Actor.make({ id: ActorId.make("owner") });',
    'export const options: CommentsOptions = { ...Comments.presets.default, targets: ["item"] };',
    'export const target: CommentTarget = { kind: "item", id: "packed" };',
    'export const cursor: CommentCursor = { createdAt: 1, id: "packed" };',
    "export const page: CommentPage = { size: 10, after: cursor };",
    "export const permission: CommentPermission = CommentPermissions.write;",
    'export const relations = CommentTargets.of({ relation: () => Effect.succeed<CommentRelation>("owner") });',
    "export const failureTag = (failure: CommentFailure): string => failure._tag;",
    "export const body = (comment: Comment): string => comment.body;",
    "export const items = (list: CommentList): ReadonlyArray<Comment> => list.items;",
    "export const add = implement(addComment, ({ target, body }) => Effect.gen(function* () { return yield* (yield* Comments).add(yield* CurrentActor, target, body); }));",
    "export const list = implement(listComments, ({ target, page }) => Effect.gen(function* () { return yield* (yield* Comments).list(yield* CurrentActor, target, page); }));",
    "// The shipped declarations keep the per-request marker: a module may not capture CurrentActor.",
    'export const captures = () => defineModule<Probe, { echo: (actor: Actor) => Effect.Effect<ActorId> }>()("cold_captures", {',
    "  // @ts-expect-error defineModule refuses a make that requires CurrentActor",
    "  make: Effect.map(CurrentActor, (current) => ({ echo: (_actor: Actor) => Effect.succeed(current.id) })),",
    "});",
    "// @ts-expect-error ActorId is branded",
    'export const invalidActor: Actor = { id: "unbranded" };',
    "// @ts-expect-error CommentPage requires a numeric size",
    'export const invalidPage: CommentPage = { size: "10" };',
    "",
  ].join("\n"),
};

export function assertFrameworkContents(source, packed, files) {
  if (source.houseRules?.migrations !== undefined) {
    assert.equal(packed.houseRules.migrations, "migrations");
    assert.ok(
      files.some((file) => /^migrations\/\d+_.+\.sql$/u.test(file)),
      `${source.name} ships no SQL migrations`,
    );
  }
  if (source.publishConfig?.exports === undefined) return;
  assert.ok(files.includes("AGENTS.md"), `${source.name} ships no agent guide`);
}

export function assertPackedComments(app, { run, write, failure }) {
  run(process.execPath, ["--no-experimental-strip-types", "comments.mjs"], app);
  const migrationCheck = run(
    process.execPath,
    ["node_modules/@house-rules/rules/bin/migrations.mjs"],
    app,
    { capture: true },
  );
  assert.match(migrationCheck, /owned by 2 package\(s\).*2 module\(s\) listed/u);
  console.log(migrationCheck.trim());
  assertBrowserGraph(app, { run, write, failure });
}

const CONTRACT_ENTRIES = ["comments", "application", "domain"].map(
  (name) => `node_modules/@house-rules/${name}/dist/contract.js`,
);

function assertBrowserGraph(app, { run, write, failure }) {
  const [entry] = CONTRACT_ENTRIES;
  const depcruise = path.join(app, "node_modules/.bin/depcruise");
  const args = ["--config", "browser-contract.json", "--output-type", "err-long", entry];
  run(
    depcruise,
    [
      "--config",
      "browser-contract.json",
      "--output-type",
      "json",
      "--output-to",
      "browser-graph.json",
      ...CONTRACT_ENTRIES,
    ],
    app,
  );
  const graph = JSON.parse(readFileSync(path.join(app, "browser-graph.json"), "utf8"));
  assert.equal(graph.summary.error, 0, JSON.stringify(graph.summary.violations));
  for (const expected of [...CONTRACT_ENTRIES, "node_modules/effect/dist/Schema.js"])
    assert.ok(
      graph.modules.some(({ source }) => source === expected),
      `browser graph skipped ${expected}`,
    );
  for (const kitEntry of CONTRACT_ENTRIES.slice(1)) {
    const kitOriginal = readFileSync(path.join(app, kitEntry), "utf8");
    try {
      write(app, { [kitEntry]: `${kitOriginal}\nimport "node:fs";\n` });
      assert.match(
        failure(
          depcruise,
          ["--config", "browser-contract.json", "--output-type", "err-long", kitEntry],
          app,
        ),
        /browser-no-builtins/u,
        `${kitEntry} passed with a node:fs import`,
      );
    } finally {
      write(app, { [kitEntry]: kitOriginal });
    }
  }
  const transitive = "node_modules/@house-rules/comments/dist/comment/permissions.js";
  const original = readFileSync(path.join(app, transitive), "utf8");
  try {
    write(app, { [transitive]: `${original}\nimport "./unsafe-transitive.js";\n` });
    write(app, {
      "node_modules/@effect/sql-pg/package.json": {
        name: "@effect/sql-pg",
        type: "module",
        exports: "./index.js",
      },
      "node_modules/@effect/sql-pg/index.js": "export const driver = 1;\n",
    });
    for (const specifier of [
      "node:fs",
      "effect/sql",
      "@effect/sql-pg",
      "@house-rules/application",
      "./missing.js",
    ]) {
      write(app, {
        "node_modules/@house-rules/comments/dist/comment/unsafe-transitive.js": `import "${specifier}";\n`,
      });
      assert.match(
        failure(depcruise, args, app),
        /browser-no-(?:builtins|server|direct-sql|unresolved)/u,
        `unsafe transitive ${specifier} passed`,
      );
    }
  } finally {
    write(app, { [transitive]: original });
  }
  console.log(
    `cold install: browser graph traverses ${graph.modules.length} packed modules from the comments, application and domain contract entries; unsafe imports fail despite contract trust`,
  );
}

export function assertContractRuleIsLive(app, { write, failure }) {
  // A clean run proves nothing unless the same rule still refuses the server entry.
  write(app, {
    "packages/catalogue/src/contract.ts":
      'export { showItemContract } from "./item/show-item.ts";\nexport { addComment } from "@house-rules/comments";\nexport { implement } from "@house-rules/application";\n',
  });
  assert.match(
    failure(
      path.join(app, "node_modules/.bin/depcruise"),
      ["--config", ".dependency-cruiser.cjs", "--output-type", "err", "apps", "packages"],
      app,
    ),
    /contract-entry-is-browser-safe: packages\/catalogue\/src\/contract\.ts → node_modules\/@house-rules\/application\/dist\/index\.js/u,
  );
  assert.match(
    failure(
      path.join(app, "node_modules/.bin/depcruise"),
      ["--config", ".dependency-cruiser.cjs", "--output-type", "err", "apps", "packages"],
      app,
    ),
    /contract-entry-is-browser-safe: packages\/catalogue\/src\/contract\.ts → node_modules\/@house-rules\/comments\/dist\/index\.js/u,
  );
}
