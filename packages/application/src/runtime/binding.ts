import type { AnyCallable, KindedError } from "@house-rules/domain/contract";
import type { Effect } from "effect";
import type { CallerContext } from "../caller/caller-context.ts";
import type { CallScope, InnerFailure } from "../feature/call-scope.ts";

export type { CallScope, InnerFailure, ScopedCall } from "../feature/call-scope.ts";
export type Binding = Readonly<{
  callable: AnyCallable & { readonly kind: "operation" };
  run: (
    input: unknown,
    scope: CallScope<AnyCallable>,
  ) => Effect.Effect<unknown, KindedError, CallerContext>;
}>;

export const bindOperation = <N extends AnyCallable & { readonly kind: "operation" }>(
  callable: N,
  handler: (
    input: N["input"]["Type"],
    scope: CallScope<N>,
  ) => Effect.Effect<N["output"]["Type"], N["failure"]["Type"] | InnerFailure, CallerContext>,
): Binding => ({
  callable,
  // Dispatch below requires the descriptor identity checked before erasure here.
  run: handler as unknown as Binding["run"],
});
