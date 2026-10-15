import { expect, it } from "@effect/vitest";
import type { ActivityEntry } from "@example/activity";
import { Effect } from "effect";
import { accountsApi, origin, password } from "./accounts-api.js";

const summary = (entry: ActivityEntry) => [entry.capability, entry.kind, entry.outcome];

it.live("the audit trail keeps reads too, with each call's request id and duration", () =>
  Effect.gen(function* fullAudit() {
    const { signUpAndIn, calls } = yield* accountsApi();
    const alice = yield* signUpAndIn("trail-a@example.test", "Alice");
    yield* Effect.promise(() => alice.showMe({}));
    yield* Effect.promise(() => alice.listMyBookings({}));
    yield* Effect.promise(() => alice.bookBooking({ id: "t-1", guestName: "Ada" }));

    yield* Effect.promise(() => alice.listMyActivity({}));
    const trail = yield* Effect.promise(() => alice.listMyActivity({}));
    expect(trail.items.map(summary)).toEqual([
      ["book_booking", "write", "success"],
      ["list_my_bookings", "read", "success"],
      ["show_me", "read", "success"],
    ]);
    expect(trail.next).toBe(null);
    // Its own reads are kept too, and show when asked for.
    const withReads = yield* Effect.promise(() =>
      alice.listMyActivity({ includeActivityReads: true }),
    );
    expect(withReads.items.map(summary).slice(0, 2)).toEqual([
      ["list_my_activity", "read", "success"],
      ["list_my_activity", "read", "success"],
    ]);
    for (const entry of trail.items) {
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(entry.channel).toBe("web");
    }
    // The ids the client saw on each answer are the ids the audit kept.
    const seen = calls
      .filter((entry) => ["show_me", "list_my_bookings", "book_booking"].includes(entry.name))
      .map((entry) => entry.requestId)
      .reverse();
    expect(trail.items.map((entry) => entry.requestId)).toEqual(seen);
    expect(seen.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  }),
);

it.live("Bob's audit trail holds none of Alice's calls", () =>
  Effect.gen(function* onlyMine() {
    const { signUpAndIn } = yield* accountsApi();
    const alice = yield* signUpAndIn("trail-b@example.test", "Alice");
    const bob = yield* signUpAndIn("trail-c@example.test", "Bob");
    yield* Effect.promise(() => alice.bookBooking({ id: "a-1", guestName: "Ada" }));
    yield* Effect.promise(() => bob.bookBooking({ id: "b-1", guestName: "Grace" }));

    const alices = yield* Effect.promise(() => alice.listMyActivity({}));
    const bobs = yield* Effect.promise(() => bob.listMyActivity({}));
    expect(alices.items.map((entry) => entry.targetId)).toEqual(["a-1"]);
    expect(bobs.items.map((entry) => entry.targetId)).toEqual(["b-1"]);
    const alicesIds = new Set(alices.items.map((entry) => entry.requestId));
    expect(bobs.items.some((entry) => alicesIds.has(entry.requestId))).toBe(false);
  }),
);

it.live("Load older pages back over HTTP with no overlap, while new calls land on top", () =>
  Effect.gen(function* paging() {
    const { signUpAndIn } = yield* accountsApi();
    const alice = yield* signUpAndIn("trail-d@example.test", "Alice");
    for (let index = 0; index < 25; index += 1) {
      yield* Effect.promise(() => alice.showMe({}));
    }
    const first = yield* Effect.promise(() => alice.listMyActivity({}));
    expect(first.items).toHaveLength(20);
    expect(first.next).not.toBe(null);
    const second = yield* Effect.promise(() =>
      alice.listMyActivity({ ...first.next, includeActivityReads: false }),
    );
    expect(second.items.map((entry) => entry.capability)).toEqual(Array(5).fill("show_me"));
    expect(second.next).toBe(null);
    const ids = [...first.items, ...second.items].map((entry) => entry.requestId);
    expect(new Set(ids).size).toBe(25);
  }),
);

const badCursors = [
  { name: "beforeAt without skipAtSameTime", search: "beforeAt=5" },
  { name: "skipAtSameTime without beforeAt", search: "skipAtSameTime=1" },
  { name: "a negative beforeAt", search: "beforeAt=-1&skipAtSameTime=0" },
  { name: "a negative skipAtSameTime", search: "beforeAt=5&skipAtSameTime=-1" },
  { name: "a beforeAt past the last date", search: "beforeAt=1e308&skipAtSameTime=0" },
  { name: "a skipAtSameTime past the window", search: "beforeAt=5&skipAtSameTime=1000" },
  { name: "a fractional skipAtSameTime", search: "beforeAt=5&skipAtSameTime=1.5" },
  { name: "the old beforeRequestId", search: "beforeAt=5&skipAtSameTime=0&beforeRequestId=abc" },
  { name: "a word for includeActivityReads", search: "includeActivityReads=yes" },
];

it.live("every malformed or orphan cursor is a typed 400, and a whole one is a 200", () =>
  Effect.gen(function* badCursor() {
    const { visitor, tokens, fetch } = yield* accountsApi();
    const email = "cursor@example.test";
    yield* Effect.promise(() => visitor.signUp({ email, password, displayName: "Alice" }));
    const { token } = yield* Effect.promise(() => tokens.signIn({ email, password }));
    const ask = (search: string) =>
      Effect.gen(function* askOnce() {
        const response = yield* Effect.promise(() =>
          fetch(`${origin}/api/my/activity?${search}`, {
            headers: { authorization: `Bearer ${token}` },
          }),
        );
        const body = yield* Effect.promise((): Promise<unknown> => response.json());
        return { status: response.status, body };
      });
    for (const { name, search } of badCursors) {
      const answer = yield* ask(search);
      expect({ name, status: answer.status }).toEqual({ name, status: 400 });
      expect(answer.body).toMatchObject({ error: { code: "invalid_input" } });
    }
    const good = yield* ask("beforeAt=5&skipAtSameTime=0&includeActivityReads=true");
    expect(good.status).toBe(200);
  }),
);
