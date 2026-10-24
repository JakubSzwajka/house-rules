import { Context, type Effect } from "effect";
import type { PushPayload, PushSubscription } from "../../push/push.js";
import type { PushSendOptions } from "../../push/sender.js";

export type MemoryPushResult = "sent" | "gone" | "fail";
export type MemoryPushSend = {
  readonly subscription: PushSubscription;
  readonly payload: PushPayload;
  readonly options: PushSendOptions;
  readonly result: MemoryPushResult;
};
export class MemoryPushOutbox extends Context.Service<
  MemoryPushOutbox,
  { readonly sends: Effect.Effect<ReadonlyArray<MemoryPushSend>> }
>()("@house-rules/push/MemoryPushOutbox") {}
