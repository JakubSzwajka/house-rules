import { Authenticator, type AuthenticatorService, TokenRejected } from "@house-rules/application";
import { AuthJwt } from "@house-rules/auth-jwt";
import { Context, Effect, Layer } from "effect";

export class McpAuthenticator extends Context.Service<McpAuthenticator, AuthenticatorService>()(
  "@example/api/McpAuthenticator",
) {
  static readonly layer = (issuer: string) =>
    issuer === ""
      ? Layer.succeed(McpAuthenticator, {
          verify: () => Effect.fail(new TokenRejected({ reason: "invalid" })),
        })
      : Layer.effect(McpAuthenticator, Effect.service(Authenticator)).pipe(
          Layer.provide(AuthJwt.layer({ issuer })),
        );
}
