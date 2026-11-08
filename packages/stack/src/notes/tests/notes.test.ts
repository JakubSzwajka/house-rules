import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import { Roles } from "../../access/roles.ts";
import { person, system } from "../../actor/actor.ts";
import { CurrentActor } from "../../actor/current-actor.context.ts";
import { devTokens } from "../../auth/dev-tokens.ts";
import { SessionLive } from "../../auth/session-live.ts";
import { sessionClient } from "../../auth/session.middleware.ts";
import { targetKey } from "../../target/target.ts";
import * as Notes from "../index.ts";

class App extends Domain.Model("App", {
  aggregates: [...Notes.aggregates],
  views: [...Notes.views],
}) {}
class AppApi extends Domain.Api("AppApi", {
  model: App,
  commands: ["AddNote"],
  views: ["NotesOnTarget"],
}) {}

const { read, write } = Notes.NotesPermissions;
const story = Story.make(App, {});
const booking = { kind: "booking", id: "b-1" };
const key = targetKey(booking);
const n1 = Notes.Note.ref(Notes.NoteId.make("n-1"));
const n2 = Notes.Note.ref(Notes.NoteId.make("n-2"));
const ann = person("ann", { permissions: [read, write] });

describe("Notes", () => {
  it("the model is well defined", () => expect(Domain.verify(App)).toEqual([]));

  it.effect("adds a note by its author, or by a granted system actor", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(n1, new Notes.AddNote({ target: booking, body: "called the guest" })),
      Story.then(n1, new Notes.NoteAdded({ target: booking, by: "ann", body: "called the guest" })),
      Story.provide(CurrentActor, system("Import", [write])),
      Story.when(n2, new Notes.AddNote({ target: booking, body: "imported" })),
      Story.then(
        n2,
        new Notes.NoteAdded({ target: booking, by: "system:Import", body: "imported" }),
      ),
    ),
  );

  it.effect("refuses without the permission, past the limit, and never rewrites a note", () =>
    story(
      Story.given(n2, new Notes.NoteAdded({ target: booking, by: "ann", body: "first" })),
      Story.provide(CurrentActor, person("guest", { permissions: [read] })),
      Story.when(n1, new Notes.AddNote({ target: booking, body: "hi" })),
      Story.rejected(new Forbidden({ permission: write })),
      Story.provide(CurrentActor, ann),
      Story.when(n1, new Notes.AddNote({ target: booking, body: "x".repeat(4001) })),
      Story.rejected(new Notes.NoteTooLong({ max: 4000, length: 4001 })),
      Story.when(n2, new Notes.AddNote({ target: booking, body: "rewritten" })),
      Story.rejected(new Notes.NoteExists()),
      Story.state(n2, { _tag: "Added", body: "first" }),
    ),
  );

  it.effect("lists a target's notes oldest first", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.clock("2026-01-01T10:00:00Z"),
      Story.when(n2, new Notes.AddNote({ target: booking, body: "first" })),
      Story.then(n2, new Notes.NoteAdded({ target: booking, by: "ann", body: "first" })),
      Story.clock("2026-01-01T11:00:00Z"),
      Story.when(n1, new Notes.AddNote({ target: booking, body: "second" })),
      Story.then(n1, new Notes.NoteAdded({ target: booking, by: "ann", body: "second" })),
      Story.view(Notes.NotesOnTarget, key, {
        notes: [
          { id: n2.id, by: "ann", body: "first", addedAt: Date.parse("2026-01-01T10:00:00Z") },
          { id: n1.id, by: "ann", body: "second", addedAt: Date.parse("2026-01-01T11:00:00Z") },
        ],
      }),
      Story.view(Notes.NotesOnTarget, targetKey({ kind: "booking", id: "b-2" }), Story.none),
    ),
  );
});

describe("Notes over the Api", () => {
  const World = SessionLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        devTokens({
          "ann-token": { subject: "ann", orgId: null, roles: ["member"] },
          "eve-token": { subject: "eve", orgId: null, roles: ["guest"] },
        }),
        Roles.layer({ member: [read, write], guest: [] }),
      ),
    ),
    Layer.provideMerge(App.layer(Layer.empty).pipe(Layer.provide(platformForTests))),
  );
  const as = (token: string) => AppApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

  it.live("members add and read notes through the session; guests are refused", () =>
    Effect.gen(function* () {
      const annApi = yield* as("ann-token");
      const added = yield* annApi.AddNote(Notes.NoteId.make("n-api"), {
        target: booking,
        body: "hello",
      });
      const seen = yield* annApi.NotesOnTarget.get(key, { atLeast: added });
      expect(seen?.notes.map((n) => [n.by, n.body])).toEqual([["ann", "hello"]]);
      const eveApi = yield* as("eve-token");
      const refused = yield* eveApi
        .AddNote(Notes.NoteId.make("n-eve"), { target: booking, body: "hi" })
        .pipe(Effect.flip);
      expect(refused._tag).toBe("Forbidden");
      const hidden = yield* eveApi.NotesOnTarget.get(key).pipe(Effect.flip);
      expect(hidden._tag).toBe("Forbidden");
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});
