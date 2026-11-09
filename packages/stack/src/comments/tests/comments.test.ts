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
import { targetKey } from "../../target/target.ts";
import * as Comments from "../index.ts";

class App extends Domain.Model("App", {
  aggregates: [...Comments.aggregates],
  views: [...Comments.views],
}) {}
class AppApi extends Domain.Api("AppApi", {
  model: App,
  commands: ["AddComment", "EditComment", "DeleteComment"],
  views: ["CommentsOnTarget"],
}) {}

const { read, write, moderate } = Comments.CommentsPermissions;
const story = Story.make(App, {});
const booking = { kind: "booking", id: "b-1" };
const key = targetKey(booking);
const c1 = Comments.Comment.ref(Comments.CommentId.make("c-1"));
const c2 = Comments.Comment.ref(Comments.CommentId.make("c-2"));
const ann = person("ann", { permissions: [read, write] });
const bob = person("bob", { permissions: [read, write] });
const mod = person("mo", { permissions: [write, moderate] });
const posted = new Comments.CommentAdded({ target: booking, by: "ann", body: "hello" });
const tooLong = "x".repeat(Comments.MAX_COMMENT_LENGTH + 1);

describe("Comments", () => {
  it("the model is well defined", () => expect(Domain.verify(App)).toEqual([]));

  it.effect("adds a comment by its author", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(c1, new Comments.AddComment({ target: booking, body: "hello" })),
      Story.then(c1, posted),
      Story.state(c1, { _tag: "Posted", by: "ann", body: "hello" }),
    ),
  );

  it.effect("refuses to add without the permission, past the limit, or on a used id", () =>
    story(
      Story.given(c2, posted),
      Story.provide(CurrentActor, person("guest", { permissions: [read] })),
      Story.when(c1, new Comments.AddComment({ target: booking, body: "hi" })),
      Story.rejected(new Forbidden({ permission: write })),
      Story.provide(CurrentActor, ann),
      Story.when(c1, new Comments.AddComment({ target: booking, body: tooLong })),
      Story.rejected(new Comments.CommentTooLong({ max: 4000, length: 4001 })),
      Story.when(c2, new Comments.AddComment({ target: booking, body: "again" })),
      Story.rejected(new Comments.CommentExists()),
    ),
  );

  it.effect("lets only the author edit, within the limit", () =>
    story(
      Story.given(c1, posted),
      Story.provide(CurrentActor, ann),
      Story.when(c1, new Comments.EditComment({ body: "hello again" })),
      Story.then(
        c1,
        new Comments.CommentEdited({ target: booking, by: "ann", body: "hello again" }),
      ),
      Story.when(c1, new Comments.EditComment({ body: tooLong })),
      Story.rejected(new Comments.CommentTooLong({ max: 4000, length: 4001 })),
      Story.provide(CurrentActor, mod),
      Story.when(c1, new Comments.EditComment({ body: "moderated" })),
      Story.rejected(new Comments.NotAuthor({ author: "ann" })),
      Story.provide(CurrentActor, person("guest", { permissions: [read] })),
      Story.when(c1, new Comments.EditComment({ body: "nope" })),
      Story.rejected(new Forbidden({ permission: write })),
    ),
  );

  it.effect("refuses to edit a missing or deleted comment", () =>
    story(
      Story.given(c1, posted, new Comments.CommentDeleted({ target: booking, by: "ann" })),
      Story.provide(CurrentActor, ann),
      Story.when(c1, new Comments.EditComment({ body: "back" })),
      Story.rejected(new Comments.CommentNotFound()),
      Story.when(c2, new Comments.EditComment({ body: "who" })),
      Story.rejected(new Comments.CommentNotFound()),
    ),
  );

  it.effect("lets the author delete, and refuses another person", () =>
    story(
      Story.given(c1, posted),
      Story.provide(CurrentActor, bob),
      Story.when(c1, new Comments.DeleteComment()),
      Story.rejected(new Comments.NotAuthor({ author: "ann" })),
      Story.provide(CurrentActor, ann),
      Story.when(c1, new Comments.DeleteComment()),
      Story.then(c1, new Comments.CommentDeleted({ target: booking, by: "ann" })),
      Story.when(c1, new Comments.DeleteComment()),
      Story.then(c1),
      Story.when(c2, new Comments.DeleteComment()),
      Story.rejected(new Comments.CommentNotFound()),
      Story.provide(CurrentActor, person("guest")),
      Story.when(c1, new Comments.DeleteComment()),
      Story.rejected(new Forbidden({ permission: write })),
    ),
  );

  it.effect("lets an agent author its own comments, and not its person's", () =>
    story(
      Story.given(c2, posted),
      Story.provide(CurrentActor, agent("claude", "ann", { permissions: [read, write] })),
      Story.when(c1, new Comments.AddComment({ target: booking, body: "on it" })),
      Story.then(c1, new Comments.CommentAdded({ target: booking, by: "claude", body: "on it" })),
      Story.when(c1, new Comments.EditComment({ body: "done" })),
      Story.then(c1, new Comments.CommentEdited({ target: booking, by: "claude", body: "done" })),
      Story.when(c2, new Comments.EditComment({ body: "rewritten" })),
      Story.rejected(new Comments.NotAuthor({ author: "ann" })),
      Story.when(c2, new Comments.DeleteComment()),
      Story.rejected(new Comments.NotAuthor({ author: "ann" })),
      Story.provide(CurrentActor, ann),
      Story.when(c1, new Comments.DeleteComment()),
      Story.rejected(new Comments.NotAuthor({ author: "claude" })),
    ),
  );

  it.effect("lets a moderator or a granted system actor delete anyone's comment", () =>
    story(
      Story.given(c1, posted),
      Story.given(c2, new Comments.CommentAdded({ target: booking, by: "bob", body: "spam" })),
      Story.provide(CurrentActor, mod),
      Story.when(c1, new Comments.DeleteComment()),
      Story.then(c1, new Comments.CommentDeleted({ target: booking, by: "mo" })),
      Story.provide(CurrentActor, system("BookingRemoval", [write, moderate])),
      Story.when(c2, new Comments.DeleteComment()),
      Story.then(c2, new Comments.CommentDeleted({ target: booking, by: "system:BookingRemoval" })),
    ),
  );

  it.effect("lists a target's comments oldest first, with edits and without deleted ones", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.clock("2026-01-01T10:00:00Z"),
      Story.when(c2, new Comments.AddComment({ target: booking, body: "first" })),
      Story.then(c2, new Comments.CommentAdded({ target: booking, by: "ann", body: "first" })),
      Story.clock("2026-01-01T11:00:00Z"),
      Story.when(c1, new Comments.AddComment({ target: booking, body: "second" })),
      Story.then(c1, new Comments.CommentAdded({ target: booking, by: "ann", body: "second" })),
      Story.clock("2026-01-01T12:00:00Z"),
      Story.when(c2, new Comments.EditComment({ body: "first, edited" })),
      Story.then(
        c2,
        new Comments.CommentEdited({ target: booking, by: "ann", body: "first, edited" }),
      ),
      Story.view(Comments.CommentsOnTarget, key, {
        comments: [
          {
            id: c2.id,
            by: "ann",
            body: "first, edited",
            postedAt: Date.parse("2026-01-01T10:00:00Z"),
            editedAt: Date.parse("2026-01-01T12:00:00Z"),
          },
          {
            id: c1.id,
            by: "ann",
            body: "second",
            postedAt: Date.parse("2026-01-01T11:00:00Z"),
            editedAt: null,
          },
        ],
      }),
      Story.when(c2, new Comments.DeleteComment()),
      Story.then(c2, new Comments.CommentDeleted({ target: booking, by: "ann" })),
      Story.view(Comments.CommentsOnTarget, key, (v) =>
        expect(v.comments.map((c) => c.body)).toEqual(["second"]),
      ),
      Story.view(Comments.CommentsOnTarget, targetKey({ kind: "booking", id: "b-2" }), Story.none),
    ),
  );
});

describe("Comments over the Api", () => {
  const World = SessionLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        devTokens({
          "ann-token": { subject: "ann", orgId: null, roles: ["member"] },
          "bob-token": { subject: "bob", orgId: null, roles: ["member"] },
          "eve-token": { subject: "eve", orgId: null, roles: ["guest"] },
        }),
        Roles.layer({ member: [read, write], guest: [] }),
      ),
    ),
    Layer.provideMerge(App.layer(Layer.empty).pipe(Layer.provide(platformForTests))),
  );
  const as = (token: string) => AppApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

  it.live("authors comment and read through the session; others are refused", () =>
    Effect.gen(function* () {
      const id = Comments.CommentId.make("c-api");
      const annApi = yield* as("ann-token");
      const added = yield* annApi.AddComment(id, { target: booking, body: "hello" });
      const seen = yield* annApi.CommentsOnTarget.get(key, { atLeast: added });
      expect(seen?.comments.map((c) => [c.by, c.body])).toEqual([["ann", "hello"]]);
      const bobApi = yield* as("bob-token");
      const notAuthor = yield* bobApi.EditComment(id, { body: "mine now" }).pipe(Effect.flip);
      expect(notAuthor._tag).toBe("NotAuthor");
      const eveApi = yield* as("eve-token");
      const forbidden = yield* eveApi.CommentsOnTarget.get(key).pipe(Effect.flip);
      expect(forbidden._tag).toBe("Forbidden");
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});
