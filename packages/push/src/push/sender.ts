import { Context, type Effect } from "effect";
import type { PushPayload, PushSendFailed, PushSubscription } from "./push.js";
export type PushSendOptions = { readonly ttl: number; readonly idempotencyKey?: string };
export class PushSender extends Context.Service<
  PushSender,
  {
    readonly send: (
      subscription: PushSubscription,
      payload: PushPayload,
      options: PushSendOptions,
    ) => Effect.Effect<"sent" | "gone", PushSendFailed>;
  }
>()("@house-rules/push/PushSender") {}
