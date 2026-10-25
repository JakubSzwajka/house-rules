import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { approvalNeeded } from "../session.ts";
it.effect("lifted approval flags require human confirmation for cancel, revoke and delete", () =>
  Effect.sync(() => {
    for (const action of ["cancelBooking", "revokeRole", "deleteRole"] as const)
      assert.isTrue(approvalNeeded(action));
    for (const action of [
      "makeBooking",
      "showBooking",
      "myProfile",
      "listRoles",
      "signIn",
    ] as const)
      assert.isFalse(approvalNeeded(action));
  }),
);
