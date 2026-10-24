import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const PushOwner = Schema.Struct({ kind: Schema.NonEmptyString, id: Schema.NonEmptyString });
export type PushOwner = typeof PushOwner.Type;
export const PushSubscription = Schema.Struct({
  endpoint: Schema.NonEmptyString,
  owner: PushOwner,
  keys: Schema.Struct({ p256dh: Schema.NonEmptyString, auth: Schema.NonEmptyString }),
  userAgent: Schema.optionalKey(Schema.String),
  createdAt: Schema.Int,
  expiredAt: Schema.optionalKey(Schema.Int),
});
export type PushSubscription = typeof PushSubscription.Type;
export const PushPayload = Schema.Unknown;
export type PushPayload = typeof PushPayload.Type;
export const PushTtl = Schema.Int.check(Schema.isGreaterThan(0));

export class PushCallerDenied extends Schema.TaggedError<PushCallerDenied>()("PushCallerDenied", {
  kind: errorKind("forbidden"),
}) {}
export class PushInputInvalid extends Schema.TaggedError<PushInputInvalid>()("PushInputInvalid", {
  kind: errorKind("invalid"),
  message: Schema.String,
}) {}
export class PushSubscriptionNotFound extends Schema.TaggedError<PushSubscriptionNotFound>()(
  "PushSubscriptionNotFound",
  {
    kind: errorKind("not_found"),
    message: Schema.String,
  },
) {}
export class PushSubscriptionConflict extends Schema.TaggedError<PushSubscriptionConflict>()(
  "PushSubscriptionConflict",
  {
    kind: errorKind("conflict"),
    message: Schema.String,
  },
) {}
export class PushStoreUnavailable extends Schema.TaggedError<PushStoreUnavailable>()(
  "PushStoreUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Push subscriptions are unavailable. Try again shortly.";
  }
}
export class PushSendFailed extends Schema.TaggedError<PushSendFailed>()("PushSendFailed", {
  kind: errorKind("unavailable"),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Push delivery is unavailable. Try again shortly.";
  }
}
export const Subscribed = Schema.TaggedStruct("Subscribed", {
  endpoint: Schema.NonEmptyString,
  owner: PushOwner,
});
export const Unsubscribed = Schema.TaggedStruct("Unsubscribed", {
  endpoint: Schema.NonEmptyString,
  owner: PushOwner,
});
export const SubscriptionExpired = Schema.TaggedStruct("SubscriptionExpired", {
  endpoint: Schema.NonEmptyString,
});
export const PushEvents = { Subscribed, Unsubscribed, SubscriptionExpired } as const;
