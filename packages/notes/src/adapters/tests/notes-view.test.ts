import { expect, layer } from "@effect/vitest";
import { UnitOfWork } from "@house-rules/domain";
import { Effect } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { NoteStore } from "../../index.js";
import { stores } from "./stores.js";

layer(stores[0].layer, { excludeTestServices: true, timeout: "30 seconds" })(
  "Published notes view",
  (it) => {
    it.effect("exposes note text and target columns and follows target removal", () =>
      Effect.gen(function* () {
        const store = yield* NoteStore;
        const sql = yield* SqlClient;
        const note = {
          id: "view-note",
          target: { kind: "work_item", id: "123" },
          authorId: "author",
          body: "Searchable plain text",
          createdAt: 100,
        };
        yield* UnitOfWork.atomic(store.insert(note));
        expect(
          yield* sql`select id, target_kind, target_id, author_id, body, created_at::float8 as created_at from notes_view`,
        ).toEqual([
          {
            id: note.id,
            target_kind: note.target.kind,
            target_id: note.target.id,
            author_id: note.authorId,
            body: note.body,
            created_at: note.createdAt,
          },
        ]);
        yield* UnitOfWork.atomic(store.removeTarget(note.target));
        expect(yield* sql`select id from notes_view`).toEqual([]);
      }),
    );
  },
);
