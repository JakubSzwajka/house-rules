import type { AnyNode, Caller, KindedError, NoOpenUnit, Targets } from "@house-rules/domain";
import type { Effect } from "effect";
import type { CallerContext } from "../caller/caller-context.ts";
import type { Forbidden } from "../gates/gate-errors.ts";
import type { NodeCallInvalid } from "./node-call-invalid.ts";

export type InnerFailure = Forbidden | NodeCallInvalid | NoOpenUnit;
export type ScopedCall<N extends AnyNode> = <T extends Targets<N>>(
  target: T,
  input: T["input"]["Type"],
) => Effect.Effect<T["output"]["Type"], T["failure"]["Type"] | InnerFailure>;
export type NodeScope<N extends AnyNode> = Readonly<{ caller: Caller; call: ScopedCall<N> }>;
export type Binding = Readonly<{
  node: AnyNode;
  run: (
    input: unknown,
    scope: NodeScope<AnyNode>,
  ) => Effect.Effect<unknown, KindedError, CallerContext>;
}>;

export const bindNode = <N extends AnyNode>(
  node: N,
  handler: (
    input: N["input"]["Type"],
    scope: NodeScope<N>,
  ) => Effect.Effect<N["output"]["Type"], N["failure"]["Type"] | InnerFailure, CallerContext>,
): Binding => ({
  node,
  // Dispatch below requires the descriptor identity checked before erasure here.
  run: handler as unknown as Binding["run"],
});
