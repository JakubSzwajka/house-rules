import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { IdentityOperations } from "../index.js";
it.effect("accounts operations declare v2 permissions and transactions", () =>
  Effect.sync(() => {
    expect(
      Object.values(IdentityOperations)
        .filter((op) => op.name !== "Identity.bindLogin")
        .map((op) => [op.name, op.permission, op.transactional]),
    ).toEqual([
      ["Identity.signUp", "identity:create", true],
      ["Identity.signIn", "identity:sign-in", true],
      ["Identity.changePassword", "identity:update", true],
      ["Identity.issueToken", "identity:tokens-issue", true],
      ["Identity.listTokens", "identity:tokens-read", false],
      ["Identity.revokeToken", "identity:tokens-revoke", true],
      ["Identity.recordTokenUse", "identity:tokens-use", true],
      ["Identity.endSessions", "identity:sessions-end", true],
    ]);
  }),
);
