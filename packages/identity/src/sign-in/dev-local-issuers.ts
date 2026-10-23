import type { AuthJwtLocalKit } from "@house-rules/auth-jwt";
import { Context, Effect } from "effect";
import { IdentityProviderInvalid } from "./provider-invalid.js";

export class DevLocalIssuers extends Context.Service<
  DevLocalIssuers,
  {
    readonly get: (issuer: string) => Effect.Effect<AuthJwtLocalKit, IdentityProviderInvalid>;
  }
>()("@house-rules/identity/DevLocalIssuers") {
  static readonly from = (
    issuers: ReadonlyMap<string, AuthJwtLocalKit>,
  ): DevLocalIssuers["Service"] => ({
    get: (issuer) => {
      const handle = issuers.get(issuer);
      return handle === undefined
        ? Effect.fail(
            new IdentityProviderInvalid({
              option: "issuer",
              message: "Development issuer is not configured.",
            }),
          )
        : Effect.succeed(handle);
    },
  });
}
