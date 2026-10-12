import { Context } from "effect";
import type { Incoming } from "./caller.ts";

export class CallerScope extends Context.Service<
  CallerScope,
  Readonly<{ incoming: Incoming; requestId: string; caller: Context.Context<never> }>
>()("@house-rules/capability/CallerScope") {}
