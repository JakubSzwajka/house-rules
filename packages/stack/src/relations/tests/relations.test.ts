import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import { Roles } from "../../access/roles.ts";
import { agent, person, system } from "../../actor/actor.ts";
import { CurrentActor } from "../../actor/current-actor.context.ts";
import { devTokens } from "../../auth/dev-tokens.ts";
import { SessionLive } from "../../auth/session-live.ts";
import { sessionClient } from "../../auth/session.middleware.ts";
import * as Relations from "../index.ts";

class Graph extends Domain.Model("Graph", {
  aggregates: [...Relations.aggregates],
  views: [...Relations.views],
}) {}
class GraphApi extends Domain.Api("GraphApi", {
  model: Graph,
  commands: ["Relate", "Unrelate"],
  views: ["NodeEdges"],
}) {}

const story = Story.make(Graph, {});
const { Edge, NodeEdges, Relate, EdgeRelated, Unrelate, EdgeUnrelated, edgeId } = Relations;
const writer = person("ann", { permissions: [Relations.RelationsPermissions.write] });
const contains = Edge.ref(edgeId("folder:1", "contains", "doc:1"));
const ends = { from: "folder:1", type: "contains", to: "doc:1" };
const related = new EdgeRelated({ ...ends, by: "ann" });
const relate = new Relate(ends);

describe("Edge", () => {
  it("the model is well defined", () => expect(Domain.verify(Graph)).toEqual([]));

  it.effect("relates two nodes and shows the edge on both", () =>
    story(
      Story.provide(CurrentActor, writer),
      Story.when(contains, relate),
      Story.then(contains, related),
      Story.view(NodeEdges, "folder:1", { out: [{ type: "contains", node: "doc:1" }], in: [] }),
      Story.view(NodeEdges, "doc:1", { out: [], in: [{ type: "contains", node: "folder:1" }] }),
    ),
  );

  it.effect("relating twice records nothing new", () =>
    story(
      Story.given(contains, related),
      Story.provide(CurrentActor, writer),
      Story.when(contains, relate),
      Story.then(contains),
      Story.view(NodeEdges, "folder:1", { out: [{ type: "contains", node: "doc:1" }], in: [] }),
    ),
  );

  it.effect("refuses an id that does not name the edge", () =>
    story(
      Story.provide(CurrentActor, writer),
      Story.when(Edge.ref(edgeId("folder:1", "contains", "doc:2")), relate),
      Story.rejected(
        new Relations.EdgeIdMismatch({ expected: edgeId("folder:1", "contains", "doc:1") }),
      ),
    ),
  );

  it.effect("refuses a person without relations:write", () =>
    story(
      Story.provide(CurrentActor, person("bob", { permissions: ["relations:read"] })),
      Story.when(contains, relate),
      Story.rejected(new Forbidden({ permission: "relations:write" })),
      Story.given(contains, related),
      Story.when(contains, new Unrelate()),
      Story.rejected(new Forbidden({ permission: "relations:write" })),
    ),
  );

  it.effect("lets a system actor with the grant relate", () =>
    story(
      Story.provide(CurrentActor, system("linker", ["relations:write"])),
      Story.when(contains, relate),
      Story.then(contains, new EdgeRelated({ ...ends, by: "system:linker" })),
    ),
  );

  it.effect("lets an agent with the grant relate as itself, and refuses one without it", () =>
    story(
      Story.provide(CurrentActor, agent("reader", "ann", { permissions: ["relations:read"] })),
      Story.when(contains, relate),
      Story.rejected(new Forbidden({ permission: "relations:write" })),
      Story.provide(CurrentActor, agent("claude", "ann", { permissions: ["relations:write"] })),
      Story.when(contains, relate),
      Story.then(contains, new EdgeRelated({ ...ends, by: "claude" })),
    ),
  );

  it.effect("unrelates and drops the edge from both nodes", () =>
    story(
      Story.given(contains, related),
      Story.given(
        Edge.ref(edgeId("folder:1", "contains", "doc:2")),
        new EdgeRelated({ from: "folder:1", type: "contains", to: "doc:2", by: "ann" }),
      ),
      Story.provide(CurrentActor, writer),
      Story.when(contains, new Unrelate()),
      Story.then(contains, new EdgeUnrelated({ ...ends, by: "ann" })),
      Story.view(NodeEdges, "folder:1", { out: [{ type: "contains", node: "doc:2" }], in: [] }),
      Story.view(NodeEdges, "doc:1", { out: [], in: [] }),
      Story.when(contains, new Unrelate()),
      Story.then(contains),
    ),
  );

  it.effect("a self edge shows as both outgoing and incoming", () =>
    story(
      Story.provide(CurrentActor, writer),
      Story.when(
        Edge.ref(edgeId("doc:1", "mentions", "doc:1")),
        new Relate({ from: "doc:1", type: "mentions", to: "doc:1" }),
      ),
      Story.then(
        Edge.ref(edgeId("doc:1", "mentions", "doc:1")),
        new EdgeRelated({ from: "doc:1", type: "mentions", to: "doc:1", by: "ann" }),
      ),
      Story.view(NodeEdges, "doc:1", {
        out: [{ type: "mentions", node: "doc:1" }],
        in: [{ type: "mentions", node: "doc:1" }],
      }),
    ),
  );
});

describe("GraphApi over Session", () => {
  const World = SessionLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        devTokens({
          "ann-token": { subject: "ann", orgId: null, roles: ["editor"] },
          "bob-token": { subject: "bob", orgId: null, roles: ["guest"] },
        }),
        Roles.layer({ editor: ["relations:read", "relations:write"], guest: [] }),
      ),
    ),
    Layer.provideMerge(Graph.layer(Layer.empty).pipe(Layer.provide(platformForTests))),
  );
  const as = (token: string) => GraphApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

  it.live("relates and reads edges with permissions from roles", () =>
    Effect.gen(function* () {
      const ann = yield* as("ann-token");
      yield* ann.Relate(edgeId("folder:9", "contains", "doc:9"), {
        from: "folder:9",
        type: "contains",
        to: "doc:9",
      });
      const edges = yield* ann.NodeEdges.get("doc:9").pipe(
        Effect.repeat({ until: (state) => (state?.in.length ?? 0) > 0, times: 50 }),
      );
      expect(edges).toEqual({ out: [], in: [{ type: "contains", node: "folder:9" }] });
      const bob = yield* as("bob-token");
      const refused = yield* bob.NodeEdges.get("doc:9").pipe(Effect.flip);
      expect(refused._tag).toBe("Forbidden");
      const unrelated = yield* bob
        .Unrelate(edgeId("folder:9", "contains", "doc:9"))
        .pipe(Effect.flip);
      expect(unrelated._tag).toBe("Forbidden");
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});
