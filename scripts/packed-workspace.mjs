export const workspaceConsumerFiles = {
  "packages/catalogue/package.json": {
    name: "@consumer/catalogue",
    version: "0.0.0",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
  },
  "packages/catalogue/src/item/show-item.ts": `import { defineNode, errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";
export class ItemNotFound extends Schema.TaggedError<ItemNotFound>()("ItemNotFound", { kind: errorKind("not_found") }) {}
export const showItem = defineNode("show_item", {
  description: "Show one catalogue item.",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Struct({ id: Schema.String, title: Schema.String }),
  failure: ItemNotFound, permission: null, readOnly: true,
});
// @ts-expect-error permission is required
 defineNode("no_permission", { description: "x", input: Schema.Struct({}), output: Schema.String, failure: ItemNotFound });
export const missing = new ItemNotFound();
`,
  "packages/catalogue/src/contract.ts":
    'export { showItem } from "./item/show-item.ts";\nexport { addComment, listComments, Comment, CommentPage } from "@house-rules/comments/contract";\n',
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
  "apps/web/src/features/show-owner/node.ts": `import { defineNode, NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";
export const showOwner = defineNode("show_owner", {
  description: "Show who is asking.", input: NoInput, output: Schema.String,
  failure: Schema.Never, permission: null, readOnly: true,
});
`,
  "apps/web/src/features/show-owner/handler.ts": `import { bindNode } from "@house-rules/application";
import { Effect } from "effect";
import { ownerOf } from "@consumer/ownership";
import { showOwner } from "./node.ts";
export const showOwnerHandler = bindNode(showOwner, (_input, { caller }) =>
  caller.kind === "person" ? ownerOf(caller.actor) : Effect.succeed("system"));
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
    exports: { ".": "./src/index.ts" },
  },
  "apps/web/src/ways-in/web/endpoints.ts": `import { defineEntry, endpoint } from "@house-rules/application/contract";
import { showOwner } from "../../features/show-owner/node.ts";
export const ownerEntry = defineEntry(showOwner);
export const ownerEndpoint = endpoint(ownerEntry, "GET /owner");
`,
  "apps/web/src/ways-in/web/way.ts": `import { defineWay, type WhoSocket, May, Mean } from "@house-rules/application";
import { ownerEntry, ownerEndpoint } from "./endpoints.ts";
export const openWeb = (who: WhoSocket) => defineWay({
  name: "web", path: "/", protocol: "http", entries: [ownerEntry], endpoints: [ownerEndpoint],
  who, may: May.fixed([ownerEntry], []), mean: Mean.no,
});
`,
  "apps/web/src/composition/index.ts": `import { Catalogue } from "@consumer/catalogue";
import { composition, type AnyEntry, type WayOptions, NodeRuntime, StepTrace } from "@house-rules/application";
import { Comments, CommentTargets, bindComments } from "@house-rules/comments";
import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { showOwnerHandler } from "../features/show-owner/handler.ts";
export const who = { resolve: () => Effect.succeed(Actor.make({ id: ActorId.make("owner") })) };
const targets = Layer.succeed(CommentTargets, CommentTargets.of({ relation: () => Effect.succeed("owner" as const) }));
const modules = Layer.merge(Catalogue.layer, Comments.layerMemory({ ...Comments.presets.default, targets: ["item"] }).pipe(Layer.provide(targets)));
export const createApp = <const Entries extends readonly AnyEntry[]>(entries: Entries, ways: readonly WayOptions<never, Entries>[]) => {
  const runtime = Layer.unwrap(Effect.gen(function* () {
    yield* Catalogue;
    const comments = yield* Comments;
    return NodeRuntime.layer({ bindings: [...bindComments(comments), showOwnerHandler], entries, ways });
  })).pipe(Layer.provide(modules));
  return composition({ layer: Layer.mergeAll(runtime, memoryUnitOfWork, StepTrace.layer()), entries, ways, system: [] });
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
  const app = createApp(way.entries, [way]);
  const router = toFetchHandler(app);
  return serve(router, { port: 0, onClose: () => router.dispose().then(() => app.dispose()) });
};
`,
};
