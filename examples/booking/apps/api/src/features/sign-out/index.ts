import { defineFeature } from "@house-rules/application/contract";
import { Effect, Schema } from "effect";
export const signOut = defineFeature("sign_out", {
  description: "Clear this browser's session. Copied tokens remain valid until expiry.",
  permission: null,
  input: Schema.Struct({}),
  output: Schema.Struct({}),
  failure: Schema.Never,
  flags: {},
  handler: () => Effect.succeed({}),
});
