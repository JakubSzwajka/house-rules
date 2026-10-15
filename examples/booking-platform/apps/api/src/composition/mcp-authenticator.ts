import { Authenticator, type AuthenticatorService, TokenRejected } from "@house-rules/application";
import { AuthJwt, type AuthJwtConfigInvalid, type AuthJwtOptions } from "@house-rules/auth-jwt";
import { Context, Effect, Layer, Option } from "effect";

const refuseEveryToken: AuthenticatorService = {
  verify: () => Effect.fail(new TokenRejected({ reason: "invalid" })),
};

export class McpAuthenticator extends Context.Service<McpAuthenticator, AuthenticatorService>()(
  "@example/api/McpAuthenticator",
) {
  static readonly layer = (
    options: Option.Option<AuthJwtOptions>,
  ): Layer.Layer<McpAuthenticator, AuthJwtConfigInvalid> =>
    Option.match(options, {
      onNone: () => Layer.succeed(McpAuthenticator, refuseEveryToken),
      onSome: (jwt) =>
        Layer.effect(McpAuthenticator, Effect.service(Authenticator)).pipe(
          Layer.provide(AuthJwt.layer(jwt)),
        ),
    });
}
