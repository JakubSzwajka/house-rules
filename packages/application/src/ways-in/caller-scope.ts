import type { Actor } from "@house-rules/domain";
import { Context } from "effect";
import type { Incoming } from "./caller.ts";

export class CallerScope extends Context.Service<
  CallerScope,
  Readonly<{ incoming: Incoming; requestId: string; actor: Actor }>
>()("@house-rules/application/CallerScope") {}
