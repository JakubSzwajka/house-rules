import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { ProjectStore } from "../../storage.js";
import { Project, ProjectSlugTaken, ProjectStoreUnavailable } from "../../project/project.js";
import { projectOrder } from "../../project/order.js";
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Project));
const unavailable = (cause: unknown) => new ProjectStoreUnavailable({ cause });
export const postgresProjectStore: Layer.Layer<ProjectStore, never, SqlClient> = Layer.effect(
  ProjectStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const columns = sql.literal(
      'id, slug, name, status, description, created_at::float8 as "createdAt", updated_at::float8 as "updatedAt"',
    );
    const read = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(Effect.flatMap(decodeRows), Effect.mapError(unavailable));
    // One transaction lock keeps rename conflicts and read/modify/write changes atomic.
    const lock = Effect.gen(function* () {
      yield* UnitOfWork.required;
      yield* sql`select pg_advisory_xact_lock(hashtext('house-rules/projects'))`.pipe(
        Effect.mapError(unavailable),
      );
    });
    const save = Effect.fn("ProjectStore.postgres.save")(function* (
      project: Project,
      insert: boolean,
    ) {
      yield* lock;
      const taken =
        yield* sql`select id from projects where slug = ${project.slug} and id <> ${project.id}`.pipe(
          Effect.mapError(unavailable),
        );
      if (taken.length > 0) return yield* new ProjectSlugTaken({ slug: project.slug });
      const rows = yield* read(
        insert
          ? sql`insert into projects (id, slug, name, status, description, created_at, updated_at) values (${project.id}, ${project.slug}, ${project.name}, ${project.status}, ${project.description}, ${project.createdAt}, ${project.updatedAt}) on conflict (slug) do nothing returning ${columns}`
          : sql`update projects set slug = ${project.slug}, name = ${project.name}, status = ${project.status}, description = ${project.description}, updated_at = ${project.updatedAt} where id = ${project.id} returning ${columns}`,
      );
      if (rows.length === 0)
        return yield* new ProjectStoreUnavailable({ cause: "Project write returned no row." });
    });
    return ProjectStore.of({
      lock,
      get: (ref) =>
        read(
          "id" in ref
            ? sql`select ${columns} from projects where id = ${ref.id}`
            : sql`select ${columns} from projects where slug = ${ref.slug}`,
        ).pipe(Effect.map((rows) => rows[0])),
      list: (status, ids) => {
        if (ids !== undefined && ids.length === 0) return Effect.succeed([]);
        return read(
          sql`select ${columns} from projects where ${status === undefined ? sql`true` : sql`status = ${status}`} and ${ids === undefined ? sql`true` : sql`id in ${sql.in(ids)}`}`,
        ).pipe(Effect.map((rows) => [...rows].sort(projectOrder)));
      },
      insert: (project) => save(project, true),
      replace: (project) => save(project, false),
    });
  }),
);
