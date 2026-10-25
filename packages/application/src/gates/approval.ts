import { Context, Effect, Layer } from "effect";
import { ApprovalDenied } from "./gate-errors.ts";

export type ApprovalService = Readonly<{
  approve: (feature: string, input: unknown) => Effect.Effect<void, ApprovalDenied>;
}>;

export class Approval extends Context.Service<Approval, ApprovalService>()(
  "@house-rules/application/Approval",
) {
  static readonly allowAll: Layer.Layer<Approval> = Layer.succeed(Approval, {
    approve: () => Effect.void,
  });

  static readonly denyAll: Layer.Layer<Approval> = Layer.succeed(Approval, {
    approve: (feature) =>
      Effect.fail(new ApprovalDenied({ feature, reason: "Approval is required" })),
  });
}
