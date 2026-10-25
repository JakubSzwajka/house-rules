import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { clearsCallHistory } from "../session.ts";

it.effect(
  "clears person-owned tab history on authentication, sign-out and changed profile identity",
  () =>
    Effect.sync(() => {
      for (const action of ["signIn", "signUp", "signOut"] as const) {
        assert.isTrue(clearsCallHistory(action, "carol", "alice"));
        assert.isTrue(clearsCallHistory(action));
      }
      assert.isTrue(clearsCallHistory("myProfile", "carol", "alice"));
      assert.isTrue(clearsCallHistory("myProfile", undefined, "alice"));
      assert.isFalse(clearsCallHistory("myProfile", "alice", "alice"));
      assert.isFalse(clearsCallHistory("createInvitation", "carol", "carol"));
      assert.isFalse(clearsCallHistory("myActivity", "alice", "alice"));
    }),
);
