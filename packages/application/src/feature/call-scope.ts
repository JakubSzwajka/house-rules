import type { AnyCallable, Caller, NoOpenUnit, Targets } from "@house-rules/domain/contract";
import type { Effect } from "effect";
import type { Forbidden } from "../gates/gate-errors.ts";
import type { CallInvalid } from "./call-invalid.ts";

export type InnerFailure = Forbidden | CallInvalid | NoOpenUnit;
export type ScopedCall<N extends AnyCallable> = <T extends Targets<N>>(
  target: T,
  input: T["input"]["Type"],
) => Effect.Effect<T["output"]["Type"], T["failure"]["Type"] | InnerFailure>;
export type CallScope<N extends AnyCallable> = Readonly<{ caller: Caller; call: ScopedCall<N> }>;
