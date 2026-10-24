import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { NodeRef, Relation, RelationsStoreUnavailable } from "../../relation/relation.js";
import { RelationStore } from "../../storage.js";
const unavailable = (cause: unknown) => new RelationsStoreUnavailable({ cause });
export const postgresRelationStore: Layer.Layer<RelationStore, never, SqlClient> = Layer.effect(
  RelationStore,
  Effect.gen(function* postgresRelationStore() {
    const sql = yield* SqlClient;
    const columns = sql.literal(
      `id, type, json_build_object('kind', source_kind, 'id', source_id) as source, json_build_object('kind', target_kind, 'id', target_id) as target, created_at::float8 as "createdAt"`,
    );
    const read = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Relation))),
        Effect.mapError(unavailable),
      );
    const write = Effect.fn("RelationStore.postgres.write")(function* (
      query: Effect.Effect<unknown, unknown>,
    ) {
      yield* UnitOfWork.required;
      yield* query.pipe(Effect.mapError(unavailable));
    });
    const at = (node: NodeRef, direction: "out" | "in" | "both") =>
      sql.or([
        ...(direction !== "in"
          ? [sql`(source_kind = ${node.kind} and source_id = ${node.id})`]
          : []),
        ...(direction !== "out"
          ? [sql`(target_kind = ${node.kind} and target_id = ${node.id})`]
          : []),
      ]);
    return RelationStore.of({
      // Serialize same-type checks through commit. READ COMMITTED sees the preceding writer.
      lock: (type) => write(sql`select pg_advisory_xact_lock(1919249505, hashtext(${type}))`),
      list: (node, type, direction, size, after) =>
        read(sql`
        select ${columns} from relation_edges where ${at(node, direction)}
        and ${type === undefined ? sql`true` : sql`type = ${type}`}
        and ${after === undefined ? sql`true` : sql`(created_at, id collate "C") > (${after.createdAt}, ${after.id})`}
        order by created_at, id collate "C" limit ${size}`),
      count: (node, type, direction) =>
        sql`select count(*)::float8 as count from relation_edges where type = ${type} and ${at(node, direction)}`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ count: Schema.Int }))),
          ),
          Effect.map((rows) => rows[0]?.count ?? 0),
          Effect.mapError(unavailable),
        ),
      exists: (source, target, type) =>
        sql`select id from relation_edges where type = ${type} and source_kind = ${source.kind} and source_id = ${source.id} and target_kind = ${target.kind} and target_id = ${target.id} limit 1`.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError(unavailable),
        ),
      // UNION deduplicates nodes. The outer LIMIT stops recursive demand at the bound.
      reachable: (root, type, limit) =>
        sql`
        with recursive reached(kind, id) as (
          select ${root.kind}::text, ${root.id}::text
          union
          select e.target_kind, e.target_id from relation_edges e join reached r
            on e.source_kind = r.kind and e.source_id = r.id where e.type = ${type}
        ) select kind, id from reached limit ${limit}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(NodeRef))),
          Effect.mapError(unavailable),
        ),
      insert: (edge) =>
        write(
          sql`insert into relation_edges (id, type, source_kind, source_id, target_kind, target_id, created_at) values (${edge.id}, ${edge.type}, ${edge.source.kind}, ${edge.source.id}, ${edge.target.kind}, ${edge.target.id}, ${edge.createdAt})`,
        ),
      remove: Effect.fn("RelationStore.postgres.remove")(function* (id: string) {
        yield* UnitOfWork.required;
        const rows = yield* read(
          sql`delete from relation_edges where id = ${id} returning ${columns}`,
        );
        return rows[0];
      }),
      removeNode: (node) => write(sql`delete from relation_edges where ${at(node, "both")}`),
    });
  }),
);
