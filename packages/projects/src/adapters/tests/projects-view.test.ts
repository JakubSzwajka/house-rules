import { expect, layer } from "@effect/vitest";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { Projects } from "../../index.js";
import { stores } from "./stores.js";
const postgres = stores[0];
layer(Projects.layer(Projects.presets.default).pipe(Layer.provideMerge(postgres.layer)), {
  excludeTestServices: true,
  timeout: "30 seconds",
})("Projects published view", (it) => {
  it.effect("publishes only its own stored columns", () =>
    Effect.gen(function* () {
      const projects = yield* Projects;
      const sql = yield* SqlClient;
      const { project } = yield* UnitOfWork.atomic(
        projects.create(Actor.make({ id: ActorId.make("owner") }), { slug: "view", name: "View" }),
      );
      expect(
        yield* sql`select id, slug, name, status, description, created_at::float8 as "createdAt", updated_at::float8 as "updatedAt" from projects_view where id = ${project.id}`,
      ).toEqual([project]);
    }),
  );
});
