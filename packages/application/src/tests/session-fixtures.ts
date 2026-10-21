import { featureFixture } from "./feature-fixtures.ts";
import { defineOperation } from "@house-rules/domain";
import { Clock, Effect, Schema } from "effect";
import { defineApi, endpoint } from "../index.ts";
import { bindFixture } from "./execution-fixtures.ts";
const SignedIn = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.Int,
  name: Schema.String,
});
export const signIn = bindFixture(
  featureFixture(
    defineOperation("sign_in", {
      description: "Sign in and get a token.",
      input: Schema.Struct({ name: Schema.String }),
      output: SignedIn,
      failure: Schema.Never,
      permission: null,
    }),
  ),
  ({ name }) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => ({ token: `tok.${name}`, expiresAt: now + 3_600_000, name })),
    ),
);
export const signOut = bindFixture(
  featureFixture(
    defineOperation("sign_out", {
      description: "Sign out.",
      input: Schema.Struct({}),
      output: Schema.Struct({}),
      failure: Schema.Never,
      permission: null,
    }),
  ),
  () => Effect.succeed({}),
);
export const leaky = bindFixture(
  featureFixture(
    defineOperation("leaky_sign_in", {
      description: "A sign-in whose token is not cookie-safe.",
      input: Schema.Struct({}),
      output: SignedIn,
      failure: Schema.Never,
      permission: null,
    }),
  ),
  () => Effect.succeed({ token: "has a space secret-123", expiresAt: 0, name: "x" }),
);
export const api = defineApi(
  { prefix: "/auth" },
  {
    signIn: endpoint(signIn, "POST /sign-in", { session: "issue" }),
    signOut: endpoint(signOut, "POST /sign-out", { session: "clear" }),
  },
);
