import { UnitOfWork } from "@house-rules/capability";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { CommentStore } from "../../storage.js";
import { Comment, CommentStoreUnavailable } from "../../comment/comment.js";

const Row = Schema.Struct({ ...Comment.fields, editedAt: Schema.NullOr(Schema.Int) });
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const unavailable = (cause: unknown) => new CommentStoreUnavailable({ cause });

export const postgresCommentStore: Layer.Layer<CommentStore, never, SqlClient> = Layer.effect(
  CommentStore,
  Effect.gen(function* postgresCommentStore() {
    const sql = yield* SqlClient;
    const columns =
      sql.literal(`id, json_build_object('kind', target_kind, 'id', target_id) as target,
      author_id as "authorId", body, created_at::float8 as "createdAt", edited_at::float8 as "editedAt"`);
    const read = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(
        Effect.flatMap(decodeRows),
        Effect.map((rows) =>
          rows.map(({ editedAt, ...row }) => (editedAt === null ? row : { ...row, editedAt })),
        ),
        Effect.mapError(unavailable),
      );
    const write = Effect.fn("CommentStore.postgres.write")(function* (
      query: Effect.Effect<unknown, unknown>,
    ) {
      yield* UnitOfWork.required;
      yield* query.pipe(Effect.mapError(unavailable));
    });
    return CommentStore.of({
      find: (id) =>
        read(sql`select ${columns} from comments where id = ${id}`).pipe(
          Effect.map((rows) => rows[0]),
        ),
      list: (ref, page) =>
        read(
          page.after === undefined
            ? sql`select ${columns} from comments where target_kind = ${ref.kind} and target_id = ${ref.id}
            order by created_at, id collate "C" limit ${page.size}`
            : sql`select ${columns} from comments where target_kind = ${ref.kind} and target_id = ${ref.id}
            and (created_at, id collate "C") > (${page.after.createdAt}, ${page.after.id})
            order by created_at, id collate "C" limit ${page.size}`,
        ),
      insert: (comment) =>
        write(sql`insert into comments
        (id, target_kind, target_id, author_id, body, created_at, edited_at)
        values (${comment.id}, ${comment.target.kind}, ${comment.target.id}, ${comment.authorId},
          ${comment.body}, ${comment.createdAt}, ${comment.editedAt ?? null})`),
      edit: Effect.fn("CommentStore.postgres.edit")(function* (
        id: string,
        body: string,
        editedAt: number,
      ) {
        yield* UnitOfWork.required;
        const rows = yield* read(sql`update comments set body = ${body}, edited_at = ${editedAt}
          where id = ${id} returning ${columns}`);
        return rows[0];
      }),
      remove: (id) => write(sql`delete from comments where id = ${id}`),
      removeTarget: (ref) =>
        write(sql`delete from comments where target_kind = ${ref.kind} and target_id = ${ref.id}`),
      erase: (authorId) => write(sql`delete from comments where author_id = ${authorId}`),
    });
  }),
);
