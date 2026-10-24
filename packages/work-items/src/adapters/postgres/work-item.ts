import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { WorkItemStore } from "../../storage.js";
import { WorkItem, WorkItemStoreUnavailable } from "../../work-item/work-item.js";
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(WorkItem));
const unavailable = (cause: unknown) => new WorkItemStoreUnavailable({ cause });
export const postgresWorkItemStore: Layer.Layer<WorkItemStore, never, SqlClient> = Layer.effect(
  WorkItemStore,
  Effect.gen(function* postgresWorkItemStore() {
    const sql = yield* SqlClient;
    const columns = sql.literal(`id, title, body, status,
    case when holder_kind is null then null else json_build_object('kind', holder_kind, 'id', holder_id) end as holder,
    parent,
    case when container_kind is null then null else json_build_object('kind', container_kind, 'id', container_id) end as container,
    attributes, created_at::float8 as "createdAt", updated_at::float8 as "updatedAt", closed_at::float8 as "closedAt"`);
    const read = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(Effect.flatMap(decodeRows), Effect.mapError(unavailable));
    const one = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      read(query).pipe(Effect.map((rows) => rows[0] ?? null));
    const write = Effect.fn("WorkItemStore.postgres.write")(function* (
      query: Effect.Effect<unknown, unknown>,
    ) {
      yield* UnitOfWork.required;
      yield* query.pipe(Effect.mapError(unavailable));
    });
    const values = (item: WorkItem) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      status: item.status,
      holder_kind: item.holder?.kind ?? null,
      holder_id: item.holder?.id ?? null,
      parent: item.parent,
      container_kind: item.container?.kind ?? null,
      container_id: item.container?.id ?? null,
      attributes: sql`${JSON.stringify(item.attributes)}::jsonb`,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      closed_at: item.closedAt,
    });
    return WorkItemStore.of({
      get: (id) => one(sql`select ${columns} from work_items where id = ${id}`),
      lock: (id) =>
        UnitOfWork.required.pipe(
          Effect.andThen(one(sql`select ${columns} from work_items where id = ${id} for update`)),
        ),
      list: (visible, filters) => {
        const allowed = visible.containers.map(
          (ref) => sql`(container_kind = ${ref.kind} and container_id = ${ref.id})`,
        );
        if (visible.inbox) allowed.push(sql`container_kind is null`);
        const conditions = [allowed.length === 0 ? sql`false` : sql.or(allowed)];
        if (filters.container !== undefined)
          conditions.push(
            filters.container === null
              ? sql`container_kind is null`
              : sql`container_kind = ${filters.container.kind} and container_id = ${filters.container.id}`,
          );
        if (filters.inbox) conditions.push(sql`container_kind is null`);
        if (filters.state !== undefined) conditions.push(sql`status = ${filters.state}`);
        if (filters.states !== undefined)
          conditions.push(
            filters.states.length === 0 ? sql`false` : sql.in("status", filters.states),
          );
        if (filters.holder !== undefined)
          conditions.push(
            filters.holder === null
              ? sql`holder_kind is null`
              : sql`holder_kind = ${filters.holder.kind} and holder_id = ${filters.holder.id}`,
          );
        if (filters.parent !== undefined)
          conditions.push(
            filters.parent === null ? sql`parent is null` : sql`parent = ${filters.parent}`,
          );
        if (filters.cursor !== undefined)
          conditions.push(
            sql`(created_at, id collate "C") > (${filters.cursor.createdAt}, ${filters.cursor.id})`,
          );
        const limit = filters.size === undefined ? sql`` : sql`limit ${filters.size}`;
        return read(
          sql`select ${columns} from work_items where ${sql.and(conditions)} order by created_at, id collate "C" ${limit}`,
        );
      },
      insert: (item) => write(sql`insert into work_items ${sql.insert(values(item))}`),
      save: (item) =>
        write(sql`update work_items set ${sql.update(values(item), ["id"])} where id = ${item.id}`),
      claim: Effect.fn("WorkItemStore.postgres.claim")(function* (item) {
        yield* UnitOfWork.required;
        // The predicate also protects callers that did not first acquire a row lock.
        const rows =
          yield* sql`update work_items set ${sql.update(values(item), ["id"])} where id = ${item.id} and (holder_kind is null or (holder_kind = ${item.holder?.kind ?? null} and holder_id = ${item.holder?.id ?? null})) returning id`.pipe(
            Effect.mapError(unavailable),
          );
        return rows.length === 1;
      }),
      removeContainer: (ref) =>
        write(
          sql`delete from work_items where container_kind = ${ref.kind} and container_id = ${ref.id}`,
        ),
      releaseHolder: (ref, updatedAt) =>
        write(
          sql`update work_items set holder_kind = null, holder_id = null, updated_at = ${updatedAt} where holder_kind = ${ref.kind} and holder_id = ${ref.id}`,
        ),
    });
  }),
);
