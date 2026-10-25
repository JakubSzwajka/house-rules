import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { NoteStore } from "../../storage.js";
import { Note, NoteStoreUnavailable } from "../../note/note.js";
const Row = Note;
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const unavailable = (cause: unknown) => new NoteStoreUnavailable({ cause });
export const postgresNoteStore: Layer.Layer<NoteStore, never, SqlClient> = Layer.effect(
  NoteStore,
  Effect.gen(function* postgresNoteStore() {
    const sql = yield* SqlClient;
    const columns = sql.literal(
      `id, json_build_object('kind', target_kind, 'id', target_id) as target, author_id as "authorId", body, created_at::float8 as "createdAt"`,
    );
    const read = (query: Effect.Effect<ReadonlyArray<unknown>, unknown>) =>
      query.pipe(Effect.flatMap(decodeRows), Effect.mapError(unavailable));
    const write = Effect.fn("NoteStore.postgres.write")(function* (
      query: Effect.Effect<unknown, unknown>,
    ) {
      yield* UnitOfWork.required;
      yield* query.pipe(Effect.mapError(unavailable));
    });
    return NoteStore.of({
      list: (ref, page) =>
        read(
          page.after === undefined
            ? sql`select ${columns} from notes where target_kind = ${ref.kind} and target_id = ${ref.id} order by created_at, id collate "C" limit ${page.size}`
            : sql`select ${columns} from notes where target_kind = ${ref.kind} and target_id = ${ref.id} and (created_at, id collate "C") > (${page.after.createdAt}, ${page.after.id}) order by created_at, id collate "C" limit ${page.size}`,
        ),
      insert: (note) =>
        write(
          sql`insert into notes (id, target_kind, target_id, author_id, body, created_at) values (${note.id}, ${note.target.kind}, ${note.target.id}, ${note.authorId}, ${note.body}, ${note.createdAt})`,
        ),
      removeTarget: (ref) =>
        write(sql`delete from notes where target_kind = ${ref.kind} and target_id = ${ref.id}`),
      erase: (authorId) => write(sql`delete from notes where author_id = ${authorId}`),
    });
  }),
);
