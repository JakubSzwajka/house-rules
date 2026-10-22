import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { mergeActivity } from "../activity.ts";
it.effect(
  "dock links tab calls to own audit by request id without duplicate rows and marks reads",
  () =>
    Effect.sync(() => {
      const rows = mergeActivity(
        [
          {
            name: "my_profile",
            requestId: "read-a",
            method: "POST",
            path: "/api/my_profile",
            status: 200,
            ms: 2,
            message: "OK",
          },
          {
            name: "create_organisation",
            requestId: "write-a",
            method: "POST",
            path: "/api/create_organisation",
            status: 200,
            ms: 4,
            message: "OK",
          },
        ],
        [
          {
            at: 1000,
            who: "alice",
            feature: "create_organisation",
            requestId: "write-a",
            outcome: "success",
            ms: 3,
            kind: "write",
          },
          {
            at: 2000,
            who: "alice",
            feature: "accept_invitation",
            requestId: "other-tab",
            outcome: "success",
            ms: 5,
            kind: "write",
          },
        ],
      );
      assert.strictEqual(rows.length, 3);
      assert.strictEqual(rows[1]?.source, "tab + audit");
      assert.strictEqual(rows.filter((r) => !r.read).length, 2);
      assert.strictEqual(rows[2]?.source, "audit");
    }),
);
