import { Context, type Effect } from "effect";
import type { CallFacts } from "./call-facts.ts";
import type { AnyEntryPoint } from "../feature/feature.ts";

export type Around = <A, E, R>(
  feature: AnyEntryPoint,
  input: unknown,
  run: Effect.Effect<A, E, R>,
  facts?: CallFacts,
) => Effect.Effect<A, E, R>;

export type CallWatchService = Readonly<{ around: Around }>;

const passThrough: Around = (_feature, _input, run) => run;

export type CallWatch = Context.Service.Identifier<typeof CallWatch>;

export const CallWatch = Context.Reference<CallWatchService>("@house-rules/application/CallWatch", {
  defaultValue: () => ({ around: passThrough }),
});
