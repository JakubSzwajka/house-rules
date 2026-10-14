import { AuthJwtLocalIssuer } from "@house-rules/auth-jwt";
import { defineModule } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { type DevName, DevSignInOff, type DevToken } from "./sign-in/dev-sign-in.js";
import { subjectOf } from "./sign-in/subject.js";

export class DevSignIn extends defineModule<
  DevSignIn,
  {
    readonly signIn: (name: DevName) => Effect.Effect<DevToken, DevSignInOff>;
  }
>()("@example/dev-sign-in/DevSignIn", {
  make: Effect.gen(function* devSignInLayer() {
    const issuer = yield* AuthJwtLocalIssuer;
    return {
      signIn: Effect.fn("DevSignIn.signIn")(function* signIn(name: DevName) {
        const token = yield* issuer.issue({ sub: subjectOf(name), name });
        return { token };
      }),
    };
  }),
}) {
  // The switch is off: every sign-in is refused, and no issuer exists.
  static readonly off: Layer.Layer<DevSignIn> = Layer.succeed(
    this,
    this.of({ signIn: () => Effect.fail(new DevSignInOff()) }),
  );
}
