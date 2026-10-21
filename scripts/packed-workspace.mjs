export const workspaceConsumerFiles = {
  "packages/catalogue/package.json": {
    name: "@consumer/catalogue",
    version: "0.0.0",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
  },
  "packages/catalogue/src/item/show-item.ts": `import { defineOperation, errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";
export class ItemNotFound extends Schema.TaggedError<ItemNotFound>()("ItemNotFound", { kind: errorKind("not_found") }) {}
export const showItem = defineOperation("show_item", {
  description: "Show one catalogue item.",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Struct({ id: Schema.String, title: Schema.String }),
  failure: ItemNotFound, permission: null, readOnly: true,
});
// @ts-expect-error permission is required
 defineOperation("no_permission", { description: "x", input: Schema.Struct({}), output: Schema.String, failure: ItemNotFound });
export const missing = new ItemNotFound();
`,
  "packages/catalogue/src/contract.ts":
    'export { showItem } from "./item/show-item.ts";\nexport { CommentsOperations, Comment, CommentPage } from "@house-rules/comments/contract";\n',
  "packages/catalogue/src/index.ts":
    'export { showItem } from "./contract.ts";\nexport { Catalogue } from "./facade.ts";\n',
  "packages/catalogue/src/facade.ts": `import { type Actor, type ActorId, defineModule } from "@house-rules/domain";
import { Effect } from "effect";
export class Catalogue extends defineModule<Catalogue, {
  readonly ownerOf: (actor: Actor) => Effect.Effect<ActorId>
}>()("@consumer/catalogue/Catalogue", {
  make: Effect.succeed({ ownerOf: (actor: Actor) => Effect.succeed(actor.id) }),
}) {}
`,
  "apps/web/package.json": {
    name: "@consumer/web",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: { "@consumer/catalogue": "0.0.0", "@consumer/ownership": "0.0.0" },
  },
  "apps/web/src/features/show-owner/index.ts": `import { NoInput } from "@house-rules/domain/contract";
import { defineFeature } from "@house-rules/application/contract";
import { OwnershipOperations } from "@consumer/ownership/contract";
import { Schema } from "effect";
export const showOwner = defineFeature("show_owner", {
  description: "Show who is asking.", input: NoInput, output: Schema.String,
  failure: Schema.Never, permission: null, flags: { readOnly: true },
  edges: [OwnershipOperations.ownerOf],
  handler: (input, { call }) => call(OwnershipOperations.ownerOf, input),
});
`,
  "apps/web/src/features/index.ts": `import { showOwner } from "./show-owner/index.ts";
export const Features = { showOwner } as const;
`,
  "packages/ownership/src/contract.ts": `import { defineOperation, NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";
export const OwnershipOperations = { ownerOf: defineOperation("owner_of", {
  description: "Show the caller.", input: NoInput, output: Schema.String,
  failure: Schema.Never, permission: null, readOnly: true,
}) } as const;
`,
  "packages/ownership/src/owner/owner.ts": `import { type Actor } from "@house-rules/domain";
import { Effect } from "effect";
export const ownerOf = (actor: Actor) => Effect.succeed(actor.id);
`,
  "packages/ownership/src/index.ts": 'export { ownerOf } from "./owner/owner.ts";\n',
  "packages/ownership/package.json": {
    name: "@consumer/ownership",
    version: "0.0.0",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
  },
  "apps/web/src/ways-in/web/endpoints.ts": `import { endpoint } from "@house-rules/application/contract";
import { Features } from "../../features/index.ts";
export const ownerFeature = Features.showOwner;
export const ownerEndpoint = endpoint(ownerFeature, "GET /owner");
`,
  "apps/web/src/ways-in/web/way.ts": `import { defineWay, type WhoSocket, May, Mean } from "@house-rules/application";
import { ownerFeature, ownerEndpoint } from "./endpoints.ts";
export const openWeb = (who: WhoSocket) => defineWay({
  name: "web", path: "/", protocol: "http", features: [ownerFeature], endpoints: [ownerEndpoint],
  who, may: May.fixed([ownerFeature], []), mean: Mean.no,
});
`,
  "apps/web/src/composition/index.ts": `import { Catalogue } from "@consumer/catalogue";
import { composition, type AnyFeature, type WayOptions, Runtime, StepTrace, bindOperation } from "@house-rules/application";
import { Comments, CommentTargets, bindComments } from "@house-rules/comments";
import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { ownerOf } from "@consumer/ownership";
import { OwnershipOperations } from "@consumer/ownership/contract";
export const who = { resolve: () => Effect.succeed(Actor.make({ id: ActorId.make("owner") })) };
const targets = Layer.succeed(CommentTargets, CommentTargets.of({ relation: () => Effect.succeed("owner" as const) }));
const modules = Layer.merge(Catalogue.layer, Comments.layerMemory({ ...Comments.presets.default, targets: ["item"] }).pipe(Layer.provide(targets)));
export const createApp = <const Entries extends readonly AnyFeature[]>(features: Entries, ways: readonly WayOptions<never, Entries>[]) => {
  const runtime = Layer.unwrap(Effect.gen(function* () {
    yield* Catalogue;
    const comments = yield* Comments;
    return Runtime.layer({ bindings: [...bindComments(comments),
      bindOperation(OwnershipOperations.ownerOf, (_input, { caller }) =>
        caller.kind === "person" ? ownerOf(caller.actor) : Effect.succeed("system")),
    ], features, ways });
  })).pipe(Layer.provide(modules));
  return composition({ layer: Layer.mergeAll(runtime, memoryUnitOfWork, StepTrace.layer()), features, ways, system: [] });
};
`,
  "apps/web/src/main.ts": `import { NodeServices } from "@effect/platform-node";
import { toFetchHandler } from "@house-rules/application";
import { serve } from "@house-rules/node-host";
import { Effect, FileSystem } from "effect";
import { createApp, who } from "./composition/index.ts";
import { openWeb } from "./ways-in/web/way.ts";
export const nodeProbe = FileSystem.FileSystem.use((fs) => fs.exists("package.json")).pipe(Effect.provide(NodeServices.layer));
export const startHost = () => {
  const way = openWeb(who);
  const app = createApp(way.features, [way]);
  const router = toFetchHandler(app);
  return serve(router, { port: 0, onClose: () => router.dispose().then(() => app.dispose()) });
};
`,
};
