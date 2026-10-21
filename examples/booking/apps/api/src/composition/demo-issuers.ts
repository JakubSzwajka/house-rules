import { errorKind } from "@house-rules/domain/contract";
import { AuthJwtLocal } from "@house-rules/auth-jwt";
import { Context, Effect, Layer, Schema } from "effect";

export const demoLocalJwt = {
  web: { issuer: "https://web.invalid" },
  partner: { issuer: "https://partner.invalid" },
} as const;
export class DemoForbidden extends Schema.TaggedError<DemoForbidden>()("DemoForbidden", {
  kind: errorKind("unavailable"),
}) {
  override get message() {
    return "Demo issuer refused in production.";
  }
}
export class DemoIssuers extends Context.Service<
  DemoIssuers,
  {
    readonly web: Effect.Success<ReturnType<typeof AuthJwtLocal.make>>;
    readonly partner: Effect.Success<ReturnType<typeof AuthJwtLocal.make>>;
  }
>()("@example/api/DemoIssuers") {
  static readonly layer = (nodeEnv: string) =>
    Layer.effect(
      DemoIssuers,
      Effect.gen(function* () {
        if (nodeEnv === "production") return yield* new DemoForbidden();
        return {
          web: yield* AuthJwtLocal.make(demoLocalJwt.web),
          partner: yield* AuthJwtLocal.make(demoLocalJwt.partner),
        };
      }),
    );
}
