import { Context, Effect, Layer } from "effect";
import { ApprovalDenied } from "./gate-errors.ts";

export type ApprovalService = Readonly<{
  approve: (capabilityName: string, input: unknown) => Effect.Effect<void, ApprovalDenied>;
}>;

export class Approval extends Context.Service<Approval, ApprovalService>()(
  "@house-rules/capability/Approval",
) {
  static readonly allowAll: Layer.Layer<Approval> = Layer.succeed(Approval, {
    approve: () => Effect.void,
  });

  static readonly denyAll: Layer.Layer<Approval> = Layer.succeed(Approval, {
    approve: (capabilityName) =>
      Effect.fail(new ApprovalDenied({ capabilityName, reason: "Approval is required" })),
  });
}
