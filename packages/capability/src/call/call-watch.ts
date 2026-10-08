import { Context, type Effect } from "effect";
import type { CallFacts } from "./call-facts.ts";
import type { AnyContract } from "../contract/contract.ts";

export type Around = <A, E, R>(
  contract: AnyContract,
  input: unknown,
  run: Effect.Effect<A, E, R>,
  facts?: CallFacts,
) => Effect.Effect<A, E, R>;

export type CallWatchService = Readonly<{ around: Around }>;

const passThrough: Around = (_contract, _input, run) => run;

export const CallWatch = Context.Reference<CallWatchService>("@house-rules/capability/CallWatch", {
  defaultValue: () => ({ around: passThrough }),
});
